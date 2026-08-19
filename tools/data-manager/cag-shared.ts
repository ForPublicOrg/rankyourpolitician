/**
 * Pure helpers for the CAG audit-report import. No network, no filesystem, so
 * tools/data-manager/cag.regress.ts can exercise every rule offline.
 *
 * The job here is almost entirely REJECTION. The compiled index we seed from
 * mixes genuine CAG report metadata with derived, editorial entries - series
 * like "State Finances -- Bihar Part LXVII", "GovLens India Entry 990",
 * "Extended Benchmark: 51/100" - which carry a report number and a real PDF
 * link but are somebody's analysis, not the Comptroller's report. One PDF was
 * reused by 93 such rows under 93 different titles. Publishing those would put
 * a third party's scoring on a non-partisan civic site under the CAG's name,
 * so the filters below are deliberately under-inclusive: a row we cannot
 * confidently identify as a real, separately-tabled CAG report is dropped and
 * reported, never guessed at. Missing beats wrong.
 */

/** A CAG report number as the Commission writes it: "Report No. 5 of 2026",
 *  "4 of 2026", "Report No. 03 of 2026". Anything decorated beyond that - a
 *  part number, a sector suffix, a thematic label - marks a derived row. */
const CANONICAL_REPORT_NO = /^(?:report\s+no\.?\s*)?(\d{1,3})\s+of\s+((?:19|20)\d{2})$/i;

/** Markers of a derived/editorial row rather than a tabled report. Matched
 *  against the title. Kept explicit and readable rather than clever - each of
 *  these was observed in the source index. */
const SYNTHETIC_TITLE =
  /(govlens|\bpart\s+[IVXLC]{2,}\b|\bbenchmark\b|\bentry\s+\d+\b|cross-state|\bthematic\b|\bscore\s+\d+\s*\/\s*100|\bfinal (?:summary|cross-sector)|\bextended\s+(?:final|benchmark))/i;

/** Longest plausible real report title. The derived rows run to 200+ chars of
 *  semicolon-separated statistics; genuine CAG titles do not. */
const MAX_TITLE_LEN = 200;

/** Compiled-index state codes that differ from ours, or that name no single
 *  government at all. 'IN' is the Union; 'NE' is a cross-state thematic row
 *  with no government to attach it to and is dropped by returning null. */
const GOV_ALIASES: Record<string, string> = { IN: 'UN', TS: 'TG', OR: 'OD' };

/** The Union government's key. Not a state code, so it never collides. */
export const UNION_GOV = 'UN';

/**
 * Undo HTML escaping the compiled index carried over from the page it scraped:
 * one title reached us as "Report of the C&amp;AG of India". Deliberately just
 * the five XML entities and numeric references - this is a title cleaner, not
 * an HTML parser, and anything more would be inventing characters the source
 * never had.
 */
export function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    const key = ref.toLowerCase();
    if (key.startsWith('#')) {
      const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      // Control characters and anything outside the BMP-safe range stay as
      // they came: a mangled title is visible, a smuggled one is not.
      return code >= 32 && code <= 0x2fff ? String.fromCodePoint(code) : whole;
    }
    return named[key] ?? whole;
  });
}

/** Replace en/em dashes with a plain hyphen and collapse the "--" the source
 *  index uses as a separator. Keeps titles consistent with the rest of the
 *  site's copy. */
export function normalizeDashes(s: string): string {
  return s
    .replace(/[‒–—―]/g, '-')
    .replace(/\s*--\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Report No. 03 of 2026" -> "No. 3 of 2026". Returns null when the string is
 *  not a bare CAG report number, which is the primary derived-row filter. */
export function normalizeReportNo(raw: string): string | null {
  const m = CANONICAL_REPORT_NO.exec(normalizeDashes(raw || ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `No. ${n} of ${m[2]}`;
}

/** True when the title reads as a derived/editorial entry rather than a report. */
export function isSyntheticTitle(title: string): boolean {
  const t = normalizeDashes(title || '');
  return t.length === 0 || t.length > MAX_TITLE_LEN || SYNTHETIC_TITLE.test(t);
}

/**
 * Map a compiled-index state code to our government key.
 * `validStateCodes` is the set actually present in our own seed, so a state we
 * do not carry can never create an orphan page.
 */
export function govForStateCode(code: string, validStateCodes: ReadonlySet<string>): string | null {
  const raw = (code || '').trim().toUpperCase();
  if (!raw) return null;
  const mapped = GOV_ALIASES[raw] ?? raw;
  if (mapped === UNION_GOV) return UNION_GOV;
  return validStateCodes.has(mapped) ? mapped : null;
}

/** Audit period, verbatim but dash-normalised. Empty -> undefined, so a report
 *  without one simply omits the field rather than showing a blank. */
export function normalizeAuditPeriod(raw: string): string | undefined {
  const s = normalizeDashes(raw || '');
  return s.length > 0 && s.length <= 120 ? s : undefined;
}

/** Only the Comptroller's own site may appear in a citation for this dataset.
 *  `dm validate` enforces the same rule on the committed seed, so a compiler's
 *  URL cannot enter the citation slot even by hand-edit. */
export function isCagUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'cag.gov.in' || h.endsWith('.cag.gov.in');
  } catch {
    return false;
  }
}

export interface SourceFinding {
  /** The compiler's own paraphrase. Never published - see candidateExtracts. */
  text?: string;
  source?: { page?: number; section?: string; quote?: string };
}

export interface SourceRow {
  reportNo?: string;
  year?: number;
  title?: string;
  auditPeriod?: string;
  stateCode?: string;
  url?: string;
  keyFindings?: SourceFinding[];
}

/** One candidate extract, before anyone has checked it against the real PDF. */
export interface ExtractCandidate {
  gov: string;
  report_no: string;
  source_url: string;
  page: number;
  section?: string;
  quote: string;
}

/** Shortest quote worth showing, and the longest we will carry. */
const MIN_QUOTE = 40;
const MAX_QUOTE = 400;
/** Cap per report so one long report cannot dominate the page or the payload. */
const MAX_EXTRACTS_PER_REPORT = 8;

/**
 * Pull the publishable candidate extracts out of one source row.
 *
 * ONLY `source.quote` is taken - the Comptroller's own words, with the page the
 * compiler says they are on. The compiler's `text` paraphrase is deliberately
 * dropped: it is their analysis, and this site does not publish a third party's
 * characterisation of an audit finding under the CAG's name.
 *
 * Nothing here is trusted yet. A sample of these quotes checked against the real
 * PDFs came back 29/33, so every candidate must survive
 * tools/data-manager/verify-cag-extracts.py before it can reach a reader.
 */
export function candidateExtracts(row: SourceRow, report: CagReportOut): ExtractCandidate[] {
  const out: ExtractCandidate[] = [];
  const seen = new Set<string>();
  for (const f of row.keyFindings ?? []) {
    const quote = normalizeDashes(decodeEntities(f?.source?.quote ?? ''));
    const page = Number(f?.source?.page);
    if (!Number.isInteger(page) || page < 1) continue;
    if (quote.length < MIN_QUOTE || quote.length > MAX_QUOTE) continue;
    const key = quote.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const section = normalizeDashes(f?.source?.section ?? '');
    out.push({
      gov: report.gov,
      report_no: report.report_no,
      source_url: report.source_url,
      page,
      section: section.length > 0 && section.length <= 60 ? section : undefined,
      quote,
    });
    if (out.length >= MAX_EXTRACTS_PER_REPORT) break;
  }
  return out;
}

export interface CagReportOut {
  gov: string;
  report_no: string;
  year: number;
  title: string;
  source_url: string;
  source_name: string;
  retrieved_date: string;
  as_of?: string;
}

export type Rejection =
  | 'no-report-number'
  | 'derived-entry'
  | 'unknown-government'
  | 'non-cag-url'
  | 'bad-year';

/**
 * Convert one compiled-index row into a publishable record, or say why not.
 * Every rejection reason is reported by the importer so a shrinking dataset is
 * visible rather than silent.
 */
export function toCagReport(
  row: SourceRow,
  opts: { retrievedDate: string; validStateCodes: ReadonlySet<string> },
): { ok: true; report: CagReportOut } | { ok: false; reason: Rejection } {
  const report_no = normalizeReportNo(row.reportNo ?? '');
  if (!report_no) return { ok: false, reason: 'no-report-number' };

  if (isSyntheticTitle(row.title ?? '')) return { ok: false, reason: 'derived-entry' };

  const gov = govForStateCode(row.stateCode ?? '', opts.validStateCodes);
  if (!gov) return { ok: false, reason: 'unknown-government' };

  const url = (row.url ?? '').trim();
  if (!isCagUrl(url)) return { ok: false, reason: 'non-cag-url' };

  const year = Number(row.year);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) return { ok: false, reason: 'bad-year' };

  return {
    ok: true,
    report: {
      gov,
      report_no,
      year,
      title: normalizeDashes(decodeEntities(row.title ?? '')),
      source_url: url,
      source_name: 'Comptroller and Auditor General of India',
      retrieved_date: opts.retrievedDate,
      as_of: normalizeAuditPeriod(row.auditPeriod ?? ''),
    },
  };
}

/** Stable ordering: government, then newest report first, then number. Sorting
 *  is by date only - never by any judgement about the report's contents. */
export function sortReports(a: CagReportOut, b: CagReportOut): number {
  if (a.gov !== b.gov) return a.gov < b.gov ? -1 : 1;
  if (a.year !== b.year) return b.year - a.year;
  return a.report_no.localeCompare(b.report_no, 'en', { numeric: true });
}

/**
 * Dedupe key: one row per document per government.
 *
 * Keyed on the PDF, not the report number, because the source index does both
 * things wrong in opposite directions - it lists one document twice under two
 * different titles (same URL), and it gives two genuinely different documents
 * the same report number (different URLs). The document is the thing we are
 * citing, so the document is the identity.
 */
export const reportKey = (r: CagReportOut): string => `${r.gov}|${canonicalCagUrl(r.source_url)}`;

/**
 * Lift a bracket-matched array literal out of a JS bundle, starting at the `[`
 * at or after `from`. Respects strings and template literals so a bracket
 * inside a quoted finding does not end the slice early.
 */
export function sliceArrayLiteral(src: string, from: number): string | null {
  const open = src.indexOf('[', from);
  if (open < 0) return null;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * Guard for evaluating a slice of somebody else's bundle: prove the text is a
 * pure data literal before it goes anywhere near `new Function`.
 *
 * Grepping for dangerous words does not work - audit findings legitimately
 * contain "process", "import" and "requires" as prose. So walk the source
 * instead, skip over string and template contents, and require that everything
 * outside a string is literal syntax: braces, brackets, commas, colons,
 * numbers, and bare identifiers that are either a property key (followed by
 * `:`) or one of the literal keywords. A call, an operator, a variable
 * reference or a `${}` interpolation all fail.
 *
 * Returns the offending token, or null when the source is pure data.
 */
export function findNonLiteralToken(src: string): string | null {
  const LITERAL_WORDS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === quote) break;
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') return '${ interpolation';
      }
      continue;
    }
    if (/\s/.test(c) || '{}[],:'.includes(c)) continue;
    if (/[0-9+\-.]/.test(c)) {
      while (i + 1 < src.length && /[0-9a-fA-FxXeE+\-._]/.test(src[i + 1])) i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let word = '';
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) word += src[i++];
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === ':') { i = j; continue; } // property key
      if (LITERAL_WORDS.has(word)) { i--; continue; }
      return word;
    }
    return c;
  }
  return null;
}

/**
 * Find the report array in a bundle. A bundle holds many array literals, so
 * anchoring on a single field name picks the wrong one; require an element
 * shaped like a report (a report number AND a state code AND a source URL) and
 * take the largest match, which is the full index rather than a sample of it.
 */
export function findReportsLiteral(bundle: string): string | null {
  const starts = /[=:]\s*\[\{\s*id\s*:\s*["'`]/g;
  let best: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = starts.exec(bundle)) !== null) {
    const head = bundle.slice(m.index, m.index + 600);
    if (!/reportNo\s*:/.test(head) || !/\burl\s*:/.test(bundle.slice(m.index, m.index + 20000))) continue;
    const literal = sliceArrayLiteral(bundle, m.index);
    if (literal && (best === null || literal.length > best.length)) best = literal;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Reading the Commission's own listing (tools/data-manager/import-cag-live.ts)
//
// The compiled index this file was originally written for now sits behind a
// bot wall, and it was never the better source anyway: cag.gov.in publishes the
// same reports itself, with the government, the tabling date and the PDF the
// citation has to point at. Everything below parses that listing. It states
// nothing the Commission does not - a report whose number the listing does not
// carry is left out rather than numbered by us.
// ---------------------------------------------------------------------------

/**
 * CAG serves every PDF under both /uploads/... and /webroot/uploads/..., and
 * links the second form from its own listing. One document must be one row, so
 * the shorter form is the identity - the seed already used it for 744 of 746
 * rows, and the two that slipped through as /webroot/ became duplicate entries
 * on the government's audit page.
 */
export function canonicalCagUrl(url: string): string {
  const u = (url || '').trim();
  return u.replace(/^(https:\/\/(?:[a-z0-9-]+\.)*cag\.gov\.in)\/webroot\//i, '$1/');
}

/** Report numbers as the listing writes them, in the order we trust them. */
const LISTED_REPORT_NO: RegExp[] = [
  /reports?\s*no\.?\s*[-–]?\s*(\d{1,3})\s*of\s*(?:the\s*)?year\s*((?:19|20)\d{2})/i,
  /reports?\s*no\.?\s*[-–]?\s*(\d{1,3})\s*of\s*((?:19|20)\d{2})/i,
  /\breports?\s+(\d{1,3})\s*(?:of|[-–])\s*((?:19|20)\d{2})/i,
  /\bno\.?\s*(\d{1,3})\s*of\s*((?:19|20)\d{2})/i,
];

/** The same, as it survives into a PDF filename. */
const FILENAME_REPORT_NO: RegExp[] = [
  /report[-_. ]*no\.?[-_. ]*(\d{1,3})[-_. ]*of[-_. ]*((?:19|20)\d{2})/i,
  /report[-_. ]*(\d{1,3})[-_. ]*(?:english|eng)?[-_. ]*of[-_. ]*((?:19|20)\d{2})/i,
  /\b(\d{1,3})[-_. ]*of[-_. ]*((?:19|20)\d{2})\b/i,
  /\b(\d{1,3})of((?:19|20)\d{2})\b/i,
];

/** A number with no year beside it - only usable with the year the listing
 *  filter already told us, which is why it is tried last. */
const BARE_REPORT_NO = /reports?\s*no\.?\s*[-–]?\s*(\d{1,3})(?!\s*of\s*(?:19|20)\d{2})\b/i;

/**
 * The Commission's own report number for a listing row, from the title, else
 * the PDF filename, else a bare "Report No. N" paired with the year the listing
 * was filtered on. Returns null when none of those states one: roughly one row
 * in twenty (state finance and technical inspection reports, mostly), and those
 * are dropped. A report number we invented would be worse than a missing row.
 */
export function reportNoFromListing(title: string, pdfUrl: string, listedYear: number): string | null {
  const t = normalizeDashes(decodeEntities(title || ''));
  for (const re of LISTED_REPORT_NO) {
    const m = re.exec(t);
    if (m) return normalizeReportNo(`${m[1]} of ${m[2]}`);
  }
  const file = decodeURIComponent((pdfUrl || '').split('/').pop() ?? '');
  for (const re of FILENAME_REPORT_NO) {
    const m = re.exec(file);
    if (m) return normalizeReportNo(`${m[1]} of ${m[2]}`);
  }
  const bare = BARE_REPORT_NO.exec(t);
  if (bare && Number.isInteger(listedYear)) return normalizeReportNo(`${bare[1]} of ${listedYear}`);
  return null;
}

/** Audit periods exactly as CAG titles state them. Nothing is inferred: a
 *  title that does not say what period it covers simply has no as_of. */
const AUDIT_PERIOD: RegExp[] = [
  /for the (?:year|period) ended (?:on )?(\d{1,2} \w+ \d{4})/i,
  /for the (?:year|period) ended (?:on )?(\w+ \d{4})/i,
  /for the (?:year|period) (\d{4}-\d{2,4})/i,
  /for the period (\d{4}-\d{4})/i,
  /\((\d{4}-\d{2,4})\)/,
];

export function auditPeriodFromTitle(title: string): string | undefined {
  const t = normalizeDashes(decodeEntities(title || ''));
  for (const re of AUDIT_PERIOD) {
    const m = re.exec(t);
    if (m) return normalizeAuditPeriod(m[1]);
  }
  return undefined;
}

/**
 * The government a listing row belongs to, from the label CAG prints beside it
 * ("Union", "Madhya Pradesh", "Jammu and Kashmir UT (31-Oct-2019 Onwards)").
 * `names` maps a lower-cased state name to our stateCode and is built from our
 * own seed, so a government we do not carry can never create an orphan page.
 */
export function govForListingLabel(
  label: string,
  names: ReadonlyMap<string, string>,
  validStateCodes: ReadonlySet<string>,
): string | null {
  const raw = normalizeDashes(decodeEntities(label || '')).toLowerCase();
  if (!raw) return null;
  if (raw === 'union' || raw.startsWith('union government')) return UNION_GOV;
  // CAG decorates some labels with the reorganisation date they took effect on.
  const bare = raw.replace(/\s*\(.*\)\s*$/, '').replace(/\s+ut$/, '').trim();
  for (const key of [raw, bare]) {
    const code = names.get(key);
    if (code && validStateCodes.has(code)) return code;
  }
  return null;
}

/**
 * Is this listing title unusable as a title?
 *
 * NOT the same question as isSyntheticTitle. That one guards against a third
 * party's editorial rows, and its 200-character cap is part of that guard - the
 * derived series ran to 200+ characters of semicolon-separated statistics while
 * genuine titles did not. Read off cag.gov.in there are no derived rows to
 * separate, and the Commission's own Union titles legitimately run past 200
 * characters because they append the ministry and the report number to the
 * subject ("...Union Government Ministry of Communications Department of
 * Telecommunications Report No. 19 of 2026 (Performance Audit - Civil)").
 * Rejecting those would have dropped 45 real reports. So the cap here is a
 * payload bound rather than a filter, and the editorial markers are still
 * rejected in case the page ever starts carrying something else.
 */
export function isUnusableListingTitle(title: string): boolean {
  const t = normalizeDashes(decodeEntities(title || ''));
  return t.length < 12 || t.length > 400 || SYNTHETIC_TITLE.test(t);
}

/** Names CAG prints that our seed spells differently. Kept tiny and explicit -
 *  a fuzzy match here would silently file one state's audit under another. */
export const CAG_GOV_ALIASES: ReadonlyMap<string, string> = new Map([
  ['pondicherry', 'PY'],
  ['puducherry', 'PY'],
  ['nct of delhi', 'DL'],
  ['government of nct of delhi', 'DL'],
  ['orissa', 'OD'],
  ['uttaranchal', 'UK'],
  ['jammu and kashmir', 'JK'],
  ['jammu & kashmir', 'JK'],
]);
