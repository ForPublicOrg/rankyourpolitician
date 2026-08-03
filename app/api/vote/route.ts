import { NextRequest, NextResponse } from 'next/server';
import { getCandidateSentiment, getElectionSeat, getPerson, getPersonSentiment } from '@/lib/data';
import { recordVote } from '@/lib/votes';
import { getDb, isFirestoreConfigured } from '@/lib/firebase-admin';
import { getClientIp, verifyTurnstile, checkRateLimit, voterKey } from '@/lib/vote-integrity';
import { candidateRatingId, isCandidateRatingId, isRatingLocked } from '@/lib/elections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Election candidates are rated through this same endpoint, under a `cand:`
 * id namespace ("cand:{seatSlug}:{candidateSlug}"). Sharing the route is what
 * makes dedupe, Turnstile and rate-limiting apply to them unchanged - and
 * because lib/data.ts builds its sentiment map from politicians.json alone, a
 * candidate id can never surface in the rankings, the trending list or
 * /api/ratings.
 *
 * Two refusals are non-negotiable:
 *
 *  - SILENCE PERIOD. A star rating is an opinion survey. RP Act 1951 s.126(1)(b)
 *    bans displaying election matter in the 48 hours before a poll closes, and
 *    s.126A bans publishing the result of an opinion survey about how electors
 *    vote while an election is under way. So candidate rating closes 48 hours
 *    before the poll closes and reopens 30 minutes after. The widget hides
 *    itself too, but this is the enforcement.
 *
 *  - ONE HUMAN, ONE RATING. A candidate linked to a sitting member
 *    (`politicianId`) is rated on their /person page, never here. Allowing both
 *    would let one visitor rate the same person twice under two ids - a bug
 *    this site has already shipped once, via a duplicate ratable page.
 */
type CandidateTarget =
  | { ok: true; ratingId: string }
  | { ok: false; error: 'not-found' | 'silence-period' | 'moved'; redirectTo?: string };

async function resolveCandidate(ratingId: string): Promise<CandidateTarget> {
  const [, seatSlug, candidateSlug] = ratingId.split(':');
  if (!seatSlug || !candidateSlug) return { ok: false, error: 'not-found' };
  const found = await getElectionSeat(seatSlug);
  const candidate = found?.seat.candidates.find((c) => c.slug === candidateSlug);
  if (!found || !candidate) return { ok: false, error: 'not-found' };
  if (candidate.politicianId) return { ok: false, error: 'moved', redirectTo: candidate.politicianId };
  if (isRatingLocked(found.event)) return { ok: false, error: 'silence-period' };
  return { ok: true, ratingId: candidateRatingId(seatSlug, candidateSlug) };
}

const CANDIDATE_STATUS: Record<'not-found' | 'silence-period' | 'moved', number> = {
  'not-found': 404,
  'silence-period': 403,
  moved: 403,
};

/** Live sentiment for one person. VoteWidget fetches this on mount because
 *  profile HTML is ISR-cached for up to a day - the page stays a cheap static
 *  serve while the numbers stay fresh. Reads the in-process TTL-cached
 *  aggregates (zero extra Firestore reads) and is CDN-cached for 5 minutes,
 *  so most page views never even invoke the function. */
export async function GET(req: NextRequest) {
  const politicianId = req.nextUrl.searchParams.get('politicianId');
  if (!politicianId) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  if (isCandidateRatingId(politicianId)) {
    const target = await resolveCandidate(politicianId);
    if (!target.ok) {
      return NextResponse.json({ error: target.error }, { status: CANDIDATE_STATUS[target.error] });
    }
    const s = await getCandidateSentiment(target.ratingId);
    return NextResponse.json(
      {
        ok: true,
        sentiment: { mean: s.raw_mean, votes: s.n_votes, distribution: s.distribution, confidence: s.confidence },
      },
      { headers: { 'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' } },
    );
  }

  const res = await getPerson(politicianId);
  if (!res || (!res.person && !res.redirectTo)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  // Appointed officials are information-only and carry no ratings.
  if (res.person && res.person.kind === 'official') return NextResponse.json({ error: 'not-ratable' }, { status: 403 });

  const s = await getPersonSentiment(res.redirectTo ?? politicianId);
  return NextResponse.json(
    {
      ok: true,
      sentiment: { mean: s.raw_mean, votes: s.n_votes, distribution: s.distribution, confidence: s.confidence },
    },
    { headers: { 'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' } },
  );
}

export async function POST(req: NextRequest) {
  let body: { politicianId?: string; rating?: number; fingerprint?: string; turnstileToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { politicianId, rating, fingerprint = '', turnstileToken = '' } = body;
  if (!politicianId || typeof rating !== 'number' || rating < 0 || rating > 5 || !Number.isInteger(rating)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // Candidates resolve against the elections seed, not the politician index.
  // Everything after this point - Turnstile, rate limit, dedupe key, the
  // Firestore transaction - is shared, so a candidate vote is exactly as hard
  // to forge as a leader vote.
  let candidateRating: string | null = null;
  if (isCandidateRatingId(politicianId)) {
    const target = await resolveCandidate(politicianId);
    if (!target.ok) {
      return NextResponse.json(
        { error: target.error, ...(target.redirectTo ? { redirectTo: target.redirectTo } : {}) },
        { status: CANDIDATE_STATUS[target.error] },
      );
    }
    candidateRating = target.ratingId;
  }

  const res = candidateRating ? null : await getPerson(politicianId);
  if (!candidateRating && (!res || (!res.person && !res.redirectTo))) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  // Resolve the CANONICAL person before recording, exactly as GET does. An alias
  // id (a central minister linked to their MP, or a state minister linked to
  // their MLA) redirects to the linked profile; the vote must be booked under
  // that one real id, never the alias. Recording under the alias would give the
  // same voter two standing votes for the same human (their alias-doc vote and
  // their canonical-doc vote), defeating dedupe. The redirect target is resolved
  // with a second getPerson - it hits the in-process cached index, so it costs
  // zero extra Firestore reads.
  let canonicalId: string;
  if (candidateRating) {
    canonicalId = candidateRating;
  } else {
    canonicalId = res!.redirectTo ?? politicianId;
    const target = res!.redirectTo ? await getPerson(res!.redirectTo) : res!;
    if (!target || !target.person) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    // Appointed officials are information-only and must never be rated. Guard the
    // RESOLVED target: for an alias id res.person is undefined, so this check has
    // to run after resolution or it would be skipped entirely.
    if (target.person.kind === 'official') {
      return NextResponse.json({ error: 'not-ratable' }, { status: 403 });
    }
  }

  // Fail closed in production. When Firestore is configured but no handle is
  // available, recordVote would fall back to per-lambda process memory, where
  // each instance has its own map - so the same voter's next vote can land on a
  // fresh instance and count as a brand-new voter, and the tally is ephemeral.
  // Reject instead of silently voiding dedupe. Credential-less mode (no creds
  // configured) is the documented local/dev/seed path and keeps working. This
  // route never runs during `next build`, so the build is unaffected.
  if (process.env.NODE_ENV === 'production' && isFirestoreConfigured() && !getDb()) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const ip = getClientIp(req.headers);

  const bot = await verifyTurnstile(turnstileToken, ip);
  if (!bot.ok) return NextResponse.json({ error: 'captcha', reason: bot.reason }, { status: 403 });

  const allowed = await checkRateLimit(ip);
  if (!allowed) return NextResponse.json({ error: 'rate-limited' }, { status: 429 });

  const key = voterKey(ip, fingerprint);
  const { sentiment, updated } = await recordVote(canonicalId, key, rating);

  return NextResponse.json({
    ok: true,
    updated,
    dev: bot.dev ?? false,
    sentiment: {
      // The plain average of votes cast: this refreshes the number shown right
      // above the vote breakdown, so it must agree with it. The Bayesian score
      // is for ordering only and is never displayed.
      mean: sentiment.raw_mean,
      votes: sentiment.n_votes,
      distribution: sentiment.distribution,
      confidence: sentiment.confidence,
    },
  });
}
