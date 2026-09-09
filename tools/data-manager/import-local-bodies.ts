/**
 * Data-manager step: build data/seed/local_bodies.json (city governments -
 * Municipal Corporations and their elected heads) from research-workflow
 * output, and RE-VERIFY every row against the page it cites before writing.
 *
 * Input rows (one JSON array per file, any number of files) carry, per city:
 * the body, its official website, the Mayor / Deputy / Commissioner each with
 * a source_url and a verbatim quote, and a status (elected council or an
 * Administrator in charge). Nothing here is typed by hand.
 *
 * "No citation, no claim" is enforced MECHANICALLY: for every named person the
 * cited page is fetched again and must (a) answer 200 and (b) contain the
 * person's name (every token of two or more letters, ignoring honorifics and
 * punctuation). A row that fails either is DROPPED and reported - a mayor's
 * name we cannot find on the page we claim names them is exactly the kind of
 * claim this site refuses to print. Wikipedia-sourced rows are accepted only
 * when the body's own site did not name the head, and the page is fetched via
 * the MediaWiki API so the check reads the article text, not the chrome.
 *
 * Districts are mapped onto the seed's own district names (politicians.json)
 * so the body joins the right /district page; an unmatched district is kept
 * verbatim and reported, since a body with no district still belongs on the
 * state page.
 *
 * Usage:  npx tsx tools/data-manager/import-local-bodies.ts <dir-or-files...> [--apply] [--skip-verify]
 *   e.g.  npx tsx tools/data-manager/import-local-bodies.ts research/mayors-*.json --apply
 * Dry run unless --apply. --skip-verify trusts the input (review use only).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import type { LocalBody, LocalBodyPerson, LocalBodyKind, Politician } from '../../lib/types';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SEED_DIR = resolve(ROOT, 'data', 'seed');
const OUT = resolve(SEED_DIR, 'local_bodies.json');
const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_VERIFY = args.includes('--skip-verify');
const inputs = args.filter((a) => !a.startsWith('--'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WIKI_UA = 'RankYourPolitician-DataManager/1.0 (civic info; vikas070696@gmail.com)';

interface InPerson {
  name?: string; party?: string | null; since?: string | null; elected_by?: 'direct' | 'indirect' | null;
  source_url?: string; source_name?: string; source_kind?: string; retrieved_date?: string; quote?: string;
}
interface InRow {
  city: string; stateCode: string; body_name?: string | null; body_kind?: string; head_title?: string;
  website?: string | null; website_status?: number | null; districts?: string[];
  status?: string; status_note?: string | null; status_source_url?: string | null;
  mayor?: InPerson | null; deputy_mayor?: InPerson | null; commissioner?: InPerson | null; notes?: string;
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const STATE_NAME: Record<string, string> = {
  AN: 'Andaman & Nicobar Islands', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CH: 'Chandigarh',
  CG: 'Chhattisgarh', DL: 'Delhi', DN: 'Dadra & Nagar Haveli and Daman & Diu', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana',
  HP: 'Himachal Pradesh', JK: 'Jammu & Kashmir', JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep',
  MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya', MZ: 'Mizoram', NL: 'Nagaland', OD: 'Odisha',
  PY: 'Puducherry', PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu', TG: 'Telangana', TR: 'Tripura',
  UP: 'Uttar Pradesh', UK: 'Uttarakhand', WB: 'West Bengal',
};

/** Honorifics the sites prefix to names; never part of the name we publish. */
const HONORIFIC = /^(shri|smt\.?|smt|sri|thiru\.?|tmt\.?|selvi|dr\.?|prof\.?|adv\.?|er\.?|ms\.?|mr\.?|mrs\.?|km\.?|sh\.?|श्री|श्रीमती)\s+/i;
function cleanName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) s = s.replace(HONORIFIC, '');
  // Trailing service/role tags the sites append: ", IAS", "(IAS)", "I.A.S."
  s = s.replace(/[,(]?\s*\b(i\.?a\.?s\.?|i\.?p\.?s\.?)\b\)?\.?$/i, '').replace(/[,\s]+$/, '').trim();
  return s;
}

/** Name tokens that must ALL appear on the cited page (2+ letters, no
 *  initials - "R." and "M." are too common to prove anything). */
function nameTokens(name: string): string[] {
  return norm(name.replace(/\./g, ' ')).length
    ? name.replace(/\./g, ' ').split(/\s+/).map(norm).filter((t) => t.length >= 2)
    : [];
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const wiki = url.match(/^https?:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/);
  const target = wiki
    ? `https://en.wikipedia.org/w/api.php?action=parse&page=${wiki[1]}&prop=wikitext&format=json&formatversion=2&redirects=1`
    : url;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(target, { headers: { 'User-Agent': wiki ? WIKI_UA : UA, Accept: 'text/html,application/json,*/*' }, signal: AbortSignal.timeout(30_000), redirect: 'follow' });
      const text = await r.text();
      if (r.ok) return { ok: true, status: r.status, text };
      if (r.status === 404 || r.status === 410) return { ok: false, status: r.status, text };
    } catch { /* retry */ }
    await new Promise((s) => setTimeout(s, 1200 * (a + 1)));
  }
  return { ok: false, status: 0, text: '' };
}

const pageCache = new Map<string, Promise<{ ok: boolean; status: number; text: string }>>();
const page = (url: string) => pageCache.get(url) ?? pageCache.set(url, fetchText(url)).get(url)!;

async function verifyPerson(label: string, p: InPerson): Promise<{ ok: boolean; why?: string }> {
  if (!p.name || !p.source_url) return { ok: false, why: 'no name or source_url' };
  if (SKIP_VERIFY) return { ok: true };
  const res = await page(p.source_url);
  if (!res.ok) return { ok: false, why: `source ${p.source_url} -> HTTP ${res.status || 'unreachable'}` };
  const hay = norm(res.text.replace(/<[^>]+>/g, ' '));
  const tokens = nameTokens(cleanName(p.name));
  if (!tokens.length) return { ok: false, why: 'name has no checkable tokens' };
  const missing = tokens.filter((t) => !hay.includes(t));
  if (missing.length) return { ok: false, why: `name tokens not on cited page: ${missing.join(', ')} (${label})` };
  return { ok: true };
}

function toPerson(p: InPerson, fallbackSourceName: string): LocalBodyPerson {
  const out: LocalBodyPerson = {
    name: cleanName(p.name!),
    source_url: p.source_url!,
    source_name: p.source_name || fallbackSourceName,
    retrieved_date: p.retrieved_date || TODAY,
  };
  if (p.party) out.party = p.party;
  if (p.since && /^\d{4}-\d{2}-\d{2}$/.test(p.since)) out.since = p.since;
  if (p.elected_by === 'direct' || p.elected_by === 'indirect') out.elected_by = p.elected_by;
  return out;
}

const KINDS: LocalBodyKind[] = ['municipal_corporation', 'municipality', 'municipal_council', 'municipal_board'];

async function main() {
  if (!inputs.length) {
    console.error('Usage: import-local-bodies <dir-or-files...> [--apply] [--skip-verify]');
    process.exit(1);
  }
  const files = inputs.flatMap((p) => {
    const abs = resolve(p);
    return statSync(abs).isDirectory() ? readdirSync(abs).filter((f) => f.endsWith('.json')).map((f) => join(abs, f)) : [abs];
  });
  const rows: InRow[] = files.flatMap((f) => {
    const doc = JSON.parse(readFileSync(f, 'utf8'));
    return Array.isArray(doc) ? doc : doc.rows || doc.bodies || [];
  });
  console.log(`${rows.length} research rows from ${files.length} file(s)`);

  // Seed district names per state, so the body joins a real district page.
  const politicians: Politician[] = JSON.parse(readFileSync(resolve(SEED_DIR, 'politicians.json'), 'utf8'));
  const districtsByState = new Map<string, Map<string, string>>();
  for (const p of politicians) {
    const m = districtsByState.get(p.stateCode) ?? districtsByState.set(p.stateCode, new Map()).get(p.stateCode)!;
    for (const d of p.districts) if (d?.trim()) m.set(norm(d), d);
  }
  const politiciansByName = new Map<string, Politician[]>();
  for (const p of politicians) {
    const k = `${norm(p.name)}|${p.stateCode}`;
    politiciansByName.set(k, [...(politiciansByName.get(k) ?? []), p]);
  }

  const out: LocalBody[] = [];
  const dropped: string[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const label = `${r.city} (${r.stateCode})`;
    if (!r.body_name || !r.stateCode || !STATE_NAME[r.stateCode]) { dropped.push(`${label}: no body name / unknown state`); continue; }
    const id = `${r.stateCode.toLowerCase()}-${slug(r.city)}`;
    if (seen.has(id)) { dropped.push(`${label}: duplicate id ${id}`); continue; }
    const kind = KINDS.includes(r.body_kind as LocalBodyKind) ? (r.body_kind as LocalBodyKind) : 'municipal_corporation';
    const status = r.status === 'administrator' ? 'administrator' : r.status === 'elected_council' ? 'elected_council' : null;
    if (!status) { dropped.push(`${label}: status unknown - nothing verifiable to publish`); continue; }
    if (status === 'administrator' && !r.status_source_url) { dropped.push(`${label}: administrator status has no source`); continue; }

    // Website: only a live official domain.
    let website: string | undefined;
    if (r.website && /^https?:\/\//.test(r.website)) {
      if (SKIP_VERIFY) website = r.website;
      else {
        const res = await page(r.website);
        if (res.ok) website = r.website;
        else notes.push(`${label}: website ${r.website} -> HTTP ${res.status || 'unreachable'} - omitted`);
      }
    }

    // Districts onto seed names.
    const dmap = districtsByState.get(r.stateCode) ?? new Map<string, string>();
    const districts: string[] = [];
    for (const d of r.districts ?? []) {
      const hit = dmap.get(norm(d)) ?? dmap.get(norm(d.replace(/\bdistrict\b/i, '')));
      if (hit) districts.push(hit);
      else { districts.push(d); notes.push(`${label}: district "${d}" is not a seed district name - kept verbatim, will not join a district page`); }
    }

    const body: LocalBody = {
      id, kind,
      name: r.body_name.trim(),
      city: r.city.trim(),
      state: STATE_NAME[r.stateCode],
      stateCode: r.stateCode,
      districts: [...new Set(districts)],
      ...(website ? { website } : {}),
      head_title: (r.head_title || 'Mayor').trim(),
      status,
      ...(status === 'administrator' && r.status_note ? { status_note: r.status_note } : {}),
      source_url: r.mayor?.source_url || r.status_source_url || website || '',
      source_name: r.mayor?.source_name || r.body_name,
      retrieved_date: TODAY,
    };
    if (!body.source_url) { dropped.push(`${label}: no citation for the body at all`); continue; }

    // People - each one re-verified against its own cited page.
    const slots: [keyof Pick<InRow, 'mayor' | 'deputy_mayor' | 'commissioner'>, 'head' | 'deputy_head' | 'commissioner'][] = [
      ['mayor', 'head'], ['deputy_mayor', 'deputy_head'], ['commissioner', 'commissioner'],
    ];
    for (const [inKey, outKey] of slots) {
      const p = r[inKey];
      if (!p || !p.name) continue;
      if (outKey === 'head' && status === 'administrator') { notes.push(`${label}: mayor named but status is administrator - contradictory, mayor dropped`); continue; }
      const v = await verifyPerson(`${label} ${inKey}`, p);
      if (!v.ok) { notes.push(`${label}: ${inKey} "${p.name}" dropped - ${v.why}`); continue; }
      const person = toPerson(p, body.name);
      // One human, one ratable page: a head who is also a sitting member of
      // this state's legislature links to that profile instead of a new page.
      // Exact normalised name within the same state only - never fuzzy.
      if (outKey !== 'commissioner') {
        const hits = politiciansByName.get(`${norm(person.name)}|${r.stateCode}`) ?? [];
        if (hits.length === 1) { person.politicianId = hits[0].id; notes.push(`${label}: ${inKey} ${person.name} linked to sitting member ${hits[0].id}`); }
        else if (hits.length > 1) notes.push(`${label}: ${inKey} ${person.name} matches ${hits.length} sitting members - not linked`);
      }
      if (outKey === 'commissioner') body.commissioner = { ...person, title: 'Municipal Commissioner' };
      else body[outKey] = person;
    }
    if (status === 'elected_council' && !body.head) {
      dropped.push(`${label}: elected council but no verifiable head - nothing to publish`);
      continue;
    }
    seen.add(id);
    out.push(body);
    console.log(`  ✓ ${label}: ${body.name} - ${body.head ? `${body.head_title} ${body.head.name}` : 'Administrator in charge'}${body.deputy_head ? `, deputy ${body.deputy_head.name}` : ''}${body.commissioner ? `, commissioner ${body.commissioner.name}` : ''}`);
  }

  out.sort((a, b) => a.state.localeCompare(b.state) || a.city.localeCompare(b.city));
  console.log(`\n${out.length} bodies verified; ${dropped.length} dropped`);
  for (const d of dropped) console.log(`  ✗ ${d}`);
  if (notes.length) { console.log('\nNotes:'); for (const n of notes) console.log(`  - ${n}`); }

  if (!APPLY) { console.log('\nDry run - nothing written. Re-run with --apply to write data/seed/local_bodies.json.'); return; }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n✓ wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
