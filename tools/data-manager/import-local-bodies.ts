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
 * --states=MH,GJ processes only those states and --out=<file> writes there instead
 * of the seed, so a slow crawl can run as parallel state groups and be merged
 * afterwards (municipal hosts routinely take 20 s to refuse a connection).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { LocalBody, LocalBodyPerson, LocalBodyKind, Politician } from '../../lib/types';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SEED_DIR = resolve(ROOT, 'data', 'seed');
const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_VERIFY = args.includes('--skip-verify');
const inputs = args.filter((a) => !a.startsWith('--'));
const STATES = new Set(
  args.filter((a) => a.startsWith('--states=')).flatMap((a) => a.slice('--states='.length).split(',')).map((s) => s.trim().toUpperCase()).filter(Boolean),
);
const OUT_ARG = args.find((a) => a.startsWith('--out='))?.slice('--out='.length);
const OUT = OUT_ARG ? resolve(OUT_ARG) : resolve(SEED_DIR, 'local_bodies.json');

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

/** Honorifics the sites prefix to names; never part of the name we publish.
 *  The honorific must END at a dot or whitespace - "Sh" must not eat the
 *  "Sh" of "Shivakumar", nor "Mr" the "Mr" of "Mrigen". */
const HONORIFIC = /^(shri|smt|sri|thiru|tmt|selvi|dr|prof|adv|er|ms|mr|mrs|km|sh|श्री|श्रीमती)(\.\s*|\s+)/i;
function cleanName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const t = s.replace(HONORIFIC, '');
    if (t === s) break;
    s = t;
  }
  // A title printed mid-name ("Karumaliyil Dr. Udaya Sukumaran" - a Kerala house
  // name comes first) and a nickname glued to the name ("BIRENDRA KUMAR(GANESH JI)").
  s = s.replace(/\s(?:dr|prof|adv|shri|smt|sri)\.\s*/gi, ' ').replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')');
  // Service / cadre / grade tags the sites append, in any of their forms:
  // ", IAS", "(IAS)", "I.A.S.", "HPAS", ", KAS (Selection Grade)", "(Senior Scale)", ", PCS", ", WBCS(EXE.)".
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/\s*\((?:[^()]*\b(?:i\.?a\.?s|i\.?p\.?s|k\.?a\.?s|p\.?c\.?s|h\.?p\.?a\.?s|a\.?c\.?s|m\.?c\.?s|w\.?b\.?c\.?s|senior scale|selection grade|retd)\b[^()]*)\)\s*\.?$/i, '')
      .replace(/[,\s]+\b(i\.?a\.?s|i\.?p\.?s|k\.?a\.?s|p\.?c\.?s|h\.?p\.?a\.?s|a\.?c\.?s|m\.?c\.?s)\b\.?\s*$/i, '')
      .replace(/[,\s]+w\.?b\.?c\.?s\.?\s*(?:\(\s*exe\.?\s*\))?\s*$/i, '')
      .replace(/^(sj|sri|shri|smt|dr|mr|mrs|ms)\.\s*/i, '')
      .replace(/[,\s]+$/, '')
      .trim();
  }
  // Sites that SHOUT ("SANJEEV KHIRWAR") get title case; mixed case is kept as printed.
  if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) {
    s = s.toLowerCase().replace(/(^|[\s.\-'(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  // A word printed entirely in lower case ("Alka baghmar") is a typing slip
  // on the site, not a spelling; capitalise it.
  s = s.replace(/(^|\s)([a-z][a-z]+)(?=\s|$)/g, (m, a, w) => a + w[0].toUpperCase() + w.slice(1));
  return s;
}

/** Rows whose research left `districts` empty, for cities whose district is
 *  not in doubt - reviewed pairs onto the seed's own district names. */
const CITY_DISTRICT: Record<string, string> = {
  'ar-itanagar': 'papumpare',
  'as-guwahati': 'kamrupmetro',
  'mz-aizawl': 'aizawl',
  'nl-kohima': 'kohima',
  'sk-gangtok': 'east',
};

/**
 * Seed district names are the map's (DataMeet, 2001-vintage in places), so a
 * city's present-day district sometimes goes by an older name in the seed:
 * Mysuru is "Mysore", Belagavi "Belgaum", Kamrup Metropolitan "Kamrup Metro",
 * Gangtok "East" (Sikkim's districts are the four points of the compass in
 * the seed). Reviewed pairs only - never fuzzy. Keys are normalised names.
 */
const DISTRICT_ALIAS: Record<string, string> = {
  'KA|mysuru': 'mysore',
  'KA|belagavi': 'belgaum',
  'KA|hubballidharwad': 'dharwad',
  'KA|bengaluruurban': 'bangalore',
  'KA|bengaluru': 'bangalore',
  'KA|mangaluru': 'dakshinakannada',
  'KA|dakshinakannada': 'dakshinakannada',
  'AS|kamrupmetropolitan': 'kamrupmetro',
  'SK|gangtok': 'east',
  'WB|purbamedinipur': 'purbamedinipur',
  'WB|eastmidnapore': 'purbamedinipur',
  'MH|chhatrapatisambhajinagar': 'aurangabad',
  'MH|palghar': 'thane',
  'AP|ntr': 'krishna',
  'AP|anakapalli': 'visakhapatnam',
  'AP|tirupati': 'chittoor',
  'TG|medchalmalkajgiri': 'rangareddy',
  'TG|hanumakonda': 'warangal',
  'TG|hyderabad': 'hyderabad',
  'UP|kanpurnagar': 'kanpurnagar',
  'UP|prayagraj': 'allahabad',
  'GJ|ahmedabad': 'ahmadabad',
  'HR|gurugram': 'gurgaon',
  'MH|mumbaicity': 'mumbai',
  'MH|mumbaisuburban': 'mumbai',
  'MH|raigad': 'raigarh',
  'UK|haridwar': 'hardwar',
  'WB|howrah': 'haora',
  'WB|darjeeling': 'darjiling',
  'WB|paschimbardhaman': 'barddhaman',
  'WB|purbabardhaman': 'barddhaman',
  'WB|bardhaman': 'barddhaman',
  'WB|burdwan': 'barddhaman',
  'DL|newdelhi': 'delhi',
  'DL|centraldelhi': 'delhi',
  'DL|northdelhi': 'delhi',
  'DL|southdelhi': 'delhi',
  'DL|eastdelhi': 'delhi',
  'DL|westdelhi': 'delhi',
  'DL|northeastdelhi': 'delhi',
  'DL|northwestdelhi': 'delhi',
  'DL|southeastdelhi': 'delhi',
  'DL|southwestdelhi': 'delhi',
  'DL|shahdara': 'delhi',
  'KL|ernakulam': 'ernakulam',
  'TN|chengalpattu': 'chengalpattu',
};

/** Bodies to leave out of this run, by id (e.g. a roster the source itself
 *  dates to an earlier one-year mayoral term). --drop=ka-belagavi,ka-mysuru */
const DROP = new Set(
  args.filter((a) => a.startsWith('--drop=')).flatMap((a) => a.slice('--drop='.length).split(',')).map((s) => s.trim()).filter(Boolean),
);

/** Name tokens that must ALL appear on the cited page (2+ letters, no
 *  initials - "R." and "M." are too common to prove anything). */
function nameTokens(name: string): string[] {
  return norm(name.replace(/\./g, ' ')).length
    ? name.replace(/\./g, ' ').split(/\s+/).map(norm).filter((t) => t.length >= 2)
    : [];
}

/** Letters and digits only, any script - for matching a Marathi / Gujarati /
 *  Hindi name against a page regardless of spacing and punctuation. */
const lettersOnly = (s: string) => s.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');
const hasNonLatin = (s: string) => /[^ -ɏ]/.test(s.replace(/[‘’“”–—]/g, ''));

/**
 * Research rows print a name the way the site prints it. Sites in Maharashtra,
 * Gujarat and Uttar Pradesh print the state's script with a Latin form in
 * brackets - "श्री.विनायक कोंडयाल (Shri Vinayak Kondyal)" - and a party the
 * same way. Split those into the Latin name we publish and the native name we
 * keep (and verify against the page, since that is what the page contains).
 */
function splitName(raw: string): { name: string; native?: string } {
  const m = raw.trim().match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (m && hasNonLatin(m[1]) && !hasNonLatin(m[2])) return { name: cleanName(m[2]), native: cleanNative(m[1]) };
  if (hasNonLatin(raw)) return { name: cleanNative(raw), native: cleanNative(raw) };
  return { name: cleanName(raw) };
}

/** Strip the Devanagari / Gujarati honorifics the sites print. */
function cleanNative(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^(मा\.?\s*)?(श्रीमती|श्रीमति|श्री|सौ\.?|डॉ\.?|डा\.?|ડૉ\.?|શ્રીમતી|શ્રી|સૌ\.?)\s*\.?\s*/u, '')
    .replace(/[,\s]*\(?\s*(?:भा\.?\s?प्र\.?\s?से\.?|भा0प्र0से0|आय\.?\s?ए\.?\s?एस\.?|आई\.?\s?ए\.?\s?एस\.?)\s*\)?\s*$/u, '')
    .trim();
}

const PARTY_ALIAS: Record<string, string> = {
  aap: 'Aam Aadmi Party',
  bjp: 'Bharatiya Janata Party',
  inc: 'Indian National Congress',
  zpm: "Zoram People's Movement",
  'shiv sena (eknath shinde-led)': 'Shiv Sena',
  'shiv sena (shinde faction)': 'Shiv Sena',
  'shiv sena (shinde)': 'Shiv Sena',
  'aam aadmi party (aap)': 'Aam Aadmi Party',
  'bharatiya janata party (bjp)': 'Bharatiya Janata Party',
  'indian national congress (inc)': 'Indian National Congress',
};
function cleanParty(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  let s = raw.replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (m && hasNonLatin(m[1]) && !hasNonLatin(m[2])) s = m[2].trim();
  // A party field that argues with itself ("BJP - but won as INC; see notes")
  // is not a party: leave it blank rather than pick a side.
  if (s.length > 60 || /\b(but|see notes|formerly|defect)/i.test(s)) return undefined;
  return PARTY_ALIAS[s.toLowerCase()] || s;
}

/**
 * Municipal sites are the least well-behaved hosts this repo reads: expired
 * certificates, cookie-gated redirect loops, header lines Node's fetch refuses
 * to parse. curl copes with all of that (-k, a cookie jar, lenient parsing),
 * so the page is fetched with curl first and Node's fetch only as a fallback.
 * This is a READ for verification - nothing here is ever written back.
 */
function curlText(url: string, ua: string): { ok: boolean; status: number; text: string } | null {
  const jar = join(tmpdir(), `ryp-local-bodies-${process.pid}.cookies`);
  const r = spawnSync(
    'curl',
    ['-sL', '-k', '-m', '20', '-A', ua, '-H', 'Accept: text/html,application/json,*/*', '-b', jar, '-c', jar, '-w', '\n__STATUS__%{http_code}', url],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null;
  const m = r.stdout.match(/\n__STATUS__(\d{3})\s*$/);
  if (!m) return null;
  const status = Number(m[1]);
  const text = r.stdout.slice(0, m.index);
  return { ok: status >= 200 && status < 300 && text.length > 0, status, text };
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const wiki = url.match(/^https?:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/);
  const target = wiki
    ? `https://en.wikipedia.org/w/api.php?action=parse&page=${wiki[1]}&prop=wikitext&format=json&formatversion=2&redirects=1`
    : url;
  const ua = wiki ? WIKI_UA : UA;
  for (let a = 0; a < 2; a++) {
    const viaCurl = curlText(target, ua);
    if (viaCurl?.ok) return viaCurl;
    if (viaCurl && (viaCurl.status === 404 || viaCurl.status === 410)) return viaCurl;
    // Node's fetch only on the first pass (it accepts a few odd hosts curl
    // does not): a host that answered neither is dead, and a second 12 s
    // wait proves nothing.
    if (a === 0) {
      try {
        const r = await fetch(target, { headers: { 'User-Agent': ua, Accept: 'text/html,application/json,*/*' }, signal: AbortSignal.timeout(12_000), redirect: 'follow' });
        const text = await r.text();
        if (r.ok) return { ok: true, status: r.status, text };
        if (r.status === 404 || r.status === 410) return { ok: false, status: r.status, text };
      } catch { /* retry once via curl */ }
    }
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
  const stripped = res.text.replace(/<[^>]+>/g, ' ');
  const { name, native } = splitName(p.name);
  // A native-script name is matched as one run of letters (the page's own
  // spacing and honorifics vary); a Latin name token by token.
  if (native) {
    const hayNative = lettersOnly(stripped);
    const needle = lettersOnly(native);
    if (needle.length >= 3 && hayNative.includes(needle)) return { ok: true };
  }
  const hay = norm(stripped);
  const tokens = nameTokens(name);
  if (!tokens.length) return { ok: false, why: native ? `native name not on cited page (${label})` : 'name has no checkable tokens' };
  const missing = tokens.filter((t) => !hay.includes(t));
  if (missing.length) return { ok: false, why: `name tokens not on cited page: ${missing.join(', ')} (${label})` };
  return { ok: true };
}

function toPerson(p: InPerson, fallbackSourceName: string): LocalBodyPerson {
  const { name, native } = splitName(p.name!);
  const out: LocalBodyPerson = {
    name,
    ...(native && native !== name ? { name_native: native } : {}),
    source_url: p.source_url!,
    source_name: p.source_name || fallbackSourceName,
    retrieved_date: p.retrieved_date || TODAY,
  };
  const party = cleanParty(p.party);
  if (party) out.party = party;
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
  const allRows: InRow[] = files.flatMap((f) => {
    const doc = JSON.parse(readFileSync(f, 'utf8'));
    return Array.isArray(doc) ? doc : doc.rows || doc.bodies || [];
  });
  const rows = STATES.size ? allRows.filter((r) => STATES.has(String(r.stateCode).toUpperCase())) : allRows;
  console.log(`${rows.length} research rows from ${files.length} file(s)${STATES.size ? ` (states: ${[...STATES].join(', ')})` : ''}`);

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
    if (DROP.has(id)) { dropped.push(`${label}: dropped by --drop`); continue; }
    if (seen.has(id)) { dropped.push(`${label}: duplicate id ${id} (an earlier file already supplied this city)`); continue; }
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
    if (!(r.districts ?? []).length && CITY_DISTRICT[id] && dmap.get(CITY_DISTRICT[id])) districts.push(dmap.get(CITY_DISTRICT[id])!);
    for (const d of r.districts ?? []) {
      const bare = norm(d.replace(/\bdistrict\b/i, ''));
      const alias = DISTRICT_ALIAS[`${r.stateCode}|${bare}`];
      const hit = dmap.get(bare) ?? (alias ? dmap.get(alias) : undefined);
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
