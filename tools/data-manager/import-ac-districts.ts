/**
 * Data-manager step: set `districts` on every Assembly constituency (and on the
 * members holding those seats) from the Election Commission's own district ->
 * constituency tree. See ac-districts-shared.ts for why the previous
 * geo-boundary join could not do this and why the ECI tree is the right source.
 *
 * CITATION SHAPE. The claim "this seat is administered by this district" is
 * made wholesale per state from one source, so it is recorded per state - plus
 * a per-seat evidence row - in data/seed/constituency_districts.json, NOT as a
 * field on each Constituency. constituencies.json is statically imported by
 * lib/data.ts and therefore bundled into every serverless function; a per-row
 * source object would roughly double it for no reader-facing gain. The evidence
 * file is read by the data manager and by `dm validate` only, never by the site.
 *
 * SAFETY. A state is written only if its seats and the ECI's seats match 1:1
 * with nothing left over on either side (MatchReport.complete). A partial match
 * means the two lists disagree about what seats exist, and filling the rows we
 * happen to recognise would bury that. Nothing is ever matched by edit distance.
 *
 * Usage (dry run unless --apply; npm swallows the flag on Windows, so bypass it):
 *   npx tsx tools/data-manager/import-ac-districts.ts --state=AS
 *   npx tsx tools/data-manager/import-ac-districts.ts --state=AS --apply
 *   npx tsx tools/data-manager/import-ac-districts.ts --all --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Politician, Constituency, ConstituencyDistrictsFile } from '../../lib/types';
import {
  ECI_STATE_CD,
  ELECTORAL_DISTRICT_STATES,
  PC_NUMBERS,
  cleanDistrictName,
  matchPcs,
  matchState,
  splitDistricts,
  type EciAcRow,
  type SeatLike,
} from './ac-districts-shared';

const ROOT = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
  '..',
);
const SEED_DIR = resolve(ROOT, 'data', 'seed');
const EVIDENCE = resolve(SEED_DIR, 'constituency_districts.json');
const API = 'https://gateway-voters.eci.gov.in/api/v1/common';
const TODAY = new Date().toISOString().slice(0, 10);

// The portal's own headers. The ECI edge rejects a bare fetch (see
// lib/eci-results.ts, which learned the same lesson on the results host).
const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://voters.eci.gov.in',
  Referer: 'https://voters.eci.gov.in/',
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const STATES = args
  .filter((a) => a.startsWith('--state='))
  .flatMap((a) => a.slice('--state='.length).split(','))
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, tries = 4): Promise<T | null> {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
      if (res.ok) return (await res.json()) as T;
      console.warn(`  ! ${url} -> HTTP ${res.status} (attempt ${attempt + 1}/${tries})`);
    } catch (err) {
      console.warn(`  ! ${url} -> ${(err as Error).message} (attempt ${attempt + 1}/${tries})`);
    }
    await sleep(900 * (attempt + 1));
  }
  return null;
}

interface EciDistrict { districtCd: string; districtNo: string; districtValue: string }
interface EciAc { asmblyNo: number; asmblyName: string; pcNo: string }

/** The ECI's whole district -> AC tree for one state, flattened. */
async function fetchStateTree(eciStateCd: string): Promise<EciAcRow[] | null> {
  const districts = await getJson<EciDistrict[]>(`${API}/districts/${eciStateCd}`);
  if (!districts?.length) return null;
  const rows: EciAcRow[] = [];
  for (const d of districts) {
    const acs = await getJson<EciAc[]>(`${API}/acs/${d.districtCd}`);
    await sleep(250); // be polite to the Commission's edge
    if (!acs) return null; // a hole would look like a missing seat - fail the state instead
    for (const a of acs) {
      rows.push({
        stateCd: eciStateCd,
        districtCd: d.districtCd,
        district: d.districtValue,
        acNo: a.asmblyNo,
        ac: a.asmblyName,
        pcNo: a.pcNo,
      });
    }
  }
  return rows;
}

function loadEvidence(): ConstituencyDistrictsFile {
  if (!existsSync(EVIDENCE)) {
    return { generated_by: 'tools/data-manager/import-ac-districts.ts', states: {} };
  }
  return JSON.parse(readFileSync(EVIDENCE, 'utf8')) as ConstituencyDistrictsFile;
}

async function main() {
  if (!ALL && STATES.length === 0) {
    console.error('Usage: import-ac-districts --state=AS [--state=KL] [--apply]   (or --all)');
    process.exit(1);
  }

  const politicians: Politician[] = JSON.parse(
    readFileSync(resolve(SEED_DIR, 'politicians.json'), 'utf8'),
  );
  const constituencies: Constituency[] = JSON.parse(
    readFileSync(resolve(SEED_DIR, 'constituencies.json'), 'utf8'),
  );
  const evidence = loadEvidence();

  const targets = ALL ? Object.keys(ECI_STATE_CD) : STATES;
  let totalFill = 0;
  let totalRealign = 0;
  let wroteAny = false;

  for (const stateCode of targets) {
    const eciStateCd = ECI_STATE_CD[stateCode];
    if (!eciStateCd) {
      console.log(`\n${stateCode}: SKIP - no ECI state code mapped`);
      continue;
    }
    const seats: SeatLike[] = constituencies.filter(
      (c) => c.stateCode === stateCode && c.type === 'AC',
    );
    if (seats.length === 0) {
      console.log(`\n${stateCode}: SKIP - no AC seats in the seed`);
      continue;
    }
    if (ELECTORAL_DISTRICT_STATES.has(stateCode)) {
      console.log(
        `\n${stateCode}: REFUSED - the ECI's roll "districts" here are electoral, not revenue ` +
          'districts (no Collector/SP), so they would break the escalation ladder. Needs a ' +
          'revenue-district source before this state can be imported.',
      );
      continue;
    }

    console.log(`\n=== ${stateCode} (ECI ${eciStateCd}) - ${seats.length} seats in the seed`);
    const rows = await fetchStateTree(eciStateCd);
    if (!rows) {
      console.log(`${stateCode}: FETCH FAILED - nothing written`);
      continue;
    }
    const report = matchState(stateCode, seats, rows);
    const fills = report.matches.filter((m) => m.action === 'fill');
    const realigns = report.matches.filter((m) => m.action === 'realign');
    const unchanged = report.matches.filter((m) => m.action === 'unchanged');
    const districtCount = new Set(report.matches.map((m) => m.district)).size;

    console.log(
      `ECI: ${rows.length} seats across ${new Set(rows.map((r) => r.districtCd)).size} districts`,
    );
    console.log(
      `matched ${report.matches.length}/${seats.length} ` +
        `(${report.matches.filter((m) => m.via === 'alias').length} via reviewed alias) - ` +
        `fill ${fills.length}, re-align ${realigns.length}, unchanged ${unchanged.length}`,
    );

    if (!report.complete) {
      console.log(`${stateCode}: REFUSED - seed and ECI seat lists do not match 1:1.`);
      for (const s of report.unmatchedSeats) console.log(`  seed seat with no ECI match: "${s.name}"`);
      for (const a of report.ambiguous) {
        console.log(`  ambiguous: "${a.seat.name}" -> ${a.candidates.map((c) => `${c.acNo} ${c.ac}`).join(' | ')}`);
      }
      for (const r of report.unclaimedEci.sort((a, b) => a.acNo - b.acNo)) {
        console.log(`  ECI seat no seed seat claimed: ${r.acNo} ${r.ac} [${cleanDistrictName(r.district, stateCode)}]`);
      }
      console.log('  Nothing written for this state. Add the missing pair to SEAT_ALIASES, or fix the roster.');
      continue;
    }

    // A split would put one district on two /district pages, each holding half
    // its representatives - the exact failure this importer exists to prevent.
    // Checked against every district this state would end up with, including
    // the ones only a parliamentary seat reaches.
    const splits = splitDistricts(report.matches.map((m) => m.district));
    if (splits.length) {
      console.log(`${stateCode}: REFUSED - one district would be spelled two ways:`);
      for (const s of splits) console.log(`  ${s.join('  vs  ')}`);
      continue;
    }

    for (const m of realigns) {
      console.log(`  re-align ${m.seat.name}: ${m.seat.districts.join('/')} -> ${m.district}`);
    }
    for (const m of fills) console.log(`  fill     ${m.seat.name}: ${m.district}`);
    console.log(`  ${districtCount} districts after this change`);

    // Parliamentary seats: districts are the union of the PC's ACs' districts.
    const pcSeats: SeatLike[] = constituencies.filter(
      (c) => c.stateCode === stateCode && c.type === 'PC',
    );
    const pcReport = matchPcs(stateCode, pcSeats, rows);
    if (pcSeats.length === 0) {
      // nothing to do
    } else if (!PC_NUMBERS[stateCode]) {
      console.log(`  PCs: SKIPPED - no cited PC numbering for ${stateCode} (add one to PC_NUMBERS)`);
    } else if (!pcReport.complete) {
      console.log('  PCs: REFUSED - seed PCs and the cited numbering do not match 1:1.');
      for (const s of pcReport.unmatchedSeats) console.log(`    seed PC with no numbered match: "${s.name}"`);
      for (const n of pcReport.unclaimedNumbers) console.log(`    PC ${n} (${PC_NUMBERS[stateCode].names[n]}) unclaimed`);
    } else {
      for (const m of pcReport.matches.filter((x) => x.action !== 'unchanged')) {
        console.log(`  PC ${m.action === 'fill' ? 'fill    ' : 're-align'} ${m.seat.name} (${m.pcNo}): ${m.districts.join(', ')}`);
      }
    }

    totalFill += fills.length + (pcReport.complete ? pcReport.matches.filter((m) => m.action === 'fill').length : 0);
    totalRealign += realigns.length + (pcReport.complete ? pcReport.matches.filter((m) => m.action === 'realign').length : 0);
    if (!APPLY) continue;

    const districtBySeatId = new Map<string, string[]>(
      report.matches.map((m) => [m.seat.id, [m.district]]),
    );
    if (pcReport.complete) {
      for (const m of pcReport.matches) districtBySeatId.set(m.seat.id, m.districts);
    }
    for (const c of constituencies) {
      const d = c.stateCode === stateCode ? districtBySeatId.get(c.id) : undefined;
      if (d) c.districts = d;
    }
    for (const p of politicians) {
      const d = p.stateCode === stateCode ? districtBySeatId.get(p.constituencyId ?? '') : undefined;
      if (d) p.districts = d;
    }
    evidence.states[stateCode] = {
      eciStateCd,
      source_url: `${API}/districts/${eciStateCd}`,
      source_name:
        'Election Commission of India - Voter Services Portal, electoral-roll district and ' +
        'constituency lists',
      retrieved_date: TODAY,
      ac_count: report.matches.length,
      district_count: districtCount,
      seats: report.matches
        .slice()
        .sort((a, b) => a.eci.acNo - b.eci.acNo)
        .map((m) => ({
          constituencyId: m.seat.id,
          acNo: m.eci.acNo,
          eciAcName: m.eci.ac,
          eciDistrictCd: m.eci.districtCd,
          eciDistrictName: m.eci.district.replace(/\s+/g, ' ').trim(),
          district: m.district,
          matchedBy: m.via,
          // Per-seat verification: this URL returns this district's seats.
          source_url: `${API}/acs/${m.eci.districtCd}`,
        })),
      ...(pcReport.complete
        ? {
            parliamentary: {
              source_url: PC_NUMBERS[stateCode].source_url,
              source_name: PC_NUMBERS[stateCode].source_name,
              retrieved_date: TODAY,
              seats: pcReport.matches
                .slice()
                .sort((a, b) => a.pcNo - b.pcNo)
                .map((m) => ({
                  constituencyId: m.seat.id,
                  pcNo: m.pcNo,
                  pcName: PC_NUMBERS[stateCode].names[m.pcNo],
                  districts: m.districts,
                })),
            },
          }
        : {}),
    };
    wroteAny = true;
  }

  console.log(
    `\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${totalFill} seat(s) filled, ${totalRealign} re-aligned.`,
  );
  if (!APPLY) {
    console.log('Re-run with --apply to write (bypass npm on Windows: npx tsx tools/data-manager/import-ac-districts.ts ...).');
    return;
  }
  if (!wroteAny) {
    console.log('Nothing written.');
    return;
  }
  constituencies.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  writeFileSync(resolve(SEED_DIR, 'constituencies.json'), JSON.stringify(constituencies, null, 2) + '\n');
  writeFileSync(resolve(SEED_DIR, 'politicians.json'), JSON.stringify(politicians, null, 2) + '\n');
  writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  console.log('✓ constituencies.json, politicians.json, constituency_districts.json');
  console.log('Next: npm run dm -- validate   then   npm run dm -- rebuild-indexes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
