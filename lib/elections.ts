// Election lifecycle: pure date maths, no I/O, safe on server and client.
//
// Every page here is static/ISR, so the HTML can be a week old. Anything that
// depends on "now" - the phase label, the countdown, whether rating is locked -
// is therefore computed from the CITED schedule rather than baked, and the
// client recomputes it on mount. The server value is only a sensible fallback
// for readers without JavaScript.

import { formatDate } from './format';
import type { ElectionEvent, ElectionPhase, ElectionSeat } from './types';

/** India Standard Time is UTC+05:30 year-round (no daylight saving), so a
 *  notified wall-clock time converts to an instant with no timezone database
 *  and no dependence on where the server happens to run. */
const IST_OFFSET_MIN = 5 * 60 + 30;

/** `istInstant('2026-07-30', '18:00')` -> epoch ms for 6pm IST that day. */
export function istInstant(isoDate: string, hhmm = '00:00'): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0) - IST_OFFSET_MIN * 60_000;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The window in which the site must not display or collect any opinion measure
 * about a candidate.
 *
 * RP Act 1951 s.126(1)(b) bans displaying "election matter" in the 48 hours
 * ending with the hour fixed for the conclusion of the poll; s.126A bans
 * publishing an exit poll - defined as an opinion survey about how electors
 * have voted - until after the poll ends. Rating a candidate is an opinion
 * survey, so the conservative union of the two applies: 48 hours before the
 * poll closes, through to 30 minutes after it closes.
 *
 * This is derived from the cited schedule, never hardcoded, so it is correct
 * for every future election without a code change.
 */
export function ratingLockWindow(ev: ElectionEvent): { from: number; to: number } {
  const close = istInstant(ev.schedule.pollDate, ev.schedule.pollClose);
  return { from: close - 48 * HOUR, to: close + 30 * 60_000 };
}

/** Is candidate rating legally locked right now? Enforced server-side in
 *  app/api/vote and mirrored in the widget so the UI never invites a vote it
 *  would then refuse. */
export function isRatingLocked(ev: ElectionEvent, now = Date.now()): boolean {
  const w = ratingLockWindow(ev);
  return now >= w.from && now <= w.to;
}

/**
 * When our API is allowed to ask ECI for numbers: counting morning through to
 * the small hours. Outside it the route makes ZERO outbound requests and serves
 * the frozen seed result - that gate, not the cache header, is what keeps this
 * feature free to run and polite to the Commission.
 */
export function countingWindow(ev: ElectionEvent): { from: number; to: number } {
  const from = istInstant(ev.schedule.countingDate, '07:30');
  return { from, to: from + DAY - 5.5 * HOUR };
}

export function isCountingWindow(ev: ElectionEvent, now = Date.now()): boolean {
  const w = countingWindow(ev);
  return now >= w.from && now <= w.to;
}

/** Where this election stands. Order matters: the checks run latest-first so a
 *  settled election never falls back into a live phase. */
export function phaseOf(ev: ElectionEvent, now = Date.now()): ElectionPhase {
  const s = ev.schedule;
  const declared = ev.seats.some((x) => x.result);
  const countStart = istInstant(s.countingDate, '07:30');
  const pollOpen = istInstant(s.pollDate, s.pollOpen);
  const pollClose = istInstant(s.pollDate, s.pollClose);

  if (declared && now >= countStart) return 'declared';
  if (now >= countStart + DAY) return 'declared';
  if (now >= countStart) return 'counting';
  if (now > pollClose) return 'awaiting-count';
  if (now >= pollOpen) return 'polling';
  if (now >= pollClose - 48 * HOUR) return 'silence';
  // The field is only final once withdrawals close; before that the candidate
  // list on screen can still change.
  if (now > istInstant(s.withdrawalLast, '23:59')) return 'campaign';
  return 'announced';
}

/**
 * The sub-line under an election seat in search - "Elections · Voting soon ·
 * 30 Jul 2026 · Bihar".
 *
 * A seat carries its constituency's name verbatim, so "Bankipur" now matches
 * both /area/ac-br-bankipur and /elections/bankipur-br-2026-07. The dropdown
 * and the results page both call this, so the election row can never end up
 * looking like the area row, and the two surfaces can never drift apart.
 *
 * The static index stores only the cited poll date and whether a result has
 * been frozen, so this is a coarser read than phaseOf() - enough to say whether
 * the voting is ahead, today or behind, without ever asserting a phase the
 * file is too old to know.
 */
export function electionSearchSub(
  hit: { state: string; pollDate: string; countingDate?: string; declared: boolean },
  tr: (k: string, v?: Record<string, string | number>) => string,
  locale = 'en',
  now = Date.now(),
): string {
  const pollStart = istInstant(hit.pollDate);
  const countStart = istInstant(hit.countingDate || hit.pollDate, '07:30');
  const key = hit.declared
    ? 'declared'
    : now < pollStart
      ? 'campaign'
      : now < pollStart + DAY
        ? 'polling'
        : // Counting day is a cited date, so the row can say "Counting now"
          // rather than disagreeing with the page it links to. After it, we
          // stop guessing: without a frozen result the file cannot know the
          // outcome, so it says the result is declared and lets the page speak.
          now >= countStart + DAY
          ? 'declared'
          : now >= countStart
            ? 'counting'
            : 'awaitingCount';
  const parts = [tr('elections.title'), tr(`elections.phase.${key}`)];
  // A date is shown only when it is still ahead: printed next to "Result
  // declared" or "Counting now" it would read as the date of THAT event.
  if (key === 'campaign') parts.push(formatDate(hit.pollDate, locale));
  else if (key === 'awaitingCount' && hit.countingDate) parts.push(formatDate(hit.countingDate, locale));
  if (hit.state) parts.push(hit.state);
  return parts.join(' · ');
}

/** Live = worth surfacing on the home page and at the top of the hub. */
export function isActivePhase(p: ElectionPhase): boolean {
  return p !== 'declared';
}

/** Whole days from now until an ISO date, in IST. Negative once past. */
export function daysUntil(isoDate: string, hhmm = '00:00', now = Date.now()): number {
  return Math.ceil((istInstant(isoDate, hhmm) - now) / DAY);
}

/** The one date a reader most needs for a given phase, so the UI can show
 *  "Counting on 3 August" without a switch statement in every component. */
export function keyDateFor(ev: ElectionEvent, phase: ElectionPhase): { date: string; kind: 'poll' | 'counting' | 'nomination' } {
  if (phase === 'announced') return { date: ev.schedule.withdrawalLast, kind: 'nomination' };
  if (phase === 'campaign' || phase === 'silence' || phase === 'polling') {
    return { date: ev.schedule.pollDate, kind: 'poll' };
  }
  return { date: ev.schedule.countingDate, kind: 'counting' };
}

/** URL segment for a seat: `bankipur-br-2026-07`. Deterministic from the seat
 *  and the poll month, so the same seat can hold several elections over time
 *  without collision. Generated at ingest and stored, never recomputed at
 *  render (a stored slug is a promise to anyone who bookmarked it). */
export function seatSlug(constituencyName: string, stateCode: string, pollDate: string): string {
  const name = constituencyName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const [y, m] = pollDate.split('-');
  return `${name}-${stateCode.toLowerCase()}-${y}-${m}`;
}

/** Rating id for a candidate. A namespace of its own, so a candidate can never
 *  collide with - or be mistaken for - a sitting member's id, and so
 *  getAllRatings / getTrending / the rankings (which resolve ids against
 *  politicians.json) skip them automatically. */
export function candidateRatingId(seat: string, candidate: string): string {
  return `cand:${seat}:${candidate}`;
}

export function isCandidateRatingId(id: string): boolean {
  return id.startsWith('cand:');
}

/** Candidates in the order a reader should meet them: the Commission's own
 *  order for the ballot (contesting first), then the rest of the record.
 *  Never our own ranking - that would be a verdict. */
export const NOMINATION_ORDER: Record<string, number> = {
  contesting: 0,
  accepted: 1,
  withdrawn: 2,
  rejected: 3,
};

export function contestingOf(seat: ElectionSeat) {
  return seat.candidates.filter((c) => c.status === 'contesting');
}
