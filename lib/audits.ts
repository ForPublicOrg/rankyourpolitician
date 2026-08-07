/**
 * The CAG audit-report index.
 *
 * RULES THIS MODULE EXISTS TO HOLD (do not relax them without reading
 * CLAUDE.md rule 3 first):
 *
 *  1. A report is attached to a GOVERNMENT, never to a person. We hold no
 *     portfolio tenure dates, so "this minister's audit" is a claim we cannot
 *     support - and an audit period that predates their appointment would make
 *     it a false one. The person page links to a government's index; it never
 *     lists reports and never shows a count.
 *  2. No severity, no score, no category, no ranking. The record carries the
 *     Comptroller's report number, title, audit period and PDF link, and
 *     nothing else. Ordering is by date only. Any "most-audited" view turns
 *     this into a scoreboard and every argument above collapses.
 *  3. Every government ships or none does. Coverage gaps read as selective
 *     attention, so `dm validate` warns on any government with no reports.
 *
 * DELIBERATELY NOT IMPORTED BY lib/data.ts. Only the /audits routes need the
 * seed, so keeping it here holds ~345 KB out of the serverless bundle of
 * /person, /area, /district, /state and every /api route (lib/data.ts is
 * imported by all of them, and next.config.mjs does not exclude data/seed from
 * output file tracing). One-shot Maps rather than the TTL cache in lib/data.ts:
 * this changes on publish, never per request.
 */
import seed from '@/data/seed/cag_reports.json';
import type { CagReport } from './types';

/** The Union government's key in `gov`. Not a state code, so it never collides. */
export const UNION_GOV = 'UN';

const reports = seed as CagReport[];

let byGov: Map<string, CagReport[]> | null = null;

function index(): Map<string, CagReport[]> {
  if (byGov) return byGov;
  const m = new Map<string, CagReport[]>();
  for (const r of reports) {
    const list = m.get(r.gov);
    if (list) list.push(r);
    else m.set(r.gov, [r]);
  }
  // Newest first, then by report number. Date only - never by anything that
  // could be read as a judgement about the report's contents.
  for (const list of m.values()) {
    list.sort((a, b) => (b.year - a.year) || a.report_no.localeCompare(b.report_no, 'en', { numeric: true }));
  }
  byGov = m;
  return m;
}

/** Every report for one government, newest first. Empty array when none. */
export function auditsForGovernment(gov: string): CagReport[] {
  return index().get(gov.toUpperCase()) ?? [];
}

/** Government keys that have at least one indexed report. */
export function auditGovernments(): string[] {
  return [...index().keys()];
}

/** Report count per government, for the hub list. */
export function auditCounts(): Map<string, number> {
  return new Map([...index()].map(([gov, list]) => [gov, list.length]));
}

/** The tabling-year range actually indexed, for the scope line. Null when the
 *  index is empty - the pages then say so rather than printing a fake range. */
export function auditYearRange(): { from: number; to: number } | null {
  if (reports.length === 0) return null;
  const years = reports.map((r) => r.year);
  return { from: Math.min(...years), to: Math.max(...years) };
}

export const auditTotal = (): number => reports.length;

/** Group one government's reports by tabling year, newest year first. */
export function auditsByYear(gov: string): { year: number; reports: CagReport[] }[] {
  const out = new Map<number, CagReport[]>();
  for (const r of auditsForGovernment(gov)) {
    const list = out.get(r.year);
    if (list) list.push(r);
    else out.set(r.year, [r]);
  }
  return [...out.entries()].sort((a, b) => b[0] - a[0]).map(([year, list]) => ({ year, reports: list }));
}

/**
 * URL segment for a government: 'un' for the Union, else the lower-cased state
 * code. Lower case because every other route segment in this app is.
 */
export const govSlug = (gov: string): string => gov.toLowerCase();

/** Inverse of govSlug, validated against the index so a junk segment 404s. */
export function govFromSlug(slug: string): string | null {
  const gov = (slug || '').toUpperCase();
  return index().has(gov) ? gov : null;
}

/**
 * Which government's audit index applies to a person, or null when none does.
 *
 * `portfolios.length > 0` is the whole test: it means this person runs a
 * department. An MP or an opposition MLA has a stateCode too, and attaching a
 * state's audit index to them would imply a responsibility they do not hold.
 *
 * Note `govScope` is left undefined for Union ministers rather than set to
 * 'union', so the state case must be tested explicitly.
 */
export function auditGovForPerson(person: {
  portfolios?: string[];
  govScope?: 'union' | 'state';
  stateCode?: string;
}): string | null {
  if (!person.portfolios?.length) return null;
  if (person.govScope === 'state') return person.stateCode ? person.stateCode.toUpperCase() : null;
  return UNION_GOV;
}
