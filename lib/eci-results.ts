// Reading the Election Commission's results microsite.
//
// At counting time ECI publishes a static microsite per election - one tiny
// (~4 KB) HTML page per constituency with the running EVM/postal totals. That
// page is the ONLY source this site will ever quote for a count: we never
// compute, project or interpolate a number, and a seat with no readable page
// shows no numbers at all rather than a zero.
//
// Used from two places, deliberately sharing one parser so the live view and
// the frozen seed result can never disagree:
//   - app/api/election-live  (runtime, during the counting window only)
//   - tools/data-manager/fetch-election-results.ts  (freezes the final table)

import type { ElectionResultRow, LiveCountSeat } from './types';

/**
 * ECI's edge (Akamai) rejects requests that do not look like a browser
 * navigation, and it is fussy about WHICH headers are present, not just the
 * User-Agent. Verified against results.eci.gov.in on 2026-08-03:
 *
 *   UA alone .......................... 403
 *   UA + Accept ....................... 403
 *   UA + Sec-Fetch-* .................. 403
 *   UA + Accept + all three Sec-Fetch-* 200  (5/5)
 *
 * So this header set is load-bearing in full. Dropping any line of it turns
 * every count on the site into "unavailable", silently and only on counting
 * day. Do not trim it.
 */
export const ECI_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Dest': 'document',
};

/** The per-constituency table view. `stateCode` is ECI's own ("S04"), `acNo`
 *  the constituency number - concatenated, never parsed back apart. */
export function constituencyResultUrl(base: string, stateCode: string, acNo: number): string {
  return `${base.replace(/\/+$/, '')}/Constituencywise${stateCode}${acNo}.htm`;
}

/** The human-facing candidate view - what we link readers to, so they can
 *  always check us against the Commission directly. */
export function constituencyCandidateUrl(base: string, stateCode: string, acNo: number): string {
  return `${base.replace(/\/+$/, '')}/candidateswise-${stateCode}${acNo}.htm`;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#039': "'",
};

function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    const key = e.toLowerCase();
    if (ENTITIES[key]) return ENTITIES[key];
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return m;
  });
}

const text = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const num = (s: string): number | null => {
  const t = s.replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

/** ECI prints NOTA as a candidate row with party "None of the Above". It is a
 *  ballot option, not a person: it is kept (voters chose it) but flagged so no
 *  UI ever ranks it, links it to a profile, or calls it a winner. */
function isNotaRow(name: string, party: string): boolean {
  return /^nota$/i.test(name.trim()) || /^none of the above$/i.test(party.trim());
}

export interface ParsedConstituency {
  /** "182 - BANKIPUR (Bihar)" as printed, for a sanity check against our seed. */
  heading?: string;
  round?: { done: number; total: number };
  rows: ElectionResultRow[];
  total_votes: number;
}

/** Narrow, safe diagnostic detail for the live API. This is intentionally
 * transport-only: it helps distinguish a blocked request from an ECI markup
 * change without exposing a response body or any visitor information. */
export interface EciFetchFailure {
  url: string;
  reason: 'http' | 'parse' | 'network';
  detail: string;
}

/**
 * Parse one `ConstituencywiseSxxNNN.htm` page.
 *
 * The table is: S.N. | Candidate | Party | EVM Votes | Postal Votes | Total
 * Votes | % of Votes. Returns null when the shape is not what we expect -
 * caller shows nothing rather than half a table, because a partially parsed
 * count is worse than no count.
 */
export function parseConstituencyResult(html: string): ParsedConstituency | null {
  const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
  if (body.length < 20) return null;

  const rows: ElectionResultRow[] = [];
  for (const tr of body.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => text(m[1]));
    if (cells.length < 7) continue;
    const [, name, party, evm, postal, total, pct] = cells;
    const evmN = num(evm);
    const postalN = num(postal);
    const totalN = num(total);
    const pctN = num(pct);
    // Every numeric cell must parse. A row where one does is a layout change,
    // not a data point - skipping it silently would understate the count.
    if (evmN == null || postalN == null || totalN == null || pctN == null) return null;
    if (!name) continue;
    const nota = isNotaRow(name, party);
    rows.push({
      name,
      party,
      evm_votes: evmN,
      postal_votes: postalN,
      total_votes: totalN,
      vote_share_pct: pctN,
      ...(nota ? { isNota: true } : {}),
    });
  }
  if (rows.length === 0) return null;

  const r = html.match(/Status of EVM Round:\s*<span>\s*(\d+)\s*<\/span>\s*\/\s*(\d+)/i);
  const h = html.match(/<h2>\s*Assembly Constituency\s*<span>([\s\S]*?)<\/span>/i);

  return {
    ...(h ? { heading: text(h[1]) } : {}),
    ...(r ? { round: { done: Number(r[1]), total: Number(r[2]) } } : {}),
    rows,
    total_votes: rows.reduce((s, x) => s + x.total_votes, 0),
  };
}

/** Fetch + parse one seat. Never throws: a null return means "we could not
 *  read the Commission right now", which the UI reports honestly. */
export async function fetchConstituencyResult(
  base: string,
  eciStateCode: string,
  acNo: number,
  timeoutMs = 4000,
  onFailure?: (failure: EciFetchFailure) => void,
): Promise<ParsedConstituency | null> {
  const url = constituencyResultUrl(base, eciStateCode, acNo);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { headers: ECI_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      onFailure?.({ url, reason: 'http', detail: `HTTP ${res.status} after ${Date.now() - startedAt}ms` });
      console.error(`[eci] ${url} -> HTTP ${res.status}`);
      return null;
    }
    const parsed = parseConstituencyResult(await res.text());
    if (!parsed) {
      onFailure?.({ url, reason: 'parse', detail: `Unrecognised results table after ${Date.now() - startedAt}ms` });
    }
    return parsed;
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : 'Request failed';
    onFailure?.({ url, reason: 'network', detail: `${detail} after ${Date.now() - startedAt}ms` });
    console.error(`[eci] ${url} failed:`, err);
    return null;
  }
}

/** Join ECI's result rows to our candidate slugs by name. ECI prints names in
 *  caps and sometimes with an alias in brackets ("SATENDRABHAI PATEL (SATISH
 *  PATEL)"), so the comparison is loose on punctuation but never fuzzy on
 *  identity - an unmatched row keeps its ECI name and simply carries no link. */
export function attachSlugs(rows: ElectionResultRow[], candidates: { slug: string; name: string }[]): ElectionResultRow[] {
  const key = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const bySlug = new Map(candidates.map((c) => [key(c.name), c.slug]));
  return rows.map((r) => {
    if (r.isNota) return r;
    const slug = bySlug.get(key(r.name));
    return slug ? { ...r, candidateSlug: slug } : r;
  });
}

/** Winner + margin from a settled table. Returns nothing when the top two are
 *  tied or the table holds no candidate rows - "missing beats wrong". */
export function winnerOf(rows: ElectionResultRow[]): { winner_slug?: string; margin?: number } {
  const real = rows.filter((r) => !r.isNota).sort((a, b) => b.total_votes - a.total_votes);
  if (real.length === 0) return {};
  if (real.length === 1) return { ...(real[0].candidateSlug ? { winner_slug: real[0].candidateSlug } : {}) };
  const margin = real[0].total_votes - real[1].total_votes;
  if (margin <= 0) return {};
  return { ...(real[0].candidateSlug ? { winner_slug: real[0].candidateSlug } : {}), margin };
}

export type { LiveCountSeat };
