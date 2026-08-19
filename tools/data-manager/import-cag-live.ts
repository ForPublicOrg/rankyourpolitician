/**
 * Data-manager step: index CAG audit reports from the Commission's OWN listing
 * at cag.gov.in, and merge them into data/seed/cag_reports.json.
 *
 * WHY THIS EXISTS ALONGSIDE import-cag-reports.ts
 * That step seeds from a third-party compiled index (andhbhakt.org), which is
 * now behind a bot wall and returns 403 to a plain fetch. It was never the
 * better source: cag.gov.in publishes the same reports itself, with the
 * government they audit, the date they were tabled, and the PDF our citation
 * has to point at anyway. Reading the Commission directly also removes the
 * whole class of problem that step exists to filter - there is no compiler's
 * severity, score, category or prose summary here to leak into the dataset,
 * because the Commission does not publish any.
 *
 * WHAT IT PUBLISHES - and what it refuses to
 * Report number, title, audit period and link. Nothing else, per the neutrality
 * note on CagReport. And nothing the listing does not itself state:
 *   - a row whose report number appears nowhere in its title or its PDF
 *     filename is DROPPED, not numbered by us (about one row in twenty);
 *   - a row whose government the listing does not name, and whose detail page
 *     does not name either, is DROPPED;
 *   - every PDF link is fetched before it is written, because a citation to a
 *     document that is not there is not a citation.
 *
 * FILL-ONLY. Existing rows are never removed or rewritten, except that their
 * URL is canonicalised (cag.gov.in serves every PDF under both /uploads/... and
 * /webroot/uploads/..., and the two spellings had already produced duplicate
 * rows for the same document). Removing a report is a decision for a human.
 *
 * Dry run by default; --apply writes.
 *
 * Usage:
 *   npx tsx tools/data-manager/import-cag-live.ts [--apply] [--from=2024] [--to=2026]
 *   (npm swallows --apply on Windows - call tsx directly)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import type { StateGovernment } from '../../lib/types';
import {
  canonicalCagUrl,
  reportNoFromListing,
  auditPeriodFromTitle,
  govForListingLabel,
  decodeEntities,
  normalizeDashes,
  isUnusableListingTitle,
  isCagUrl,
  sortReports,
  reportKey,
  CAG_GOV_ALIASES,
  UNION_GOV,
  type CagReportOut,
} from './cag-shared';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SEED_DIR = resolve(ROOT, 'data', 'seed');
const OUT = resolve(SEED_DIR, 'cag_reports.json');
const TODAY = new Date().toISOString().slice(0, 10);

const LISTING = 'https://cag.gov.in/en/audit-report';
const DETAIL = 'https://cag.gov.in/en/audit-report/details/';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const yearArg = (flag: string, fallback: number) => {
  const v = args.find((a) => a.startsWith(`--${flag}=`))?.slice(flag.length + 3);
  const n = Number(v);
  return Number.isInteger(n) && n >= 2001 && n <= 2100 ? n : fallback;
};
const THIS_YEAR = new Date().getFullYear();
const FROM = yearArg('from', THIS_YEAR - 2);
const TO = yearArg('to', THIS_YEAR);

/** Government sites reject bare fetches; send a full browser header set. */
const HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
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

interface ListingRow {
  detailId: string;
  govLabel: string | null;
  title: string;
  pdf: string | null;
  listedYear: number;
}

/** Pull the report rows out of one listing page. */
function parseListing(html: string, listedYear: number): ListingRow[] {
  const rows: ListingRow[] = [];
  const blocks = html.split('<div class="AuditReportlisting">').slice(1);
  for (const raw of blocks) {
    const block = raw.split('<div class="pagination')[0];
    const link = /<a href="\/en\/audit-report\/details\/(\d+)">([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    const img = /<img src="[^"]*"[^>]*title="([^"]*)"/.exec(block);
    const pdf = /<a href="([^"]*\/download_audit_report\/[^"]*)"/.exec(block);
    rows.push({
      detailId: link[1],
      govLabel: img ? decodeEntities(img[1]).trim() : null,
      title: normalizeDashes(decodeEntities(link[2].replace(/<[^>]+>/g, ' '))),
      pdf: pdf ? decodeEntities(pdf[1]) : null,
      listedYear,
    });
  }
  return rows;
}

/**
 * The government a report's own detail page names, for the rows whose listing
 * entry carries no government icon (all of them Jammu and Kashmir so far, but
 * read it rather than assume it).
 *
 * The breadcrumb reads: Go Back | <report type>... | <government> | <title>,
 * and the type segment repeats for a report tagged with more than one type
 * ("Compliance | Performance | Jammu and Kashmir UT ..."). So anchor on the
 * title, which we already know from the listing, and take the field before it.
 */
async function govLabelFromDetail(detailId: string, title: string): Promise<string | null> {
  const flatten = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const needle = flatten(title).slice(0, 40);
  if (needle.length < 10) return null;
  try {
    const html = await getText(`${DETAIL}${detailId}`);
    const fields = html
      .replace(/<[^>]+>/g, '|')
      .split('|')
      .map((f) => decodeEntities(f).replace(/\s+/g, ' ').trim())
      .filter((f) => f.length > 0);
    const at = fields.findIndex((f) => flatten(f).startsWith(needle));
    return at > 0 ? fields[at - 1] : null;
  } catch {
    return null;
  }
}

/** Does this PDF actually exist? Ranged so we read a kilobyte, not 40 MB. */
async function linkAlive(url: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { ...HEADERS, range: 'bytes=0-1024' } });
      if (res.ok || res.status === 206) {
        try { await res.arrayBuffer(); } catch { /* body already discarded */ }
        return true;
      }
      if (res.status === 404 || res.status === 403 || res.status === 302) return false;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  return false;
}

async function main() {
  console.log(`CAG report index from cag.gov.in - ${APPLY ? 'APPLY' : 'dry run'}`);
  console.log(`  report years: ${FROM}-${TO}`);

  const stateGovs = JSON.parse(readFileSync(resolve(SEED_DIR, 'state_government.json'), 'utf8')) as StateGovernment[];
  const validGovs = new Set<string>([UNION_GOV, ...stateGovs.map((g) => g.stateCode)]);
  const govNames = new Map<string, string>(CAG_GOV_ALIASES);
  for (const g of stateGovs) govNames.set(g.state.toLowerCase(), g.stateCode);

  const existing: CagReportOut[] = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, 'utf8')) as CagReportOut[])
    : [];

  // Canonicalise what is already there first. Two rows had entered under the
  // /webroot/ spelling of a URL another row already carried, which is one
  // document listed twice on that government's audit page.
  const byKey = new Map<string, CagReportOut>();
  let collapsed = 0;
  for (const r of existing) {
    const canonical = { ...r, source_url: canonicalCagUrl(r.source_url) };
    const key = reportKey(canonical);
    const prior = byKey.get(key);
    if (prior) {
      collapsed++;
      // Keep whichever row states an audit period; else the first one seen.
      if (!prior.as_of && canonical.as_of) byKey.set(key, canonical);
      console.log(`  - duplicate of one document collapsed: ${canonical.gov} ${canonical.report_no} "${canonical.title.slice(0, 60)}"`);
      continue;
    }
    byKey.set(key, canonical);
  }

  // Same document, different government. The compiled index the seed was built
  // from filed at least one state's report under the Union, and the PDF is the
  // only thing that identifies a document, so a filename we already hold under
  // another government is a conflict to report - not a second row to write.
  const govByFile = new Map<string, { gov: string; report_no: string }>();
  for (const r of byKey.values()) {
    const file = decodeURIComponent(r.source_url.split('/').pop() ?? '').toLowerCase();
    if (file) govByFile.set(file, { gov: r.gov, report_no: r.report_no });
  }

  const counts = {
    listed: 0, alreadyHeld: 0, added: 0,
    noReportNo: 0, noGov: 0, noPdf: 0, deadLink: 0, syntheticTitle: 0, nonCagUrl: 0, govConflict: 0,
  };
  const dropped: string[] = [];
  const conflicts: string[] = [];

  for (let year = TO; year >= FROM; year--) {
    const first = await getText(`${LISTING}?title=&od=%3D&yrf=${year}&yrt=`);
    const pages = Number(/Page 1 of (\d+)/.exec(first)?.[1] ?? '1');
    const total = /records out of ([\d,]+) total/.exec(first)?.[1] ?? '?';
    console.log(`\n  ${year}: ${total} reports across ${pages} page(s)`);

    const rows: ListingRow[] = parseListing(first, year);
    for (let p = 2; p <= pages; p++) {
      rows.push(...parseListing(await getText(`${LISTING}?title=&od=%3D&yrf=${year}&yrt=&page=${p}`), year));
    }
    const seenDetail = new Set<string>();

    for (const row of rows) {
      if (seenDetail.has(row.detailId)) continue;
      seenDetail.add(row.detailId);
      counts.listed++;

      if (!row.pdf) { counts.noPdf++; dropped.push(`${year} #${row.detailId} no PDF link: ${row.title.slice(0, 70)}`); continue; }
      const url = canonicalCagUrl(new URL(row.pdf, 'https://cag.gov.in').toString());
      if (!isCagUrl(url)) { counts.nonCagUrl++; dropped.push(`${year} #${row.detailId} link is not on cag.gov.in`); continue; }

      let label = row.govLabel;
      if (!label) label = await govLabelFromDetail(row.detailId, row.title);
      const gov = label ? govForListingLabel(label, govNames, validGovs) : null;
      if (!gov) { counts.noGov++; dropped.push(`${year} #${row.detailId} government not named ("${label ?? ''}"): ${row.title.slice(0, 60)}`); continue; }

      const title = normalizeDashes(decodeEntities(row.title));
      if (isUnusableListingTitle(title)) { counts.syntheticTitle++; dropped.push(`${year} #${row.detailId} unusable title`); continue; }

      const report_no = reportNoFromListing(title, url, year);
      if (!report_no) { counts.noReportNo++; dropped.push(`${year} #${row.detailId} ${gov}: listing states no report number - "${title.slice(0, 70)}"`); continue; }

      const candidate: CagReportOut = {
        gov,
        report_no,
        year: Number(/of (\d{4})$/.exec(report_no)?.[1] ?? year),
        title,
        source_url: url,
        source_name: 'Comptroller and Auditor General of India',
        retrieved_date: TODAY,
        as_of: auditPeriodFromTitle(title),
      };

      const key = reportKey(candidate);
      if (byKey.has(key)) { counts.alreadyHeld++; continue; }

      const file = decodeURIComponent(url.split('/').pop() ?? '').toLowerCase();
      const held = govByFile.get(file);
      if (held && held.gov !== gov) {
        counts.govConflict++;
        conflicts.push(`${file.slice(0, 60)} - the seed files it under ${held.gov} (${held.report_no}), cag.gov.in lists it under ${gov} (${report_no})`);
        continue;
      }
      if (held) { counts.alreadyHeld++; continue; }

      if (!(await linkAlive(url))) {
        counts.deadLink++;
        dropped.push(`${year} #${row.detailId} ${gov} ${report_no}: PDF did not resolve`);
        continue;
      }

      byKey.set(key, candidate);
      govByFile.set(file, { gov, report_no });
      counts.added++;
      console.log(`  + ${gov} ${report_no}  ${title.slice(0, 80)}`);
    }
  }

  const merged = [...byKey.values()].sort(sortReports);

  console.log('\n' + '-'.repeat(60));
  console.log(`  listed on cag.gov.in : ${counts.listed}`);
  console.log(`  already in the seed  : ${counts.alreadyHeld}`);
  console.log(`  added                : ${counts.added}`);
  console.log(`  duplicates collapsed : ${collapsed}`);
  console.log(`  dropped - no report number : ${counts.noReportNo}`);
  console.log(`  dropped - government not named : ${counts.noGov}`);
  console.log(`  dropped - no PDF link : ${counts.noPdf}`);
  console.log(`  dropped - PDF did not resolve : ${counts.deadLink}`);
  console.log(`  dropped - unusable title : ${counts.syntheticTitle}`);
  console.log(`  dropped - link off cag.gov.in : ${counts.nonCagUrl}`);
  console.log(`  held under another government : ${counts.govConflict}`);
  console.log(`  seed rows: ${existing.length} -> ${merged.length}`);

  if (dropped.length) {
    console.log('\n  DROPPED ROWS (a report we cannot state is left out, never guessed at):');
    for (const d of dropped) console.log(`    · ${d}`);
  }

  if (conflicts.length) {
    console.log(`\n  SAME DOCUMENT, DIFFERENT GOVERNMENT (fix the existing row by hand - the Commission is the authority on whose audit it is):`);
    for (const c of conflicts) console.log(`    · ${c}`);
  }

  const govsCovered = new Set(merged.map((r) => r.gov));
  const missing = [...validGovs].filter((g) => !govsCovered.has(g));
  if (missing.length) {
    console.error(`\n✗ no report indexed for: ${missing.join(', ')} - partial coverage reads as selective attention. Refusing to write.`);
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nDry run - nothing written. Re-run with --apply.');
    return;
  }
  writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log(`\n✓ wrote ${merged.length} reports to ${OUT}`);
}

main().catch((err) => {
  console.error('✗', err instanceof Error ? err.message : err);
  process.exit(1);
});
