/**
 * Data-manager step: add the MLAs (state Legislative Assembly members) for every
 * state/UT - the ~4,100 elected representatives - from each assembly's current
 * Wikipedia members roster (page titles discovered by the ryp-assembly-pages
 * workflow). Identity-only (name, party, constituency); bio/photo come from the
 * shared Wikidata enrichment. Assembly constituencies (ACs) are added to
 * constituencies.json.
 *
 * Usage:  npx tsx tools/data-manager/import-mlas.ts <discovered-pages.json|.output>
 *         MLA_ONE=MH:15th Maharashtra Assembly   npx tsx ... (test one state)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Politician, Constituency } from '../../lib/types';
import { parseMembers, slug } from './mla-parse';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SEED_DIR = resolve(ROOT, 'data', 'seed');
const WP_API = 'https://en.wikipedia.org/w/api.php';
const UA = 'RankYourPolitician-DataManager/1.0 (civic info; vikas070696@gmail.com)';
const TODAY = new Date().toISOString().slice(0, 10);

const CODE2STATE: Record<string, string> = {
  AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CG: 'Chhattisgarh', GA: 'Goa',
  GJ: 'Gujarat', HR: 'Haryana', HP: 'Himachal Pradesh', JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala',
  MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya', MZ: 'Mizoram', NL: 'Nagaland',
  OD: 'Odisha', PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu', TG: 'Telangana', TR: 'Tripura',
  UP: 'Uttar Pradesh', UK: 'Uttarakhand', WB: 'West Bengal', DL: 'Delhi', PY: 'Puducherry', JK: 'Jammu & Kashmir',
};
// Known assembly sizes - a structural check against silent parse drift.
const EXPECTED: Record<string, number> = {
  AP: 175, AR: 60, AS: 126, BR: 243, CG: 90, GA: 40, GJ: 182, HR: 90, HP: 68, JH: 81, KA: 224, KL: 140, MP: 230,
  MH: 288, MN: 60, ML: 60, MZ: 40, NL: 60, OD: 147, PB: 117, RJ: 200, SK: 32, TN: 234, TG: 119, TR: 60, UP: 403,
  UK: 70, WB: 294, DL: 70, PY: 30, JK: 90,
};

async function api(params: Record<string, string>): Promise<any> {
  const u = WP_API + '?format=json&formatversion=2&origin=*&' + new URLSearchParams(params);
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 700 * (a + 1)));
  }
  throw new Error('API failed: ' + u);
}

async function titlesToQids(titles: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const jr = await api({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: batch.join('|'), redirects: '1' });
    const norm = new Map<string, string>((jr.query.normalized || []).map((n: any) => [n.from, n.to]));
    const redir = new Map<string, string>((jr.query.redirects || []).map((r: any) => [r.from, r.to]));
    const byT = new Map<string, string>((jr.query.pages || []).map((p: any) => [p.title, p.pageprops?.wikibase_item]));
    for (const t of batch) { let k = norm.get(t) || t; k = redir.get(k) || k; const q = byT.get(k); if (q) map.set(t, q); }
  }
  return map;
}

interface PageRef { stateCode: string; rosterPageTitle: string; }

async function main() {
  const arg = process.argv[2];
  let pages: PageRef[];
  if (process.env.MLA_ONE) {
    const [stateCode, ...rest] = process.env.MLA_ONE.split(':');
    pages = [{ stateCode, rosterPageTitle: rest.join(':') }];
  } else {
    if (!arg || !existsSync(arg)) { console.error('Usage: import-mlas <discovered-pages.json>'); process.exit(1); }
    const raw = JSON.parse(readFileSync(arg, 'utf8'));
    pages = (raw.pages || raw.result?.pages || raw).filter((p: any) => p.rosterPageTitle && p.exists !== false)
      .map((p: any) => ({ stateCode: p.stateCode, rosterPageTitle: p.rosterPageTitle }));
  }

  const pols: Politician[] = existsSync(resolve(SEED_DIR, 'politicians.json')) ? JSON.parse(readFileSync(resolve(SEED_DIR, 'politicians.json'), 'utf8')) : [];
  const cons: Constituency[] = existsSync(resolve(SEED_DIR, 'constituencies.json')) ? JSON.parse(readFileSync(resolve(SEED_DIR, 'constituencies.json'), 'utf8')) : [];
  // Drop previously-generated MLA records so a re-run is clean (keep LS/RS/curated + PC/RS constituencies).
  let kept = pols.filter((p) => !(p.constituencyType === 'AC' && p.generated));
  const consById = new Map(cons.filter((c) => c.type !== 'AC').map((c) => [c.id, c]));
  const existingIds = new Set(kept.map((p) => p.id));

  let totalAdded = 0;
  const report: string[] = [];
  for (const { stateCode: code, rosterPageTitle } of pages) {
    const state = CODE2STATE[code] || code;
    let wt = '';
    try { wt = (await api({ action: 'parse', page: rosterPageTitle, prop: 'wikitext', redirects: '1' })).parse.wikitext; } catch { report.push(`${code}: FETCH FAILED (${rosterPageTitle})`); continue; }
    const mlas = parseMembers(wt);
    const exp = EXPECTED[code];
    const flag = exp ? (Math.abs(mlas.length - exp) > Math.max(5, exp * 0.08) ? ' ⚠OFF' : '') : '';
    report.push(`${code}: ${mlas.length}${exp ? `/${exp}` : ''}${flag}  (${rosterPageTitle})`);

    // Resolve QIDs for members with an article.
    const t2q = await titlesToQids([...new Set(mlas.filter((m) => m.title).map((m) => m.title!))]);
    for (const m of mlas) {
      const constituencyId = `ac-${code.toLowerCase()}-${slug(m.cons)}`;
      if (!consById.has(constituencyId)) consById.set(constituencyId, { id: constituencyId, type: 'AC', name: m.cons, state, stateCode: code, districts: [] });
      const id = slug(`${m.cons}-ac-${code}-${m.name}`);
      if (existingIds.has(id)) continue;
      existingIds.add(id);
      const qid = m.title ? t2q.get(m.title) : undefined;
      kept.push({
        id, name: m.name, party: m.party, house: 'Vidhan Sabha', state, stateCode: code,
        constituencyId, constituencyName: m.cons, constituencyType: 'AC', districts: [],
        current_position: `Member of the Legislative Assembly, ${state}`,
        is_minister: false,
        neutral_summary: `${m.name} is the Member of the Legislative Assembly (MLA) for the ${m.cons} constituency in ${state}. Current party affiliation: ${m.party}.`,
        metrics: {}, facts: [], active: true, generated: true,
        identity_source: { url: `https://en.wikipedia.org/wiki/${encodeURIComponent(rosterPageTitle.replace(/ /g, '_'))}`, name: `Wikipedia - ${rosterPageTitle} (ECI results)`, retrieved_date: TODAY },
        ...(qid ? { wikidata_qid: qid } : {}),
        ...(m.note ? { party_note: m.note } : {}),
      });
      totalAdded++;
    }
    await new Promise((res) => setTimeout(res, 400)); // be polite to the API
  }

  const constituencies = [...consById.values()].sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  kept.sort((a, b) => a.state.localeCompare(b.state) || a.constituencyName.localeCompare(b.constituencyName));
  writeFileSync(resolve(SEED_DIR, 'politicians.json'), JSON.stringify(kept, null, 2) + '\n');
  writeFileSync(resolve(SEED_DIR, 'constituencies.json'), JSON.stringify(constituencies, null, 2) + '\n');

  console.log('Per-state MLA parse:');
  for (const r of report) console.log('  ' + r);
  console.log(`\n✓ Added ${totalAdded} MLAs. Total politicians: ${kept.length}. Constituencies: ${constituencies.length}.`);
  console.log('Next: npm run dm -- enrich-mps   then   validate   then   publish');
}

main().catch((e) => { console.error(e); process.exit(1); });
