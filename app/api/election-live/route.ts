import { NextRequest, NextResponse } from 'next/server';
import { getElection } from '@/lib/data';
import { isCountingWindow, phaseOf } from '@/lib/elections';
import { attachSlugs, constituencyCandidateUrl, fetchConstituencyResult } from '@/lib/eci-results';
import type { ElectionEvent, LiveCountSeat } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Live counting for one election, straight from the Election Commission.
 *
 * The seat pages are static ISR like everything else; this is the only fresh
 * thing on them, fetched by the browser after paint - the same split the vote
 * widget and the trending list use.
 *
 * Three rules keep it cheap and honest:
 *
 *  1. It only talks to ECI on counting day. Outside the counting window the
 *     route makes ZERO outbound requests and reports the frozen seed result.
 *     That gate, not the cache header, is what makes this free to run and
 *     polite to a government server.
 *  2. Inside the window it is memoised in-process for 45s and CDN-cached for
 *     60s, so the whole world costs ECI at most one request a minute per warm
 *     region - for three seats, about 13 KB.
 *  3. It never invents a number. If ECI cannot be read we serve the last good
 *     snapshot, clearly marked stale with the time it was taken; if there has
 *     never been one, we say so and the page falls back to linking the
 *     Commission directly. A blank is honest, a zero is a lie.
 *
 * No Firestore, no cookies, no logging of who asked.
 */

const MEMO_MS = 45_000;
const FETCH_TIMEOUT_MS = 4000;

interface Snapshot {
  seats: LiveCountSeat[];
  fetchedAt: string;
}

/** Per-event memo of the in-flight fetch, plus the last snapshot that actually
 *  worked. Module scope, so it survives between requests on a warm instance
 *  and dies with it - nothing is persisted anywhere. */
const inflight = new Map<string, { at: number; p: Promise<Snapshot | null> }>();
const lastGood = new Map<string, Snapshot>();

async function readFromEci(ev: ElectionEvent): Promise<Snapshot | null> {
  if (!ev.results_base) return null;
  const base = ev.results_base;

  const seats = await Promise.all(
    ev.seats.map(async (seat): Promise<LiveCountSeat | null> => {
      const parsed = await fetchConstituencyResult(base, seat.eci.stateCode, seat.eci.acNo, FETCH_TIMEOUT_MS);
      if (!parsed) return null;
      return {
        seatSlug: seat.slug,
        ...(parsed.round ? { round: parsed.round } : {}),
        rows: attachSlugs(parsed.rows, seat.candidates),
        total_votes: parsed.total_votes,
        source_url: constituencyCandidateUrl(base, seat.eci.stateCode, seat.eci.acNo),
      };
    }),
  );

  const ok = seats.filter((s): s is LiveCountSeat => s !== null);
  // A partial read is still worth serving - one unreadable seat should not
  // blank the other two - but a total failure is a failure.
  if (ok.length === 0) return null;
  return { seats: ok, fetchedAt: new Date().toISOString() };
}

function load(ev: ElectionEvent): Promise<Snapshot | null> {
  const hit = inflight.get(ev.id);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.p;

  const p = readFromEci(ev)
    .then((snap) => {
      if (snap) lastGood.set(ev.id, snap);
      return snap;
    })
    .catch((err) => {
      console.error('[election-live] read failed:', err);
      return null;
    });

  inflight.set(ev.id, { at: Date.now(), p });
  return p;
}

const cache = (seconds: number) => ({
  'cache-control': `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`,
});

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('event');
  const ev = id ? await getElection(id) : null;

  // An unknown event is an empty, CDN-cacheable 200 rather than a 400: a
  // cacheable miss cannot be used to pin the function warm with junk params.
  if (!ev) {
    return NextResponse.json({ ok: true, status: 'unknown', seats: [] }, { headers: cache(3600) });
  }

  const phase = phaseOf(ev);

  // Not counting: answer from the seed and touch nothing external. This is the
  // normal state for all but a few hours in an election's life.
  if (!isCountingWindow(ev)) {
    return NextResponse.json(
      { ok: true, status: phase === 'declared' ? 'final' : 'not-counting', phase, seats: [] },
      { headers: cache(3600) },
    );
  }

  const snap = await load(ev);
  if (snap) {
    return NextResponse.json(
      { ok: true, status: 'live', phase, fetchedAt: snap.fetchedAt, seats: snap.seats },
      { headers: cache(60) },
    );
  }

  const stale = lastGood.get(ev.id);
  if (stale) {
    return NextResponse.json(
      { ok: true, status: 'stale', phase, fetchedAt: stale.fetchedAt, seats: stale.seats },
      { headers: cache(30) },
    );
  }

  // Nothing to show. The page says so and points at the Commission - it never
  // renders an absent count as zero.
  return NextResponse.json({ ok: true, status: 'unavailable', phase, seats: [] }, { headers: cache(30) });
}
