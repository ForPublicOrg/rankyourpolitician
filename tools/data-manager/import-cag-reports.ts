/**
 * Data-manager step: build data/seed/cag_reports.json - an index of published
 * Comptroller and Auditor General reports, one row per report, attached to the
 * GOVERNMENT it audits (the Union, or a state/UT) and never to a person.
 *
 * WHAT THIS IS AND IS NOT
 * The report metadata is seeded from a publicly compiled index
 * (andhbhakt.org), which is used ONLY to discover which reports exist and
 * where their PDFs sit on the Commission's own site. Nothing that index adds
 * on top of the Commission's record travels with the data: not its severity
 * labels, not its 0-100 scores, not its category taxonomy, not its ministry
 * attribution, not its prose summaries. Every citation this writes points at
 * cag.gov.in, and `dm validate` fails on any row that does not - so a
 * compiler's URL cannot reach a reader even by hand-edit.
 *
 * That index also mixes derived, editorial entries in with the real reports
 * ("GovLens India Entry 990", "State Finances - Bihar Part LXVII", "Extended
 * Benchmark: 51/100"); one PDF was reused by 93 of them under 93 titles. Those
 * are rejected by tools/data-manager/cag-shared.ts and counted in the run
 * report. The filters are under-inclusive on purpose.
 *
 * NON-PARTISAN COMPLETENESS
 * The run REFUSES to write unless every government in our own seed is covered
 * (the Union plus all 31 states/UTs). Partial coverage is the failure mode that
 * matters here: a section that exists for some states and not others reads as
 * selective attention, whichever way the gap happens to fall. All or nothing.
 *
 * Dry run by default; --apply writes.
 *
 * Usage:
 *   npx tsx tools/data-manager/import-cag-reports.ts [--apply] [--src=<url|file>]
 *   (npm swallows --apply on Windows - call tsx directly)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import type { StateGovernment } from '../../lib/types';
import {
  toCagReport,
  sortReports,
  reportKey,
  findReportsLiteral,
  findNonLiteralToken,
  candidateExtracts,
  UNION_GOV,
  type CagReportOut,
  type SourceRow,
  type Rejection,
  type ExtractCandidate,
} from './cag-shared';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SEED_DIR = resolve(ROOT, 'data', 'seed');
const OUT = resolve(SEED_DIR, 'cag_reports.json');
const TODAY = new Date().toISOString().slice(0, 10);

const DEFAULT_SRC = 'https://andhbhakt.org';

const CACHE_DIR = resolve(ROOT, 'tools', 'data-manager', '.cache');
const LINK_CACHE = resolve(CACHE_DIR, 'cag-links.json');
// Candidate quoted findings, for tools/data-manager/verify-cag-extracts.py to
// check against the real PDFs. Not a seed file - nothing here is publishable
// until it has been verified.
const EXTRACT_CANDIDATES = resolve(CACHE_DIR, 'cag-extract-candidates.json');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_LINK_CHECK = args.includes('--skip-link-check');
const srcArg = args.find((a) => a.startsWith('--src='))?.slice('--src='.length) ?? DEFAULT_SRC;

/** Government sites reject bare fetches; send a full browser header set. */
const HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: '*/*',
  'accept-language': 'en-IN,en;q=0.9',
};

async function getText(url: string, tries = 3): Promise<string> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === tries) throw err;
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  throw new Error('unreachable');
}

/** Pull the report array out of the compiled index (or a local file copy). */
async function loadSourceRows(src: string): Promise<SourceRow[]> {
  let bundle: string;
  if (/^https?:/i.test(src)) {
    const html = await getText(src);
    const asset = /src="([^"]*\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    if (!asset) throw new Error(`could not find the bundle script tag at ${src}`);
    const bundleUrl = new URL(asset, src).toString();
    console.log(`  bundle: ${bundleUrl}`);
    bundle = await getText(bundleUrl);
  } else {
    bundle = readFileSync(resolve(src), 'utf8');
  }

  const literal = findReportsLiteral(bundle);
  if (!literal) throw new Error('report array not found in the source bundle - the index changed shape');
  // Prove the slice is pure data before evaluating it (see findNonLiteralToken).
  const bad = findNonLiteralToken(literal);
  if (bad) throw new Error(`source literal is not pure data (found ${JSON.stringify(bad)}) - refusing to evaluate`);
  const rows = new Function(`return ${literal}`)() as SourceRow[];
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('source literal did not yield rows');
  return rows;
}

/**
 * Confirm each PDF actually exists on cag.gov.in.
 *
 * This is the step that makes the dataset ours rather than the compiler's. The
 * source index carries two URL shapes: the Commission's real upload paths,
 * which end in a content hash ("-069aac91b5a7e34.13549710.pdf"), and tidy
 * human-readable ones ("Report-No.-4-of-2025-Samagra-Shiksha-AP.pdf"). Sampled,
 * the hashed ones resolved 24/24 and the tidy ones 12/24 - the rest are 404s.
 * So roughly half the tidy links were never real documents, and a citation that
 * 404s is not a citation. Every link is checked and the dead ones are dropped.
 *
 * Results are cached under tools/data-manager/.cache/ (gitignored) so a re-run
 * does not re-hit the Commission for links it has already confirmed.
 */
async function verifyLinks(urls: string[]): Promise<Map<string, boolean>> {
  const cache: Record<string, boolean> = existsSync(LINK_CACHE)
    ? JSON.parse(readFileSync(LINK_CACHE, 'utf8'))
    : {};
  const todo = urls.filter((u) => cache[u] === undefined);
  console.log(`  link check: ${urls.length} distinct PDFs (${urls.length - todo.length} cached, ${todo.length} to fetch)`);

  const CONCURRENCY = 6;
  let done = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const states = await Promise.all(
      batch.map(async (u) => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const res = await fetch(u, { method: 'HEAD', headers: HEADERS, redirect: 'follow' });
            // Some hosts refuse HEAD but serve GET; treat 405/501 as "ask again".
            if (res.status === 405 || res.status === 501) {
              const get = await fetch(u, { headers: { ...HEADERS, range: 'bytes=0-0' }, redirect: 'follow' });
              return get.ok || get.status === 206;
            }
            if (res.status >= 500 && attempt === 1) throw new Error(`HTTP ${res.status}`);
            return res.ok;
          } catch {
            if (attempt === 2) return false;
            await new Promise((r) => setTimeout(r, 800));
          }
        }
        return false;
      }),
    );
    batch.forEach((u, k) => { cache[u] = states[k]; });
    done += batch.length;
    if (done % 60 === 0 || done === todo.length) process.stdout.write(`\r    checked ${done}/${todo.length}`);
  }
  if (todo.length) process.stdout.write('\n');

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(LINK_CACHE, JSON.stringify(cache, null, 2) + '\n');
  return new Map(urls.map((u) => [u, cache[u] === true]));
}

/**
 * The governments we must cover: the Union, plus every state/UT that has its
 * own Council of Ministers in our seed. UTs without a legislature (Andaman,
 * Chandigarh, Ladakh and the like) are audited under the Union, so they are
 * not separate governments here and requiring a page for them would guarantee
 * a failure that means nothing.
 */
function requiredGovernments(): { stateCodes: Set<string>; all: Set<string> } {
  const govs = JSON.parse(readFileSync(resolve(SEED_DIR, 'state_government.json'), 'utf8')) as StateGovernment[];
  const stateCodes = new Set(govs.map((g) => g.stateCode).filter(Boolean));
  return { stateCodes, all: new Set([UNION_GOV, ...stateCodes]) };
}

async function main() {
  console.log(`CAG report index - ${APPLY ? 'APPLY' : 'dry run'}`);
  console.log(`  source: ${srcArg}`);

  const { stateCodes, all: required } = requiredGovernments();
  console.log(`  governments required: ${required.size} (Union + ${stateCodes.size} states/UTs)`);

  const rows = await loadSourceRows(srcArg);
  console.log(`  source rows: ${rows.length}`);

  const rejected: Record<Rejection, number> = {
    'no-report-number': 0,
    'derived-entry': 0,
    'unknown-government': 0,
    'non-cag-url': 0,
    'bad-year': 0,
  };
  const seen = new Set<string>();
  const reports: CagReportOut[] = [];
  const candidates: ExtractCandidate[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const res = toCagReport(row, { retrievedDate: TODAY, validStateCodes: stateCodes });
    if (!res.ok) {
      rejected[res.reason]++;
      continue;
    }
    const key = reportKey(res.report);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    reports.push(res.report);
    candidates.push(...candidateExtracts(row, res.report));
  }
  reports.sort(sortReports);

  console.log(`\n  parsed: ${reports.length}`);
  console.log(`  dropped as duplicates: ${duplicates}`);
  for (const [reason, n] of Object.entries(rejected)) if (n) console.log(`  dropped (${reason}): ${n}`);

  let live = reports;
  if (SKIP_LINK_CHECK) {
    console.log('\n  ⚠ link check skipped - the seed may cite PDFs that no longer exist');
  } else {
    console.log('');
    const alive = await verifyLinks([...new Set(reports.map((r) => r.source_url))]);
    live = reports.filter((r) => alive.get(r.source_url));
    console.log(`  dropped (dead link): ${reports.length - live.length}`);
  }
  console.log(`\n  kept: ${live.length}`);

  const byGov = new Map<string, number>();
  for (const r of live) byGov.set(r.gov, (byGov.get(r.gov) ?? 0) + 1);
  const missing = [...required].filter((g) => !byGov.has(g)).sort();

  console.log(`\n  governments covered: ${byGov.size}/${required.size}`);
  const years = live.map((r) => r.year);
  console.log(`  tabled between ${Math.min(...years)} and ${Math.max(...years)}`);

  if (missing.length > 0) {
    console.error(
      `\n✗ No report for: ${missing.join(', ')}.\n` +
        '  Refusing to write. Publishing an audit index that covers some governments\n' +
        '  and not others reads as selective attention - it ships complete or not at all.',
    );
    process.exit(1);
  }

  const json = JSON.stringify(live, null, 2) + '\n';
  console.log(`  seed size: ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`);

  if (!APPLY) {
    const sample = live.slice(0, 3);
    console.log('\n  sample:');
    for (const r of sample) console.log(`    ${r.gov} ${r.report_no} (${r.year}) - ${r.title.slice(0, 80)}`);
    console.log(`\n  Dry run. Re-run with --apply to write ${existsSync(OUT) ? 'over ' : ''}data/seed/cag_reports.json`);
    return;
  }

  writeFileSync(OUT, json);

  // Candidate quoted findings for the PDF verifier. Cache, not seed: none of
  // this is publishable until verify-cag-extracts.py has found each quote in
  // the actual report.
  const liveUrls = new Set(live.map((r) => r.source_url));
  const liveCandidates = candidates.filter((c) => liveUrls.has(c.source_url));
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(EXTRACT_CANDIDATES, JSON.stringify(liveCandidates, null, 1) + '\n');

  console.log(`\n✓ Wrote ${live.length} reports to data/seed/cag_reports.json`);
  console.log(`  ${liveCandidates.length} candidate extracts -> .cache/cag-extract-candidates.json`);
  console.log('  Next: python tools/data-manager/verify-cag-extracts.py --apply');
  console.log('        npx tsx tools/data-manager/cli.ts validate');
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
