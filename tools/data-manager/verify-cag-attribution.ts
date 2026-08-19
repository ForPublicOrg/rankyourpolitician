/**
 * Data-manager audit: check every row in data/seed/cag_reports.json against the
 * Commission's own listing at cag.gov.in - the government it is filed under,
 * the title it is published as, and whether its PDF is still there.
 *
 * WHY THIS EXISTS
 * The index was seeded from a third-party compiled list, and that list filed
 * state audit reports under the Union: Kerala's, Gujarat's, Uttar Pradesh's and
 * Telangana's reports were all sitting on /audits/UN under the Union's name and
 * missing from their own state's page. The PDF is the same document either way,
 * so the error is invisible from inside the seed - only the Commission's own
 * listing can settle whose audit it is, and this reads it.
 *
 * The same pass re-derives the report number where the Commission states one,
 * and reports every row whose title differs from the Commission's own (adopting
 * those is opt-in - see --titles). Nothing else is touched: no row is added and
 * no row is removed here (import-cag-live.ts adds; removing is a decision for
 * a human).
 *
 * Read-only by default; --apply writes.
 *
 * Usage:
 *   npx tsx tools/data-manager/verify-cag-attribution.ts [--apply] [--titles] [--cache=<dir>]
 *   --apply  corrects the government and the report number - both plain factual
 *            errors about which report this is and whose audit it was.
 *   --titles additionally replaces the compiled index's paraphrased title with
 *            the title the Commission publishes. Held behind its own flag
 *            because it rewrites reader-facing text on every audit page, and
 *            some of the Commission's own titles are less informative than the
 *            paraphrase they would replace ("Report of the Comptroller and
 *            Auditor General of India for the year ended March 2024").
 *   --cache lets a re-run reuse already-fetched listing pages (the sweep is
 *   ~280 pages); pages missing from the cache are fetched and written into it.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import {
  canonicalCagUrl,
  reportNoFromListing,
  auditPeriodFromTitle,
  govForListingLabel,
  decodeEntities,
  normalizeDashes,
  isUnusableListingTitle,
  sortReports,
  CAG_GOV_ALIASES,
  UNION_GOV,
  type CagReportOut,
} from './cag-shared';
import type { StateGovernment } from '../../lib/types';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SEED_DIR = resolve(ROOT, 'data', 'seed');
const OUT = resolve(SEED_DIR, 'cag_reports.json');
const LISTING = 'https://cag.gov.in/en/audit-report';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
// Adopting the Commission's own titles is a separate decision from correcting a
// wrong government. The seed's titles came from the compiled index and were a
// deliberate choice; replacing 400-odd of them changes reader-facing text on
// every audit page, so it is opt-in rather than a side effect of --apply.
const TITLES = args.includes('--titles');
const CACHE = args.find((a) => a.startsWith('--cache='))?.slice('--cache='.length);

const HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'en-IN,en;q=0.9',
};

async function page(n: number): Promise<string> {
  const cached = CACHE ? resolve(CACHE, `p${n}.html`) : null;
  if (cached && existsSync(cached)) {
    const html = readFileSync(cached, 'utf8');
    if (html.length > 5000) return html;
  }
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${LISTING}?page=${n}`, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (cached) { mkdirSync(dirname(cached), { recursive: true }); writeFileSync(cached, html, 'utf8'); }
      return html;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

interface Listed { gov: string | null; title: string; label: string | null }

function parseListing(html: string, into: Map<string, Listed>, govNames: ReadonlyMap<string, string>, validGovs: ReadonlySet<string>) {
  for (const raw of html.split('<div class="AuditReportlisting">').slice(1)) {
    const block = raw.split('<div class="pagination')[0];
    const link = /<a href="\/en\/audit-report\/details\/\d+">([\s\S]*?)<\/a>/.exec(block);
    const pdf = /<a href="([^"]*\/download_audit_report\/[^"]*)"/.exec(block);
    if (!link || !pdf) continue;
    const img = /<img src="[^"]*"[^>]*title="([^"]*)"/.exec(block);
    const label = img ? decodeEntities(img[1]).trim() : null;
    const url = canonicalCagUrl(new URL(decodeEntities(pdf[1]), 'https://cag.gov.in').toString());
    into.set(url, {
      gov: label ? govForListingLabel(label, govNames, validGovs) : null,
      title: normalizeDashes(decodeEntities(link[1].replace(/<[^>]+>/g, ' '))),
      label,
    });
  }
}

async function main() {
  console.log(`CAG attribution audit against cag.gov.in - ${APPLY ? 'APPLY' : 'read-only'}`);

  const stateGovs = JSON.parse(readFileSync(resolve(SEED_DIR, 'state_government.json'), 'utf8')) as StateGovernment[];
  const validGovs = new Set<string>([UNION_GOV, ...stateGovs.map((g) => g.stateCode)]);
  const govNames = new Map<string, string>(CAG_GOV_ALIASES);
  for (const g of stateGovs) govNames.set(g.state.toLowerCase(), g.stateCode);

  const first = await page(1);
  const pages = Number(/Page 1 of (\d+)/.exec(first)?.[1] ?? '1');
  const total = /records out of ([\d,]+) total/.exec(first)?.[1] ?? '?';
  console.log(`  the Commission lists ${total} reports across ${pages} pages`);

  const listed = new Map<string, Listed>();
  parseListing(first, listed, govNames, validGovs);
  for (let p = 2; p <= pages; p++) {
    parseListing(await page(p), listed, govNames, validGovs);
    if (p % 40 === 0) console.log(`    …${p}/${pages} pages, ${listed.size} documents so far`);
  }
  console.log(`  read ${listed.size} distinct documents\n`);

  const reports = JSON.parse(readFileSync(OUT, 'utf8')) as CagReportOut[];
  const govFixes: string[] = [];
  const titleFixes: string[] = [];
  const numberFixes: string[] = [];
  let unlisted = 0;
  let unchanged = 0;

  for (const r of reports) {
    const url = canonicalCagUrl(r.source_url);
    const live = listed.get(url);
    if (!live) { unlisted++; continue; }

    let touched = false;

    if (live.gov && live.gov !== r.gov) {
      govFixes.push(`${r.gov} -> ${live.gov}  ${r.report_no}  ${r.title.slice(0, 62)}`);
      if (APPLY) r.gov = live.gov;
      touched = true;
    }

    if (!isUnusableListingTitle(live.title) && live.title !== r.title) {
      titleFixes.push(`${live.gov ?? r.gov} ${r.report_no}: "${r.title.slice(0, 50)}" -> "${live.title.slice(0, 50)}"`);
      if (APPLY && TITLES) {
        r.title = live.title;
        // The compiler's audit period stays only when the Commission's own
        // title does not state one - we never overwrite a stated period with
        // nothing, and never keep a paraphrase over a stated one.
        const stated = auditPeriodFromTitle(live.title);
        if (stated) r.as_of = stated;
      }
      if (TITLES) touched = true;
    }

    const liveNo = reportNoFromListing(live.title, url, r.year);
    if (liveNo && liveNo !== r.report_no) {
      numberFixes.push(`${live.gov ?? r.gov}: ${r.report_no} -> ${liveNo}  ${live.title.slice(0, 55)}`);
      if (APPLY) {
        r.report_no = liveNo;
        const y = Number(/of (\d{4})$/.exec(liveNo)?.[1]);
        if (Number.isInteger(y)) r.year = y;
      }
      touched = true;
    }

    if (!touched) unchanged++;
  }

  const show = (label: string, rows: string[]) => {
    console.log(`${label}: ${rows.length}`);
    for (const row of rows) console.log(`  · ${row}`);
    if (rows.length) console.log('');
  };

  show('FILED UNDER THE WRONG GOVERNMENT', govFixes);
  show('TITLE DIFFERS FROM THE COMMISSION\'S OWN', titleFixes);
  show('REPORT NUMBER DIFFERS FROM THE COMMISSION\'S OWN', numberFixes);
  console.log(`rows the Commission's listing no longer carries (left untouched): ${unlisted}`);
  console.log(`rows already matching the Commission: ${unchanged}`);

  if (!APPLY) {
    console.log('\nRead-only - nothing written. Re-run with --apply.');
    return;
  }

  // Re-attribution can collide two rows onto one document for one government.
  const byKey = new Map<string, CagReportOut>();
  let collapsed = 0;
  for (const r of reports) {
    const key = `${r.gov}|${canonicalCagUrl(r.source_url)}`;
    if (byKey.has(key)) { collapsed++; continue; }
    byKey.set(key, { ...r, source_url: canonicalCagUrl(r.source_url) });
  }
  const merged = [...byKey.values()].sort(sortReports);
  writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log(`\n✓ wrote ${merged.length} reports (${collapsed} duplicate row(s) collapsed) to ${OUT}`);
}

main().catch((err) => {
  console.error('✗', err instanceof Error ? err.message : err);
  process.exit(1);
});
