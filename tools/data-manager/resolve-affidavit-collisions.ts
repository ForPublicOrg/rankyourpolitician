/**
 * Data-manager step: resolve AFFIDAVIT CITATION COLLISIONS - two members whose
 * stored affidavit facts cite the SAME MyNeta candidate page.
 *
 * A collision means one of the two carries another person's sworn declaration:
 * their assets, their liabilities, their pending criminal cases. That is the
 * worst error this site can make about a named living person, and `dm validate`
 * treats it as blocking. It happens when a name-only join fires across two
 * same-named members of one state - Sakra's "Aditya Kumar" onto Parbatta's
 * "Aditya Kumar Shorya", the case enrich-affidavits-byseat.ts documents.
 *
 * The fix is the same evidence verify-affidavits.ts uses: the cited page's own
 * breadcrumb names the seat it belongs to, and a seat cannot repeat the way a
 * name can. Whichever member's seat the page names KEEPS the facts; the other's
 * facts sourced from that page are removed, along with any criminal-case detail
 * record built from it. Nothing is re-attached and nothing is guessed - the
 * member simply loses data that was never theirs, and the next enrichment run
 * can fill it from the right page.
 *
 * Both sides are dropped when the page names neither seat (or names no seat at
 * all): with no evidence of ownership, publishing either is guessing.
 *
 * Usage:  npx tsx tools/data-manager/resolve-affidavit-collisions.ts
 *         npx tsx tools/data-manager/resolve-affidavit-collisions.ts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Politician, Fact, CriminalRecord } from '../../lib/types';
import { getHtml, clean, consKey, seatClose } from './myneta';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SEED_DIR = resolve(ROOT, 'data', 'seed');
const APPLY = process.argv.includes('--apply');

/** Facts that come from an affidavit page and must move together - a member
 *  keeping half of someone else's declaration is no better than all of it. */
const AFFIDAVIT_FIELDS = new Set(['assets_total', 'liabilities_total', 'criminal_cases_declared', 'education', 'profession', 'age']);

const isMyNeta = (url: string) => /myneta\.info\/.+candidate_id=/i.test(url || '');

// ---- the cited page's own seat (verify-affidavits.ts:pageSeat) -------------

/**
 * The breadcrumb reads "Home > Bihar 2025 > DISTRICT > SEAT > NAME (Criminal &
 * Asset Declaration)", so it carries the DISTRICT as well as the seat. The seat
 * alone is not always enough here: this dataset disambiguates seat names that
 * repeat inside one state ("Kalyanpur" and "Kalyanpur (East Champaran)" in
 * Bihar, two Bishnupurs in West Bengal), and those are exactly the pairs that
 * collide. The district is what tells them apart.
 */
function pageCrumb(html: string): { seat: string | null; district: string | null } {
  const bc = html.match(/&rarr;[\s\S]{0,600}?<\/div>/i);
  if (!bc) return { seat: null, district: null };
  const parts = clean(bc[0]).split(/&rarr;|→|>/).map((s) => s.trim()).filter(Boolean);
  const nameIdx = parts.findIndex((s) => /\(Criminal/i.test(s));
  if (nameIdx < 1) return { seat: null, district: null };
  const seat = parts[nameIdx - 1];
  return {
    seat: seat && !/Legislative Council/i.test(seat) ? seat : null,
    district: nameIdx >= 2 ? parts[nameIdx - 2] ?? null : null,
  };
}

const seatKey = (s: string) =>
  consKey(
    (s || '')
      .replace(/:\s*BYE ELECTION.*$/i, ' ')
      .replace(/\((?:sc|st|bl|gen)\)/gi, ' ')
      .replace(/\b(cantonment|cantt\.?)\b/gi, 'cant'),
  );

/** Deliberately STRICTER than verify-affidavits.seatAgrees: that function has to
 *  tolerate spelling drift across the whole dataset, but here the two candidates
 *  are known to be confusable, so a loose prefix rule could hand the page to the
 *  wrong one. Exact key, or seatClose (which compares trailing seat numbers
 *  exactly), and nothing else. */
function seatIsOurs(pageSeatName: string | null, ourSeat: string): boolean {
  if (!pageSeatName || !ourSeat) return false;
  const a = seatKey(pageSeatName);
  const b = seatKey(ourSeat.replace(/\s*\([^)]*\)\s*$/, '')); // roster's district qualifier
  if (!a || !b) return false;
  return a === b || seatClose(a, b);
}

/**
 * District keys, with the compass word folded to a single letter.
 *
 * MyNeta prints Bihar's East Champaran as "PURVI CHAMPARAN" and our roster
 * calls it "East Champaran" - the same district, named in Hindi on one side and
 * English on the other. These four pairs are the standard Hindi directions and
 * are the only translation done here; nothing else about the name is touched, so
 * two genuinely different districts can never be folded together.
 */
const DIRECTION = /\b(purvi|purba|poorvi|poorab|east|pashchim|paschim|pachim|west|uttar|uttara|north|dakshin|dakshina|dakshini|south)\b/g;
const CANON: Record<string, string> = {
  purvi: 'e', purba: 'e', poorvi: 'e', poorab: 'e', east: 'e',
  pashchim: 'w', paschim: 'w', pachim: 'w', west: 'w',
  uttar: 'n', uttara: 'n', north: 'n',
  dakshin: 's', dakshina: 's', dakshini: 's', south: 's',
};
const districtKey = (s: string) => consKey((s || '').toLowerCase().replace(DIRECTION, (m) => CANON[m] ?? m));

/** Does the page's breadcrumb district name one of this member's districts?
 *  Only ever used to break a tie between two members whose SEAT both matched. */
function districtIsOurs(pageDistrict: string | null, p: Politician): boolean {
  if (!pageDistrict) return false;
  const d = districtKey(pageDistrict);
  if (!d) return false;
  // The roster's disambiguating qualifier is itself the district, so check it
  // as well as the districts array - either naming the same place is enough.
  const qualifier = (p.constituencyName.match(/\(([^)]*)\)\s*$/) || [])[1] ?? '';
  return [...p.districts, qualifier].some((x) => {
    const k = districtKey(x || '');
    return !!k && (k === d || k.startsWith(d) || d.startsWith(k));
  });
}

// ---- main ------------------------------------------------------------------

async function main() {
  const polPath = resolve(SEED_DIR, 'politicians.json');
  const casePath = resolve(SEED_DIR, 'criminal_cases.json');
  const polRaw = readFileSync(polPath, 'utf8');
  const caseRaw = readFileSync(casePath, 'utf8');
  const pols: Politician[] = JSON.parse(polRaw);
  const cases: CriminalRecord[] = JSON.parse(caseRaw);

  // Group members by the affidavit page they cite. >1 member on a page is the
  // collision `dm validate` refuses to publish.
  const byUrl = new Map<string, Politician[]>();
  for (const p of pols) {
    const urls = new Set(
      (p.facts as Fact[]).filter((f) => AFFIDAVIT_FIELDS.has(f.field_type) && isMyNeta(f.source_url)).map((f) => f.source_url),
    );
    for (const u of urls) byUrl.set(u, [...(byUrl.get(u) ?? []), p]);
  }
  const collisions = [...byUrl].filter(([, ps]) => ps.length > 1);

  if (!collisions.length) {
    console.log('No affidavit citation collisions. Nothing to do.');
    return;
  }
  console.log(`${collisions.length} collision(s) - fetching each cited page for its breadcrumb seat.\n`);

  const strip: { p: Politician; url: string; why: string }[] = [];

  for (const [url, members] of collisions) {
    const html = await getHtml(url);
    const { seat, district } = html ? pageCrumb(html) : { seat: null, district: null };
    console.log(`${url}`);
    console.log(`  page breadcrumb: seat "${seat ?? '(none)'}", district "${district ?? '(none)'}"`);

    let owners = members.filter((p) => seatIsOurs(seat, p.constituencyName));
    // Both matched the seat because the seat name repeats in this state. The
    // breadcrumb's district is the tiebreak - and only a tiebreak, never a way
    // to claim a page whose seat did not match in the first place.
    if (owners.length > 1) {
      const byDistrict = owners.filter((p) => districtIsOurs(district, p));
      if (byDistrict.length === 1) {
        console.log(`  seat name repeats in ${owners[0].stateCode}; district "${district}" resolves it`);
        owners = byDistrict;
      }
    }
    for (const p of members) {
      const mine = owners.includes(p);
      console.log(`   ${mine && owners.length === 1 ? '✓ keeps' : '✗ strip'}  ${p.id}  (${p.name}, ${p.stateCode} ${p.constituencyName} [${p.districts.join('/') || 'no district'}])`);
    }
    if (owners.length === 1) {
      for (const p of members) if (p !== owners[0]) strip.push({ p, url, why: `page belongs to ${owners[0].constituencyName}` });
    } else {
      // Nobody, or somehow both. Either way the page does not identify one of
      // them, so neither may publish it.
      const why = owners.length === 0 ? `page seat "${seat ?? 'unknown'}" matches neither member` : 'page seat matches both members';
      for (const p of members) strip.push({ p, url, why });
      console.log(`  -> ${why}: dropping from both (missing beats wrong)`);
    }
    console.log('');
  }

  // ---- apply ---------------------------------------------------------------

  const strippedIds = new Set<string>();
  let factCount = 0;
  for (const { p, url, why } of strip) {
    const before = p.facts.length;
    p.facts = (p.facts as Fact[]).filter((f) => !(AFFIDAVIT_FIELDS.has(f.field_type) && f.source_url === url));
    const removed = before - p.facts.length;
    factCount += removed;
    if (removed) strippedIds.add(p.id);
    console.log(`- ${p.id}: removed ${removed} fact(s) sourced from ${url}\n    ${why}`);
  }

  // Case detail is built FROM the affidavit page, so a record whose owner just
  // lost that citation is the same wrong person's data in another file.
  const casesBefore = cases.length;
  const keptCases = cases.filter((r) => !(strippedIds.has(r.politician_id) && isMyNeta(r.source_url ?? '')));
  const casesRemoved = casesBefore - keptCases.length;

  console.log(`\n${factCount} fact(s) removed from ${strippedIds.size} member(s); ${casesRemoved} criminal-case record(s) removed.`);
  console.log('These members now have NO affidavit data, which is correct - they had someone else\'s.');
  console.log('Re-run the seat-anchored enricher to fill them from the right page:');
  console.log('  npx tsx tools/data-manager/enrich-affidavits-byseat.ts --apply');

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.');
    return;
  }
  const write = (path: string, data: unknown, wasCrlf: boolean) => {
    const text = JSON.stringify(data, null, 2) + '\n';
    writeFileSync(path, wasCrlf ? text.replace(/\n/g, '\r\n') : text);
  };
  write(polPath, pols, polRaw.includes('\r\n'));
  if (casesRemoved) write(casePath, keptCases, caseRaw.includes('\r\n'));
  console.log('\n✓ wrote data/seed/politicians.json' + (casesRemoved ? ' + criminal_cases.json' : ''));
  console.log('  Next: npm run dm -- validate');
}

main();
