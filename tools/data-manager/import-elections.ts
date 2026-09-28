/**
 * Build data/seed/elections.json from the Election Commission's own record.
 * LOCAL ONLY - never deployed.
 *
 * Source of truth is ECI's candidate-affidavit portal, which publishes EVERY
 * nomination for an election with its post-scrutiny status. We take all of them
 * - contesting, accepted, withdrawn and rejected - because "who tried to stand"
 * is part of the public record and showing only the survivors would misrepresent
 * the field.
 *
 * Two ECI quirks drive the design:
 *   - The per-candidate `show-profile/...` link is Laravel-encrypted with a
 *     random IV: it is different on every page load, so it is followed DURING
 *     the run and never stored. What we store is the stable list URL.
 *   - Seat names repeat across India, so seats are matched from the explicit
 *     registry in elections-shared.ts (state + AC number), never by name.
 *
 * Re-running is safe and non-destructive: enrichment added later by
 * enrich-candidates / fetch-election-results / link-candidates is merged
 * forward, never wiped. (A full re-import that discards enrichment is the
 * mistake that cost this repo a roster rebuild once already.)
 *
 * Usage:  npx tsx tools/data-manager/import-elections.ts            (dry run)
 *         npx tsx tools/data-manager/import-elections.ts --apply
 *         ELECTION_ONLY=ac-bye-2026-07 npx tsx ... --apply
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Constituency, ElectionCandidate, ElectionEvent, ElectionSeat, NominationStatus } from '../../lib/types';
import { seatSlug as makeSeatSlug } from '../../lib/elections';
import {
  EVENTS, SEED_DIR, PUBLIC_DIR, TODAY, ensureDir, fetchEci, fetchEciBinary,
  loadElections, saveElections, slug, seatKey, HELP_APPLY, type EventSpec,
} from './elections-shared';
import { pool } from './myneta';

const APPLY = process.argv.includes('--apply');
const ONLY = process.env.ELECTION_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
const CONCURRENCY = 4; // a government portal - stay gentle

// ---- HTML helpers ----------------------------------------------------------

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (ENT[k]) return ENT[k];
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });

const txt = (h: string) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Flatten a fragment into the visible text runs, in order. The affidavit pages
 *  are label-then-value tables, so a token stream reads them far more robustly
 *  than nested selectors would. */
function tokens(html: string): string[] {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .split(/<[^>]+>/)
    .map((s) => decode(s).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const LABELS = new Set([
  'Party Name:', 'Name:', 'Assembly constituency:', 'Parliamentary constituency:', 'State:',
  'Application Uploaded:', 'Current status:', 'Affidavit', 'Download', 'Download Count :',
  'Affidavit Uploaded On:', "Father's / Husband's Name:", 'Address:', 'Gender:', 'Age:',
  'Candidate Details', 'Candidate Personal Details', 'Back', 'Home',
]);

/** Values following `label`, up to the next known label. */
function valuesAfter(toks: string[], label: string, from = 0): string[] {
  const i = toks.indexOf(label, from);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < toks.length && !LABELS.has(toks[j]); j++) out.push(toks[j]);
  return out;
}

function statusOf(raw: string): NominationStatus | null {
  const s = raw.toLowerCase();
  if (s.includes('contest')) return 'contesting';
  if (s.includes('accept')) return 'accepted';
  if (s.includes('withdraw')) return 'withdrawn';
  if (s.includes('reject')) return 'rejected';
  // Before scrutiny every paper reads "Applied". Dropping those rows made a
  // seat with 154 papers filed look like one with no nominations at all.
  if (s.includes('appl')) return 'filed';
  return null;
}

/**
 * ECI's list is one row per NOMINATION PAPER, not per person: a candidate may
 * file up to four sets, and 22 of the 104 rows in the July 2026 by-poll are
 * repeat filings (one person filed three). Its own summary chips make the
 * distinction - "Accepted 64 / Rejected 35 / Withdrawn 5" count papers, while
 * "Contesting 48" counts people.
 *
 * So papers are folded into people before anything is stored. Verified safe:
 * across every multi-paper group in that election, all rows carry the SAME
 * candidate photo, so name+party identifies one human rather than merging two.
 *
 * Status across a person's papers, strongest signal first: a withdrawal is a
 * decision about the candidate, so it wins; otherwise one accepted paper puts
 * them on the ballot even if another was rejected; a paper still awaiting
 * scrutiny keeps them pending; only if every paper was rejected are they out.
 */
function resolveStatus(forms: ListRow[]): NominationStatus {
  if (forms.some((f) => f.status === 'withdrawn')) return 'withdrawn';
  if (forms.some((f) => f.status === 'accepted' || f.status === 'contesting')) return 'contesting';
  if (forms.some((f) => f.status === 'filed')) return 'filed';
  return 'rejected';
}

function foldPapersIntoPeople(rows: ListRow[]): { forms: ListRow[]; status: NominationStatus }[] {
  const groups = new Map<string, ListRow[]>();
  for (const r of rows) {
    const key = `${r.name.toLowerCase().replace(/\s+/g, ' ')}||${r.party.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((forms) => ({ forms, status: resolveStatus(forms) }));
}

// ---- ECI affidavit list ----------------------------------------------------

interface ListRow {
  name: string;
  party: string;
  status: NominationStatus;
  state: string;
  constituency: string;
  photoUrl?: string;
  /** Ephemeral - followed in this run, never stored. */
  profileUrl?: string;
}

function parseListPage(html: string): ListRow[] {
  const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
  const rows: ListRow[] = [];
  for (const tr of body.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const name = txt((tr.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i) || [])[1] || '');
    if (!name) continue;
    const field = (label: string) =>
      txt((tr.match(new RegExp(`<strong>\\s*${label}\\s*:\\s*</strong>([\\s\\S]*?)</p>`, 'i')) || [])[1] || '');
    const status = statusOf(field('Status'));
    if (!status) continue;
    rows.push({
      name,
      party: field('Party'),
      status,
      state: field('State'),
      constituency: field('Constituency'),
      photoUrl: (tr.match(/<img[^>]+src=["']([^"']+candprofile[^"']+)["']/i) || [])[1],
      profileUrl: (tr.match(/href=["'](https:\/\/affidavit\.eci\.gov\.in\/show-profile\/[^"']+)["']/i) || [])[1],
    });
  }
  return rows;
}

async function fetchAllNominations(spec: EventSpec): Promise<ListRow[]> {
  const base = `https://affidavit.eci.gov.in/CandidateCustomFilter?electionType=${spec.affidavit.electionType}&election=${spec.affidavit.election}`;
  const all: ListRow[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 60; page++) {
    const html = await fetchEci(page === 1 ? base : `${base}&page=${page}`);
    if (!html) break;
    const rows = parseListPage(html);
    if (rows.length === 0) break;
    // The portal serves the last page again past the end; stop on a repeat
    // rather than trusting a page count we cannot see.
    const key = rows.map((r) => `${r.constituency}|${r.name}|${r.status}`).join('~');
    if (seen.has(key)) break;
    seen.add(key);
    all.push(...rows);
    process.stdout.write(`\r  nominations: ${all.length}`);
  }
  process.stdout.write('\n');
  return all;
}

interface Detail {
  name_native?: string;
  party_native?: string;
  relative_name?: string;
  gender?: string;
  age?: number;
  filed_on?: string;
}

/** Follow one ephemeral profile link and read the fields ECI publishes.
 *  The residential address is deliberately NOT read: it adds nothing to an
 *  informed vote and would turn this into a harassment vector. */
function parseDetail(html: string): Detail {
  const toks = tokens(html);
  const d: Detail = {};

  const party = valuesAfter(toks, 'Party Name:');
  if (party[1]) d.party_native = party[1];

  // "Name:" appears twice - identity block, then personal details. The first
  // one carries the English/native pair.
  const name = valuesAfter(toks, 'Name:');
  if (name[1]) d.name_native = name[1];

  const filed = valuesAfter(toks, 'Application Uploaded:')[0];
  if (filed) d.filed_on = filed;

  const rel = valuesAfter(toks, "Father's / Husband's Name:");
  if (rel[0]) d.relative_name = rel[0];

  const g = valuesAfter(toks, 'Gender:')[0];
  if (g && /^(male|female|third gender|other)$/i.test(g)) d.gender = g.toLowerCase();

  const a = valuesAfter(toks, 'Age:')[0];
  if (a && /^\d{2,3}$/.test(a)) d.age = Number(a);

  return d;
}

// ---- photos ----------------------------------------------------------------

/** Mirror ECI's photo locally: one small WebP, served from our own origin.
 *  Hotlinking a government CDN puts a third-party request on the critical path
 *  of every candidate row and breaks silently when they reorganise. */
async function mirrorPhoto(url: string, seat: string, cand: string, refresh = false): Promise<string | undefined> {
  const rel = `/candidates/${seat}/${cand}.webp`;
  const abs = resolve(PUBLIC_DIR, 'candidates', seat, `${cand}.webp`);
  if (existsSync(abs) && !refresh) return rel;
  const buf = await fetchEciBinary(url);
  if (!buf || buf.length < 512) return undefined;
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(buf).resize(128, 128, { fit: 'cover', position: 'top' }).webp({ quality: 78 }).toBuffer();
    ensureDir(resolve(PUBLIC_DIR, 'candidates', seat));
    writeFileSync(abs, out);
    return rel;
  } catch (err) {
    console.warn(`  ! photo ${cand}: ${(err as Error).message}`);
    return undefined;
  }
}

/** Delete mirrored photos no seed record points at any more. Slugs shift when
 *  ECI corrects a name or a duplicate resolves, and orphaned images would
 *  otherwise be committed forever. */
function prunePhotos(events: ElectionEvent[]) {
  const keep = new Set(
    events.flatMap((e) => e.seats).flatMap((s) => s.candidates).map((c) => c.photo_path).filter(Boolean) as string[],
  );
  const root = resolve(PUBLIC_DIR, 'candidates');
  if (!existsSync(root)) return;
  let removed = 0;
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(resolve(root, dir.name))) {
      if (!keep.has(`/candidates/${dir.name}/${f}`)) {
        unlinkSync(resolve(root, dir.name, f));
        removed++;
      }
    }
  }
  if (removed) console.log(`  pruned ${removed} orphaned candidate photo(s)`);
}

// ---- main ------------------------------------------------------------------

/** Unique slug within a seat. Identical names on one ballot are real - Datia
 *  2026 has two "ASHUTOSH TIWARI" rows - so collisions get a numeric suffix
 *  rather than silently overwriting each other. */
function uniqueSlug(name: string, taken: Set<string>): string {
  const base = slug(name) || 'candidate';
  let s = base;
  for (let n = 2; taken.has(s); n++) s = `${base}-${n}`;
  taken.add(s);
  return s;
}

/** Letters only, with the "Late" honorific ECI adds or drops between papers. */
const squash = (s = '') => s.toLowerCase().replace(/\blate\b/g, '').replace(/[^a-z]/g, '');

/** Dice coefficient over letter bigrams: "hanif tamuli" vs "hanif tamuly" = 0.9. */
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  let hit = 0;
  for (const [g, n] of grams(b)) hit += Math.min(n, ga.get(g) ?? 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

/**
 * The same human under a respelled name. The final list the Returning Officer
 * publishes after scrutiny often spells a name differently from the paper filed
 * a week earlier - Oct 2026: "MOHAMMED BADARUDDIN AJMAL" became "MOHAMMED
 * BADRUDDIN AJMAL", "MD. INAMUL HUDA" became "INAMUL HUDA" (13 of 145 people).
 * The slug is the candidate's identity: it is the page URL and the vote key
 * (`cand:{seat}:{slug}`), and it carries the `politicianId` link that stops one
 * person being ratable twice. Minting a new slug for a respelling would orphan
 * every rating cast so far and silently re-open the double-rating hole.
 *
 * So a person whose new slug is unknown is matched to a previous candidate who
 * has vanished from this run, on what the affidavit says about them rather than
 * on the name: same age and gender, and the same parent/spouse name (or, where
 * that too was respelled, the same name). Party is deliberately NOT required -
 * ECI corrected two party labels in the same pass. Verified on all 13 Oct 2026
 * respellings: 9 carry byte-identical photos, the other 4 are the same faces.
 */
function sameHuman(
  now: { name: string; relative_name?: string; age?: number; gender?: string },
  before: ElectionCandidate,
): number {
  if (!now.age || now.age !== before.age) return 0;
  if (now.gender && before.gender && now.gender !== before.gender) return 0;
  const rel = dice(squash(now.relative_name), squash(before.relative_name));
  const name = dice(squash(now.name), squash(before.name));
  return rel >= 0.85 || (name >= 0.85 && rel >= 0.6) ? rel + name : 0;
}

async function main() {
  const constituencies: Constituency[] = JSON.parse(
    readFileSync(resolve(SEED_DIR, 'constituencies.json'), 'utf8'),
  );
  const byId = new Map(constituencies.map((c) => [c.id, c]));
  const existing = new Map(loadElections().map((e) => [e.id, e]));
  const out: ElectionEvent[] = [];
  let problems = 0;

  for (const spec of EVENTS) {
    if (ONLY && !ONLY.includes(spec.event.id)) {
      const keep = existing.get(spec.event.id);
      if (keep) out.push(keep);
      continue;
    }
    console.log(`\n${spec.event.id}  ${spec.event.title}`);
    const rows = await fetchAllNominations(spec);
    // While nominations are still open the portal is legitimately sparse: an
    // announced election with no papers filed yet is a real state of the world,
    // and the hub should say "nominations open until <date>" rather than hide
    // the seat. After the last date an empty list is a fetch failure.
    const nominationsOpen = TODAY <= spec.event.schedule.nominationLast;
    if (rows.length === 0 && !nominationsOpen) {
      console.error('  ✗ no nominations returned - leaving this event untouched');
      problems++;
      const keep = existing.get(spec.event.id);
      if (keep) out.push(keep);
      continue;
    }
    if (rows.length === 0) console.log(`  (nominations open until ${spec.event.schedule.nominationLast} - none filed yet)`);

    const prev = existing.get(spec.event.id);
    const prevSeats = new Map((prev?.seats ?? []).map((s) => [s.constituencyId, s]));
    const seats: ElectionSeat[] = [];

    for (const seatSpec of spec.seats) {
      const c = byId.get(seatSpec.constituencyId);
      if (!c) {
        console.error(`  ✗ ${seatSpec.constituencyId} is not in constituencies.json`);
        problems++;
        continue;
      }
      const mine = rows.filter(
        (r) => seatKey(r.constituency) === seatKey(c.name) && seatKey(r.state) === seatKey(c.state),
      );
      if (mine.length === 0 && !nominationsOpen) {
        console.error(`  ✗ ${c.name} (${c.state}): no nominations matched`);
        problems++;
        continue;
      }

      const sSlug = makeSeatSlug(c.name, c.stateCode, spec.event.schedule.pollDate);
      const before = prevSeats.get(c.id);
      const prevCand = new Map((before?.candidates ?? []).map((x) => [x.slug, x]));
      const taken = new Set<string>();
      const people = foldPapersIntoPeople(mine);

      // Read each person's details off whichever paper actually carries them.
      const read = await pool(people, CONCURRENCY, async (p) => {
        const r = p.forms.find((f) => f.profileUrl) ?? p.forms[0];
        const detail: Detail = r.profileUrl ? parseDetail((await fetchEci(r.profileUrl)) ?? '') : {};
        return { p, r, detail };
      });
      const slugs = read.map((x) => uniqueSlug(x.r.name, taken));
      // Keep a respelled person on their existing slug (see sameHuman).
      const reused = new Set<number>();
      const vanished = (before?.candidates ?? []).filter((o) => !slugs.includes(o.slug));
      for (let i = 0; i < read.length; i++) {
        if (prevCand.has(slugs[i])) continue;
        const scored = vanished
          .map((o) => ({ o, s: sameHuman({ name: read[i].r.name, ...read[i].detail }, o) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s);
        // Ambiguity (two plausible predecessors) is not guessed through.
        if (!scored.length || (scored[1] && scored[1].s === scored[0].s)) continue;
        const o = scored[0].o;
        vanished.splice(vanished.indexOf(o), 1);
        slugs[i] = o.slug;
        // Later runs land here too (the slug no longer derives from the name);
        // only an actual respelling is news, and only it can bring a new photo.
        if (o.name !== read[i].r.name) {
          console.log(`    ~ ${c.name}: "${o.name}" is now "${read[i].r.name}" - keeping /${o.slug}`);
          reused.add(i);
        }
      }

      const candidates = await pool(read, CONCURRENCY, async ({ p, r, detail }, i): Promise<ElectionCandidate> => {
        const photoUrl = p.forms.find((f) => f.photoUrl)?.photoUrl;
        const cs = slugs[i];
        // A respelled person usually filed the final paper with a fresh photo;
        // show that one rather than the superseded paper's.
        const photo = photoUrl ? await mirrorPhoto(photoUrl, sSlug, cs, reused.has(i)) : undefined;
        const old = prevCand.get(cs);
        return {
          slug: cs,
          name: r.name,
          party: r.party || 'Independent',
          status: p.status,
          ...detail,
          ...(photo ? { photo_path: photo } : old?.photo_path ? { photo_path: old.photo_path } : {}),
          // Everything below is added by later passes - carry it forward.
          ...(old?.politicianId ? { politicianId: old.politicianId } : {}),
          ...(old?.affidavit_url ? { affidavit_url: old.affidavit_url } : {}),
          ...(old?.criminal ? { criminal: old.criminal } : {}),
          facts: old?.facts ?? [],
          source_url: spec.event.affidavit_url ?? spec.event.source_url,
          source_name: 'Election Commission of India - Candidate Affidavit Management',
          retrieved_date: TODAY,
        };
      });

      // The Commission lists contesting candidates first; keep that order and
      // never impose our own, which would read as a ranking.
      const order: Record<NominationStatus, number> = { contesting: 0, accepted: 1, filed: 2, withdrawn: 3, rejected: 4 };
      candidates.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));

      seats.push({
        slug: sSlug,
        constituencyId: c.id,
        constituencyName: c.name,
        state: c.state,
        stateCode: c.stateCode,
        districts: c.districts,
        acNumber: seatSpec.acNo,
        eci: { stateCode: seatSpec.eciStateCode, acNo: seatSpec.acNo },
        ...(before?.vacancy_reason ? { vacancy_reason: before.vacancy_reason } : {}),
        ...(before?.electors ? { electors: before.electors } : {}),
        ...(before?.turnout_pct ? { turnout_pct: before.turnout_pct } : {}),
        ...(seatSpec.pollHoursUnconfirmed ? { pollHoursUnconfirmed: true } : {}),
        candidates,
        ...(before?.result ? { result: before.result } : {}),
      });

      const n = (s: NominationStatus) => candidates.filter((x) => x.status === s).length;
      console.log(
        `  ✓ ${c.name.padEnd(14)} ${String(mine.length).padStart(3)} papers -> ${String(candidates.length).padStart(3)} people ` +
          `(${n('filed') ? `${n('filed')} awaiting scrutiny, ` : ''}${n('contesting')} contesting, ${n('withdrawn')} withdrawn, ${n('rejected')} rejected)  -> /elections/${sSlug}`,
      );
    }

    out.push({ ...spec.event, retrieved_date: TODAY, seats });
  }

  // Any event in the seed that no longer has a spec stays as it is - the
  // archive is the point, and an old election must not vanish on a re-run.
  for (const [id, ev] of existing) if (!out.some((e) => e.id === id)) out.push(ev);
  out.sort((a, b) => b.schedule.pollDate.localeCompare(a.schedule.pollDate));

  const totals = out.flatMap((e) => e.seats).reduce((n, s) => n + s.candidates.length, 0);
  console.log(`\n${out.length} event(s), ${out.flatMap((e) => e.seats).length} seat(s), ${totals} candidates`);
  if (problems) console.log(`${problems} problem(s) reported above - nothing was guessed around them.`);

  if (!APPLY) {
    console.log(`\n${HELP_APPLY}`);
    return;
  }
  saveElections(out);
  prunePhotos(out);
  console.log(`\n✓ wrote data/seed/elections.json`);
  console.log('  Remember: `git add data/seed/elections.json public/candidates` BEFORE `npm run build` -');
  console.log('  the prebuild gate hashes only tracked files, so an untracked seed silently stale-skips.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
