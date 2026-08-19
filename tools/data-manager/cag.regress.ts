/**
 * Regression suite for the CAG report import (cag-shared.ts).
 *
 * The failure this guards against is not a crash. It is publishing somebody's
 * editorial analysis under the Comptroller's name, or citing a PDF that does
 * not exist, or letting a compiler's URL into a citation slot. Every fixture
 * below is a real row shape observed in the source index, and most of the
 * assertions assert a REFUSAL.
 *
 * Offline: no network, no filesystem.
 *
 * Usage:  npx tsx tools/data-manager/cag.regress.ts
 */
import {
  decodeEntities,
  normalizeDashes,
  normalizeReportNo,
  isSyntheticTitle,
  govForStateCode,
  normalizeAuditPeriod,
  isCagUrl,
  toCagReport,
  sortReports,
  reportKey,
  findNonLiteralToken,
  findReportsLiteral,
  canonicalCagUrl,
  reportNoFromListing,
  auditPeriodFromTitle,
  govForListingLabel,
  isUnusableListingTitle,
  CAG_GOV_ALIASES,
  UNION_GOV,
} from './cag-shared';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else console.log('ok:', msg);
}

const STATES = new Set(['AP', 'AS', 'BR', 'KA', 'MP', 'TG', 'OD', 'UP', 'WB']);
const opts = { retrievedDate: '2026-08-08', validStateCodes: STATES };

// ---- report numbers -------------------------------------------------------
assert(normalizeReportNo('Report No. 5 of 2026') === 'No. 5 of 2026', 'canonical "Report No. N of YYYY"');
assert(normalizeReportNo('4 of 2026') === 'No. 4 of 2026', 'bare "N of YYYY"');
assert(normalizeReportNo('Report No. 03 of 2026') === 'No. 3 of 2026', 'leading zero stripped');
assert(normalizeReportNo('REPORT NO 17  of 2025') === 'No. 17 of 2025', 'case and spacing tolerated');

// The derived series carry a report number PLUS a part/sector decoration. That
// decoration is the tell, and it must not be normalised away.
assert(normalizeReportNo('Report No. 6 of 2026 (State Finances Audit Report) -- Part LXXI: Rivers/Flood/Kosi') === null,
  'decorated part-series report number rejected');
assert(normalizeReportNo('Cross-State Thematic 2025') === null, 'thematic label is not a report number');
assert(normalizeReportNo('GovLens India -- Entry 1000: The Governance Atlas') === null, 'GovLens entry rejected');
assert(normalizeReportNo('') === null, 'empty report number rejected');

// ---- derived / editorial titles -------------------------------------------
assert(isSyntheticTitle('GovLens India Entry 990 -- South vs North India Governance Divide'), 'GovLens title flagged');
assert(isSyntheticTitle('State Finances -- West Bengal Part LXXX: Industrialisation/Singur'), 'part-series title flagged');
assert(isSyntheticTitle('West Bengal Extended Benchmark: 51/100; Welfare Strengths'), 'benchmark/score title flagged');
assert(isSyntheticTitle('Thematic Comparison: Governance Deficit in North-East India'), 'cross-state title flagged');
assert(isSyntheticTitle(''), 'empty title flagged');
assert(isSyntheticTitle('x'.repeat(250)), 'over-long title flagged');
assert(!isSyntheticTitle('Performance Audit on Implementation of Jal Jeevan Mission in Madhya Pradesh'),
  'a real CAG title is not flagged');
assert(!isSyntheticTitle('State Finances Audit Report - Government of Assam (2023-24)'),
  'a real State Finances report is not flagged');

// ---- government mapping ---------------------------------------------------
assert(govForStateCode('IN', STATES) === UNION_GOV, 'IN maps to the Union');
assert(govForStateCode('TS', STATES) === 'TG', 'TS maps to our TG');
assert(govForStateCode('OR', STATES) === 'OD', 'OR maps to our OD');
assert(govForStateCode('NE', STATES) === null, 'NE (cross-state) has no government');
assert(govForStateCode('ZZ', STATES) === null, 'unknown code rejected');
assert(govForStateCode('', STATES) === null, 'empty code rejected');
assert(govForStateCode('ka', STATES) === 'KA', 'lower case tolerated');

// ---- citation host --------------------------------------------------------
assert(isCagUrl('https://cag.gov.in/uploads/download_audit_report/2025/x.pdf'), 'cag.gov.in accepted');
assert(isCagUrl('https://www.cag.gov.in/en/audit-report'), 'www.cag.gov.in accepted');
assert(!isCagUrl('https://andhbhakt.org/reports'), 'compiler URL refused');
assert(!isCagUrl('https://cag.gov.in.evil.example/x.pdf'), 'lookalike host refused');
assert(!isCagUrl('not a url'), 'garbage URL refused');

// ---- dashes and periods ---------------------------------------------------
assert(normalizeDashes('Audit -- Kerala') === 'Audit - Kerala', 'double hyphen collapsed');
assert(normalizeDashes('2019–20 to 2023–24') === '2019-20 to 2023-24', 'en dashes normalised');
assert(normalizeAuditPeriod('  ') === undefined, 'blank audit period omitted');
assert(normalizeAuditPeriod('2017-22') === '2017-22', 'audit period kept');

// ---- HTML escaping carried over from the scraped page ---------------------
assert(decodeEntities('C&amp;AG of India') === 'C&AG of India', '&amp; decoded');
assert(normalizeDashes(decodeEntities('&quot;Welfare&quot; &#8211; Phase II')) === '"Welfare" - Phase II',
  'quot and numeric ref decoded, then the dash normalised');
assert(decodeEntities('Rock &amp; Roll &notanentity; x') === 'Rock & Roll &notanentity; x', 'unknown entity left alone');
assert(decodeEntities('&#0;&#x1F600;') === '&#0;&#x1F600;', 'control chars and astral refs left alone');

// ---- end to end -----------------------------------------------------------
const good = toCagReport({
  reportNo: 'Report No. 5 of 2026', year: 2026,
  title: 'Performance Audit on Implementation of Jal Jeevan Mission in Madhya Pradesh',
  auditPeriod: '2019–20 to 2023–24', stateCode: 'MP',
  url: 'https://cag.gov.in/webroot/uploads/download_audit_report/2026/MP-JJM.pdf',
}, opts);
assert(good.ok, 'a real report is accepted');
if (good.ok) {
  assert(good.report.gov === 'MP', 'gov taken from state code');
  assert(good.report.report_no === 'No. 5 of 2026', 'report number normalised');
  assert(good.report.as_of === '2019-20 to 2023-24', 'audit period normalised');
  assert(good.report.source_name === 'Comptroller and Auditor General of India', 'source is always the CAG');
  assert(good.report.retrieved_date === '2026-08-08', 'retrieved date stamped');
  assert(!('severity' in good.report) && !('ministry' in good.report) && !('category' in good.report),
    'no severity, ministry or category travels with the record');
}

const reject = (row: Parameters<typeof toCagReport>[0], reason: string, why: string) => {
  const r = toCagReport(row, opts);
  assert(!r.ok && r.reason === reason, why);
};
const base = { reportNo: 'Report No. 5 of 2026', year: 2026, title: 'Performance Audit on X in Madhya Pradesh', stateCode: 'MP', url: 'https://cag.gov.in/a.pdf' };
reject({ ...base, reportNo: 'Cross-State Thematic 2025' }, 'no-report-number', 'thematic row rejected end to end');
reject({ ...base, title: 'GovLens India Entry 990 -- Divide' }, 'derived-entry', 'GovLens row rejected end to end');
reject({ ...base, stateCode: 'NE' }, 'unknown-government', 'cross-state row rejected end to end');
reject({ ...base, url: 'https://andhbhakt.org/reports' }, 'non-cag-url', 'compiler URL rejected end to end');
reject({ ...base, year: 1800 }, 'bad-year', 'implausible year rejected');

// ---- identity and ordering ------------------------------------------------
const a = { gov: 'MP', report_no: 'No. 5 of 2026', year: 2026, title: 'One', source_url: 'https://cag.gov.in/a.pdf', source_name: 'x', retrieved_date: '2026-08-08' };
const b = { ...a, title: 'The same report under another title' };
assert(reportKey(a) === reportKey(b), 'same PDF under one government is one record, whatever the title says');
assert(reportKey({ ...a, source_url: 'https://cag.gov.in/b.pdf' }) !== reportKey(a), 'different PDFs stay separate');

const sorted = [
  { ...a, year: 2019, report_no: 'No. 2 of 2019' },
  { ...a, year: 2026, report_no: 'No. 10 of 2026' },
  { ...a, year: 2026, report_no: 'No. 2 of 2026' },
  { ...a, gov: 'AP', year: 2020, report_no: 'No. 1 of 2020' },
].sort(sortReports);
assert(sorted[0].gov === 'AP', 'grouped by government');
assert(sorted[1].year === 2026 && sorted[3].year === 2019, 'newest year first within a government');
assert(sorted[1].report_no === 'No. 2 of 2026' && sorted[2].report_no === 'No. 10 of 2026', 'report numbers sort numerically');

// ---- bundle extraction safety ---------------------------------------------
assert(findNonLiteralToken('[{a:1,b:"x"},{a:2,b:`y`}]') === null, 'pure data literal accepted');
assert(findNonLiteralToken('[{a:1,b:"has process and import inside a string"}]') === null,
  'dangerous-looking words inside strings are fine');
assert(findNonLiteralToken('[{a:fetch("x")}]') === 'fetch', 'a call is refused');
assert(findNonLiteralToken('[{a:someVar}]') === 'someVar', 'a variable reference is refused');
assert(findNonLiteralToken('[{a:`${process.env.X}`}]') === '${ interpolation', 'template interpolation is refused');
assert(findNonLiteralToken('[{a:true},{a:null},{a:-1.5e3}]') === null, 'literal keywords and numbers accepted');

const bundle = 'var q=[1,2];const fn=[{id:"a",reportNo:"1 of 2020",url:"https://cag.gov.in/a.pdf"}];var z=[{id:"b"}];';
const lit = findReportsLiteral(bundle);
assert(lit !== null && lit.includes('reportNo'), 'report array located among other arrays');
assert(lit !== null && !lit.includes('"b"'), 'unrelated array not picked up');


// ---- reading the Commission's own listing (import-cag-live.ts) -------------
// cag.gov.in serves every PDF twice, and links the /webroot/ spelling from its
// own listing. Two rows entered the seed that way and became one document
// listed twice on a government's audit page.
const WEBROOT = 'https://cag.gov.in/webroot/uploads/download_audit_report/2026/x-069c.pdf';
const PLAIN = 'https://cag.gov.in/uploads/download_audit_report/2026/x-069c.pdf';
assert(canonicalCagUrl(WEBROOT) === PLAIN, '/webroot/ prefix collapsed to the canonical form');
assert(canonicalCagUrl(PLAIN) === PLAIN, 'canonical URL left alone');
assert(canonicalCagUrl('https://example.com/webroot/uploads/x.pdf') === 'https://example.com/webroot/uploads/x.pdf',
  'only cag.gov.in URLs are rewritten');
assert(reportKey({ ...a, gov: 'MP', source_url: WEBROOT }) === reportKey({ ...a, gov: 'MP', source_url: PLAIN }),
  'the two spellings of one document share a dedupe key');

// Report numbers, as the Commission's own listing writes them.
assert(reportNoFromListing('Report No. 3 of 2026: Report of the CAG on State Finances', '', 2026) === 'No. 3 of 2026',
  'listing title states the number');
assert(reportNoFromListing('Report No. 01 of 2026- Compliance Audit Report of Government of West Bengal', '', 2026) === 'No. 1 of 2026',
  'leading zero in a listing title');
assert(reportNoFromListing('Report of the CAG for the year ended 31 March 2025 Union Government (Commercial) No. 22 of 2026 (Compliance Audit Observations)', '', 2026) === 'No. 22 of 2026',
  'number stated late in a long Union title');
assert(reportNoFromListing('Report 4 of 2024 - Report of the CAG on Local Bodies', '', 2024) === 'No. 4 of 2024',
  'a number written without "No."');
assert(reportNoFromListing('Report No.5 of year 2024 Report on IFMIS', '', 2024) === 'No. 5 of 2024',
  '"of year YYYY" phrasing');
assert(reportNoFromListing('Report of the CAG on State Finance for the year 2024-25',
  'https://cag.gov.in/uploads/download_audit_report/2026/Mumbai-SFAR-2024-25_Report-No-1-of-2026_hyperlinked-06a5.pdf', 2026) === 'No. 1 of 2026',
  'number recovered from the PDF filename when the title omits it');
assert(reportNoFromListing('Report No.8 - Local Self-Government Institutions for the year ended March 2023', '', 2025) === 'No. 8 of 2025',
  'bare number paired with the year the listing was filtered on');
// The one that must stay missing: a title and a filename that state no number
// at all. Numbering it ourselves would be inventing the Commission's citation.
assert(reportNoFromListing('State Finances Audit Report of the CAG of India for the year ended 31 March 2023',
  'https://cag.gov.in/uploads/download_audit_report/2024/SFAR_ENGLISH_Sikkim-0669.pdf', 2024) === null,
  'no report number anywhere -> null, never guessed');

// Audit periods are copied from the title or omitted; never inferred.
assert(auditPeriodFromTitle('Compliance Audit Report for the year ended 31 March 2024') === '31 March 2024',
  'year-ended period read off the title');
assert(auditPeriodFromTitle('Report on State Finances for the year 2024-25') === '2024-25', 'financial-year period');
assert(auditPeriodFromTitle('Performance Audit on Jal Jeevan Mission in Madhya Pradesh (2019-24)') === '2019-24',
  'bracketed period');
assert(auditPeriodFromTitle('Report of the CAG on Green India Mission') === undefined,
  'a title that states no period gets no as_of');

// Government labels the listing prints.
const NAMES = new Map<string, string>([...CAG_GOV_ALIASES, ['madhya pradesh', 'MP'], ['tamil nadu', 'TN']]);
const VALID = new Set(['MP', 'TN', 'PY', 'JK', UNION_GOV]);
assert(govForListingLabel('Union', NAMES, VALID) === UNION_GOV, 'Union label');
assert(govForListingLabel('Madhya Pradesh', NAMES, VALID) === 'MP', 'state label');
assert(govForListingLabel('Pondicherry', NAMES, VALID) === 'PY', 'the Commission still writes Pondicherry');
assert(govForListingLabel('Jammu and Kashmir UT (31-Oct-2019 Onwards)', NAMES, VALID) === 'JK',
  'reorganisation date stripped off a label');
assert(govForListingLabel('Karnataka', NAMES, VALID) === null, 'a government we do not carry is refused, not guessed');
assert(govForListingLabel('', NAMES, VALID) === null, 'empty label refused');

// The first-party title check is a payload bound, NOT the derived-row filter.
// The Commission's own Union titles legitimately run past isSyntheticTitle's
// 200-character cap because they append the ministry and the report number.
const LONG_REAL_TITLE =
  'Report of the Comptroller and Auditor General of India on Performance Audit on BharatNet Union Government ' +
  'Ministry of Communications Department of Telecommunications Report No. 19 of 2026 (Performance Audit - Civil) ' +
  'for the period ended March 2024 covering the National Optical Fibre Network';
assert(LONG_REAL_TITLE.length > 200, 'fixture is longer than the compiled-index cap');
assert(!isUnusableListingTitle(LONG_REAL_TITLE), "the Commission's own long titles are kept");
assert(isSyntheticTitle(LONG_REAL_TITLE), 'and the compiled-index filter would still have dropped it');
assert(isUnusableListingTitle('x'.repeat(401)), 'past the payload bound it is refused');
assert(isUnusableListingTitle('Report'), 'a stub title is refused');
assert(isUnusableListingTitle('GovLens India Entry 990 - Governance Divide'),
  'editorial markers are still refused on the first-party path');

console.log(failed === 0 ? '\n✓ CAG import regressions passed' : `\n✗ ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
