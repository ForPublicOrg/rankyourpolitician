/**
 * Data-manager step: photos for the TOP offices that the general enrich-photos
 * pass never reaches. enrich-photos only walks politicians.json (records with a
 * Wikidata QID). Two kinds of top leader sit outside that file:
 *
 *   - The constitutional offices (President, Vice-President, Speaker, Leaders of
 *     the Opposition) in data/seed/constitutional_offices.json.
 *   - Union ministers with no linked MP/MLA profile to borrow a portrait from
 *     (or whose linked profile itself has no photo).
 *
 * On the /india and org-chart cards these render as bare initials. This pass,
 * for every such record still WITHOUT a resolvable photo, finds the Wikidata
 * entity - by an existing QID, else a name search verified against the entity's
 * own description - takes the entity image (P18), and keeps it ONLY when the
 * file lives on Wikimedia Commons (i.e. is freely licensed). The Commons licence
 * is stored in photo_license for attribution. Fill-only: never overwrites, and a
 * record whose photo already resolves (its own, or its linked profile's) is left
 * untouched.
 *
 * Missing beats wrong: a name search whose top hit does not describe an Indian
 * public figure, an entity with no P18, or an image not hosted on Commons is
 * skipped and reported, never guessed.
 *
 * Usage:  npm run dm -- enrich-office-photos          (writes the seed)
 *         DRY=1 npm run dm -- enrich-office-photos     (report only, no writes)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { ConstitutionalOffice, Minister, Politician } from '../../lib/types';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SEED = (f: string) => resolve(ROOT, 'data', 'seed', f);
const WD_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'RankYourPolitician-DataManager/1.0 (civic info; vikas070696@gmail.com)';
const DRY = !!process.env.DRY;

// A name-search hit is only trusted when its description marks it as an Indian
// public figure / office holder - the guard against matching a namesake.
const DESC_OK = /\b(india|indian|president|vice[- ]?president|minister|politician|lok sabha|rajya sabha|member of parliament|mp|mla|speaker|leader of the opposition)\b/i;

async function api(base: string, params: Record<string, string>): Promise<any> {
  const u = base + '?format=json&formatversion=2&origin=*&' + new URLSearchParams(params);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      if (r.ok) return r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (attempt === 4) throw e;
    }
    await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
  }
}

/** Resolve a Wikidata QID for a name, trusting only a description that marks an
 *  Indian public figure. Returns null rather than guess a namesake. */
async function resolveQid(name: string): Promise<{ qid: string; label: string; desc: string } | null> {
  const j = await api(WD_API, { action: 'wbsearchentities', language: 'en', type: 'item', limit: '5', search: name });
  for (const hit of j.search || []) {
    if (hit.description && DESC_OK.test(hit.description)) return { qid: hit.id, label: hit.label, desc: hit.description };
  }
  return null;
}

/** The entity's image (P18) filename, plus its English label for a sanity log. */
async function entityImage(qid: string): Promise<{ file?: string; label?: string }> {
  const j = await api(WD_API, { action: 'wbgetentities', ids: qid, props: 'claims|labels' });
  const e = j.entities?.[qid];
  return { file: e?.claims?.P18?.[0]?.mainsnak?.datavalue?.value, label: e?.labels?.en?.value };
}

/** Commons licence for a file, or null when it does not live on Commons (i.e.
 *  is a local fair-use upload we must not attach). */
async function commonsLicense(file: string): Promise<string | null> {
  const j = await api(COMMONS_API, { action: 'query', prop: 'imageinfo', iiprop: 'extmetadata', titles: `File:${file}` });
  const pg = (j.query?.pages || [])[0];
  if (!pg || pg.missing) return null;
  return pg.imageinfo?.[0]?.extmetadata?.LicenseShortName?.value || 'See Wikimedia Commons';
}

const commonsUrl = (file: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=400`;

/** Write JSON back in the file's own newline convention so the diff stays minimal. */
function writeSeed(path: string, obj: unknown) {
  const raw = readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let out = JSON.stringify(obj, null, 2);
  if (crlf) out = out.replace(/\n/g, '\r\n');
  writeFileSync(path, out + (crlf ? '\r\n' : '\n'));
}

type Target = { kind: 'office'; rec: ConstitutionalOffice } | { kind: 'minister'; rec: Minister };

async function main() {
  const pols: Politician[] = JSON.parse(readFileSync(SEED('politicians.json'), 'utf8'));
  const offices: ConstitutionalOffice[] = JSON.parse(readFileSync(SEED('constitutional_offices.json'), 'utf8'));
  const ministers: Minister[] = JSON.parse(readFileSync(SEED('central_government.json'), 'utf8'));
  const byId = new Map(pols.map((p) => [p.id, p]));

  // A record needs a photo when neither its own field nor its linked profile has one.
  const linkedPhoto = (id?: string) => (id ? byId.get(id)?.photo_url : undefined);
  const linkedQid = (id?: string) => (id ? byId.get(id)?.wikidata_qid : undefined);

  const targets: Target[] = [
    ...offices.filter((o) => !o.photo_url && !linkedPhoto(o.politicianId)).map((rec) => ({ kind: 'office' as const, rec })),
    ...ministers.filter((m) => !m.photo_url && !linkedPhoto(m.politicianId)).map((rec) => ({ kind: 'minister' as const, rec })),
  ];

  console.log(`${DRY ? '[DRY] ' : ''}Top-office records without a resolvable photo: ${targets.length}`);
  let added = 0;
  const skipped: string[] = [];
  let officesChanged = false;
  let ministersChanged = false;

  for (const t of targets) {
    const { rec } = t;
    const who = `${t.kind === 'office' ? (rec as ConstitutionalOffice).title : (rec as Minister).rank} - ${rec.name}`;

    let qid = rec.wikidata_qid || linkedQid(rec.politicianId);
    if (!qid) {
      const found = await resolveQid(rec.name);
      if (!found) {
        skipped.push(`${who}: no trusted Wikidata match`);
        continue;
      }
      qid = found.qid;
    }

    const { file, label } = await entityImage(qid);
    if (!file) {
      skipped.push(`${who}: ${qid} has no image (P18)`);
      continue;
    }
    const license = await commonsLicense(file);
    if (!license) {
      skipped.push(`${who}: image "${file}" is not on Wikimedia Commons (not free)`);
      continue;
    }

    console.log(`  ✓ ${who}  ->  ${qid} (${label})  ${file}  [${license}]`);
    if (!DRY) {
      rec.photo_url = commonsUrl(file);
      rec.photo_license = `${license} · Wikimedia Commons`;
      if (!rec.wikidata_qid) rec.wikidata_qid = qid;
      if (t.kind === 'office') officesChanged = true;
      else ministersChanged = true;
    }
    added++;
  }

  if (!DRY) {
    if (officesChanged) writeSeed(SEED('constitutional_offices.json'), offices);
    if (ministersChanged) writeSeed(SEED('central_government.json'), ministers);
  }

  console.log(`\n${DRY ? '[DRY] would add' : '✓ added'} ${added} photo(s).`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} (left as initials - missing beats wrong):`);
    for (const s of skipped) console.log('  - ' + s);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
