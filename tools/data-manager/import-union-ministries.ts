/**
 * Data-manager step: build data/seed/union_ministries.json - every Ministry
 * and Department of the Government of India - from the research extraction of
 * the Cabinet Secretariat's Allocation of Business Rules, First Schedule.
 *
 * The schedule is the one document that decides what a ministry is, so the
 * seed keeps its wording and its order. This step normalises the extraction
 * (ids, kinds), drops any website that is not on a gov.in / nic.in host or
 * that does not answer, and reports every council-list portfolio that joins
 * to no schedule entry (lib/ministries.ts does the join) so a wording drift is
 * caught here and not by a reader.
 *
 * Usage:  npx tsx tools/data-manager/import-union-ministries.ts <extraction.json> [--apply] [--skip-verify]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Minister, UnionMinistriesFile, UnionMinistry } from '../../lib/types';
import { unmatchedPortfolios } from '../../lib/ministries';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SEED_DIR = resolve(ROOT, 'data', 'seed');
const OUT = resolve(SEED_DIR, 'union_ministries.json');
const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_VERIFY = args.includes('--skip-verify');
const input = args.find((a) => !a.startsWith('--'));

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const GOV_HOST = /^https?:\/\/([a-z0-9-]+\.)*(gov\.in|nic\.in)(\/|$)/i;

async function live(url: string): Promise<boolean> {
  if (SKIP_VERIFY) return true;
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(25_000),
        redirect: 'follow',
      });
      if (r.ok) return true;
      if (r.status >= 400 && r.status < 500 && r.status !== 429) return false;
    } catch { /* retry */ }
    await new Promise((s) => setTimeout(s, 1000));
  }
  return false;
}

async function main() {
  if (!input) { console.error('Usage: import-union-ministries <extraction.json> [--apply]'); process.exit(1); }
  const doc = JSON.parse(readFileSync(resolve(input), 'utf8'));
  const entriesIn: any[] = doc.entries || [];
  if (!entriesIn.length || !doc.source_url) { console.error('extraction has no entries / source_url'); process.exit(1); }

  const notes: string[] = [];
  const checkSite = async (label: string, url?: string | null): Promise<string | undefined> => {
    if (!url) return undefined;
    if (!GOV_HOST.test(url)) { notes.push(`${label}: ${url} is not a gov.in / nic.in host - omitted`); return undefined; }
    if (!(await live(url))) { notes.push(`${label}: ${url} did not answer - omitted`); return undefined; }
    return url;
  };

  const entries: UnionMinistry[] = [];
  const seen = new Set<string>();
  let order = 0;
  for (const e of entriesIn) {
    const name = String(e.name || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const id = slug(name);
    if (seen.has(id)) { notes.push(`duplicate entry ${name} - skipped`); continue; }
    seen.add(id);
    const kind: UnionMinistry['kind'] = e.kind === 'department' || e.kind === 'office' ? e.kind : /^ministry of/i.test(name) ? 'ministry' : /^department of/i.test(name) ? 'department' : 'office';
    const website = await checkSite(name, e.website);
    const departments: UnionMinistry['departments'] = [];
    for (const d of e.departments || []) {
      const dn = String(d.name || '').replace(/\s+/g, ' ').trim();
      if (!dn) continue;
      const dw = await checkSite(`${name} / ${dn}`, d.website);
      departments.push({ name: dn, ...(d.name_hi_translit ? { name_hi_translit: String(d.name_hi_translit).trim() } : {}), ...(dw ? { website: dw } : {}) });
    }
    entries.push({
      id, order: ++order, kind, name,
      ...(e.name_hi_translit ? { name_hi_translit: String(e.name_hi_translit).trim() } : {}),
      ...(website ? { website } : {}),
      departments,
    });
  }

  const file: UnionMinistriesFile = {
    source_url: doc.source_url,
    source_name: doc.source_name || 'Cabinet Secretariat - Government of India (Allocation of Business) Rules, 1961, First Schedule',
    ...(doc.schedule_last_updated ? { schedule_last_updated: doc.schedule_last_updated } : {}),
    retrieved_date: doc.retrieved_date || TODAY,
    entries,
  };

  const ministers: Minister[] = JSON.parse(readFileSync(resolve(SEED_DIR, 'central_government.json'), 'utf8'));
  const unmatched = unmatchedPortfolios(entries, ministers);
  const nMin = entries.filter((e) => e.kind === 'ministry').length;
  const nDep = entries.reduce((n, e) => n + e.departments.length, 0);
  console.log(`${entries.length} entries: ${nMin} ministries, ${nDep} departments, ${entries.filter((e) => e.website).length} with a live website`);
  if (notes.length) { console.log('\nNotes:'); for (const n of notes) console.log(`  - ${n}`); }
  if (unmatched.length) {
    console.log('\nCouncil-list portfolios that join to NO schedule entry (fix the wording or add an alias in lib/ministries.ts):');
    for (const p of unmatched) console.log(`  ! ${p}`);
  } else console.log('\n✓ every council-list portfolio joins a schedule entry');

  if (!APPLY) { console.log('\nDry run - nothing written. Re-run with --apply to write data/seed/union_ministries.json.'); return; }
  writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n');
  console.log(`\n✓ wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
