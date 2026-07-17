/**
 * Data-manager step: AUDIT (read-only) the seed's MLA rosters against the live
 * Wikipedia assembly pages using the rowspan-aware parser (mla-parse.ts).
 * Reports every seat where the seed's sitting member differs from the parsed
 * sitting member, every seat the page marks vacant while the seed still lists
 * a member, party drift, and per-state count drift - WITHOUT touching the
 * seed. This is how by-election staleness (the Shiggaon/Bommai class of bug)
 * gets caught between refreshes; verify each finding against independent
 * sources before editing data.
 *
 * Usage:  npm run dm -- audit-mlas <out.json>
 *         npx tsx tools/data-manager/audit-mlas.ts <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseSeats, slug } from './mla-parse';
import type { Politician } from '../../lib/types';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const WP_API = 'https://en.wikipedia.org/w/api.php';
const UA = 'RankYourPolitician-DataManager/1.0 (civic info; vikas070696@gmail.com)';

const PAGES: { code: string; title: string }[] = [
  { code: 'AP', title: '16th Andhra Pradesh Assembly' },
  { code: 'AR', title: '11th Arunachal Pradesh Assembly' },
  { code: 'AS', title: '16th Assam Assembly' },
  { code: 'BR', title: '18th Bihar Assembly' },
  { code: 'CG', title: '6th Chhattisgarh Assembly' },
  { code: 'DL', title: '8th Delhi Assembly' },
  { code: 'GA', title: '8th Goa Assembly' },
  { code: 'GJ', title: '15th Gujarat Assembly' },
  { code: 'HP', title: '14th Himachal Pradesh Assembly' },
  { code: 'HR', title: '15th Haryana Assembly' },
  { code: 'JH', title: '6th Jharkhand Assembly' },
  { code: 'JK', title: '13th Jammu and Kashmir Assembly' },
  { code: 'KA', title: '16th Karnataka Assembly' },
  { code: 'KL', title: '16th Kerala Assembly' },
  { code: 'MH', title: '15th Maharashtra Assembly' },
  { code: 'ML', title: '11th Meghalaya Assembly' },
  { code: 'MN', title: '12th Manipur Assembly' },
  { code: 'MP', title: '16th Madhya Pradesh Assembly' },
  { code: 'MZ', title: '9th Mizoram Legislative Assembly' },
  { code: 'NL', title: '14th Nagaland Assembly' },
  { code: 'OD', title: '17th Odisha Legislative Assembly' },
  { code: 'PB', title: '16th Punjab Assembly' },
  { code: 'PY', title: '16th Puducherry Assembly' },
  { code: 'RJ', title: '16th Rajasthan Assembly' },
  { code: 'SK', title: '11th Sikkim Assembly' },
  { code: 'TG', title: '3rd Telangana Assembly' },
  { code: 'TN', title: '17th Tamil Nadu Assembly' },
  { code: 'TR', title: '13th Tripura Assembly' },
  { code: 'UK', title: '5th Uttarakhand Assembly' },
  { code: 'UP', title: '18th Uttar Pradesh Assembly' },
  { code: 'WB', title: '18th West Bengal Assembly' },
];
const EXPECTED: Record<string, number> = {
  AP: 175, AR: 60, AS: 126, BR: 243, CG: 90, GA: 40, GJ: 182, HR: 90, HP: 68, JH: 81, KA: 224, KL: 140, MP: 230,
  MH: 288, MN: 60, ML: 60, MZ: 40, NL: 60, OD: 147, PB: 117, RJ: 200, SK: 32, TN: 234, TG: 119, TR: 60, UP: 403,
  UK: 70, WB: 294, DL: 70, PY: 30, JK: 90,
};

async function fetchWikitext(title: string): Promise<string> {
  const u = WP_API + '?format=json&formatversion=2&origin=*&' + new URLSearchParams({ action: 'parse', page: title, prop: 'wikitext', redirects: '1' });
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (r.ok) { const j = await r.json(); return j.parse.wikitext; } } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 700 * (a + 1)));
  }
  throw new Error('fetch failed: ' + title);
}

const normDash = (s: string) => s.replace(/[–—]/g, '-');

// Loose person-name compare: slug containment either way, or shared 2+ tokens.
function sameName(a: string, b: string): boolean {
  const sa = slug(a), sb = slug(b);
  if (sa === sb || sa.includes(sb) || sb.includes(sa)) return true;
  const ta = new Set(sa.split('-')), tb = sb.split('-');
  const shared = tb.filter((t) => t.length > 1 && ta.has(t));
  return shared.length >= 2;
}

async function main() {
  const out = process.argv[2] || resolve(ROOT, 'tools', 'data-manager', 'audit-mlas.report.json');
  const pols: Politician[] = JSON.parse(readFileSync(resolve(ROOT, 'data', 'seed', 'politicians.json'), 'utf8'));
  const findings: any[] = [];
  const stateReport: string[] = [];

  for (const { code, title } of PAGES) {
    let wt: string;
    try { wt = await fetchWikitext(title); } catch (e) { stateReport.push(`${code}: FETCH FAILED`); continue; }
    const seats = parseSeats(wt);
    const seedByCons = new Map<string, Politician>();
    for (const p of pols) {
      if (p.stateCode !== code || p.constituencyType !== 'AC') continue;
      seedByCons.set(p.constituencyId.replace(`ac-${code.toLowerCase()}-`, ''), p);
    }
    const parsedKeys = new Set<string>();
    let stale = 0, vacant = 0;
    for (const s of seats) {
      const k = slug(s.cons);
      parsedKeys.add(k);
      const seed = seedByCons.get(k);
      if (!seed) {
        if (s.sitting) findings.push({ kind: 'seat-missing-in-seed', code, cons: s.cons, parsed: s.sitting, note: s.sitting.note || '' });
        continue;
      }
      if (!s.sitting) {
        vacant++;
        findings.push({ kind: 'vacant-but-seed-has-member', code, cons: s.cons, seedId: seed.id, seedName: seed.name, departed: s.departed });
        continue;
      }
      if (!sameName(seed.name, s.sitting.name)) {
        stale++;
        findings.push({
          kind: 'stale-member', code, cons: s.cons, seedId: seed.id, seedName: seed.name, seedParty: seed.party,
          newName: s.sitting.name, newTitle: s.sitting.title, newParty: s.sitting.party, note: s.sitting.note || '',
          departedListed: s.departed.map((d) => d.name),
        });
      } else if (normDash(seed.party) !== normDash(s.sitting.party) && s.sitting.party !== 'Independent') {
        findings.push({ kind: 'party-differs', code, cons: s.cons, seedId: seed.id, name: seed.name, newName: s.sitting.name, newTitle: s.sitting.title, seedParty: seed.party, newParty: s.sitting.party, note: s.sitting.note || '' });
      }
    }
    for (const [k, p] of seedByCons) {
      if (!parsedKeys.has(k)) findings.push({ kind: 'seed-seat-not-parsed', code, cons: p.constituencyName, seedId: p.id, seedName: p.name });
    }
    const exp = EXPECTED[code];
    stateReport.push(`${code}: parsed ${seats.length}/${exp} seats (sitting ${seats.filter((s) => s.sitting).length}), seed ${seedByCons.size}, stale ${stale}, vacant ${vacant}`);
    await new Promise((res) => setTimeout(res, 400));
  }

  writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), stateReport, findings }, null, 2));
  console.log(stateReport.join('\n'));
  const byKind: Record<string, number> = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  console.log('\nFindings by kind:', JSON.stringify(byKind));
  console.log('Written to', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
