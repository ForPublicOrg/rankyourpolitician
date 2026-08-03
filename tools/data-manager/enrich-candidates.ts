/**
 * Data-manager step: attach each ELECTION CANDIDATE's own sworn Form-26
 * affidavit - declared assets, liabilities, education, occupation, and the
 * case-by-case criminal record - from MyNeta (ADR). LOCAL ONLY - never deployed.
 *
 * WHY MyNeta AND NOT ECI. The Commission publishes the affidavit as a scan
 * behind a Laravel-encrypted, regenerated-per-request link (see
 * import-elections.ts), so there is nothing stable to cite and nothing
 * machine-readable to read. MyNeta/ADR transcribes the SAME sworn affidavits
 * into one stable page per candidate, and it is already this repo's cited source
 * for sitting members' declarations - so a candidate and the member they hope to
 * replace end up described from the same source, in the same words, instead of
 * the challenger looking mysteriously undocumented next to the incumbent.
 *
 * WHY THE POLL DATE IS PART OF THE SEAT MATCH. MyNeta has no folder of its own
 * for a by-poll: it appends the seat to the state's most recent GENERAL election
 * folder as one extra constituency id (Bankipur's 30-07-2026 by-poll is
 * constituency_id=252 of Bihar2025, just past the 243 general-election seats).
 * That folder therefore holds the same seat NAME twice - Gujarat2022 carries
 * both MANJALPUR (the 2022 general election) and "MANJALPUR : BYE ELECTION ON
 * 30-07-2026" - with entirely different candidates. Resolving a seat by name
 * alone would publish the 2022 field's affidavits as this by-poll's, so the page
 * title must also say BYE ELECTION ON <the event's own poll date>.
 *
 * WHY THE PARTY HAS TO AGREE TOO. Datia 2026 puts "DHARMENDRA SINGH ."
 * (Independent) and "DHARMENDRA SINGH PANWAR (GOLU BHAIYA)" (Right to Recall
 * Party) on one ballot, and MyNeta's row "Dharmendra Singh" name-matches BOTH.
 * Only the declared party separates them, so a match needs the name AND the
 * party; a candidate who still matches two rows, or none, is left completely
 * untouched and reported. Missing beats wrong.
 *
 * Everything is stored strictly as declared. A declared case is an accusation
 * pending before a court - never guilt - and nothing here is scored or ranked.
 *
 * Usage:  npx tsx tools/data-manager/enrich-candidates.ts            (dry run)
 *         npx tsx tools/data-manager/enrich-candidates.ts --apply
 *         npx tsx tools/data-manager/enrich-candidates.ts --apply --force
 *         ELECTION_ONLY=ac-bye-2026-07 npx tsx tools/data-manager/enrich-candidates.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ElectionCandidate, ElectionEvent, ElectionSeat, Fact } from '../../lib/types';
import { candidateRatingId } from '../../lib/elections';
import { ROOT, TODAY, HELP_APPLY, loadElections, saveElections } from './elections-shared';
import {
  getHtml, clean, consKey, seatClose, nameMatches, nameCouldBeSame,
  parseCandidatePage, parseCriminalDetail, candidateTitleName, candidateTitleSeat, fillFact, pool,
} from './myneta';

const APPLY = process.argv.includes('--apply');
/** Re-read candidates that already carry affidavit data, and re-scan the seat
 *  index. Both caches are the reason a NEWLY published by-poll or a corrected
 *  affidavit would otherwise be invisible to a re-run. */
const FORCE = process.argv.includes('--force');
const ONLY = process.env.ELECTION_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
const CACHE_DIR = resolve(ROOT, 'tools', 'data-manager', '.cache');
const CONCURRENCY = 6; // MyNeta is a small non-profit site - stay gentle

/**
 * State -> the MyNeta folder that hosts that state's by-elections.
 *
 * Every entry was read off myneta.info's own state list
 * (state_assembly.php?state=...), never guessed: the folder is the state's most
 * recent GENERAL election, because that is where MyNeta files every subsequent
 * by-poll. Confirmed live against the July 2026 by-polls:
 *   BR  Bihar2025          constituency_id=252  BANKIPUR : BYE ELECTION ON 30-07-2026
 *   GJ  Gujarat2022        constituency_id=618  MANJALPUR : BYE ELECTION ON 30-07-2026
 *   MP  MadhyaPradesh2023  constituency_id=234  DATIA : BYE ELECTION ON 30-07-2026
 *
 * A state whose folder has NOT been confirmed is deliberately absent here. Its
 * seats are then reported unresolved, which is loud and harmless; a guessed slug
 * would instead resolve quietly to some other state's or year's candidates.
 */
const MYNETA_SLUG: Record<string, string> = {
  BR: 'Bihar2025',
  GJ: 'Gujarat2022',
  MP: 'MadhyaPradesh2023',
};

/** '2026-07-30' -> '30-07-2026', the form MyNeta prints in a page title. */
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('-');

// ---- seat index ------------------------------------------------------------

interface SeatIndexRow {
  id: number;
  /** Seat name as the title prints it, e.g. "BANKIPUR", "KADI (SC)". */
  cons: string;
  /** DD-MM-YYYY when this page is a by-election, else null. */
  byeDate: string | null;
}

/**
 * Which constituency id in a folder is which seat. The ids are NOT the
 * Commission's AC numbers and are not contiguous, so the only way to find a seat
 * is to read every page's title - hundreds of requests per folder, which is why
 * the result is cached (the cache is gitignored and re-fetchable).
 *
 * Only the title is kept. The candidate ROWS of the one seat we resolve are
 * fetched fresh on every run instead: MyNeta adds candidates to a by-poll page
 * as it processes affidavits, and a cached row list would freeze the field as it
 * stood on the day of the scan.
 */
async function scanSeatIndex(slug: string): Promise<SeatIndexRow[] | null> {
  const cacheFile = resolve(CACHE_DIR, `bye-seats-${slug}.json`);
  if (!FORCE && existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));

  const index = await getHtml(`https://www.myneta.info/${slug}/`);
  if (!index) return null;
  const ids = [...new Set([...index.matchAll(/constituency_id=(\d+)/g)].map((m) => +m[1]))].sort((a, b) => a - b);
  if (!ids.length) return null;

  process.stdout.write(`  scanning MyNeta ${slug}: ${ids.length} seat pages… `);
  const rows = await pool(ids, CONCURRENCY, async (id) => {
    const html = await getHtml(`https://www.myneta.info/${slug}/index.php?action=show_candidates&constituency_id=${id}`);
    return html ? parseSeatTitle(html, id) : null;
  });
  const seats = rows.filter((r): r is SeatIndexRow => !!r);
  process.stdout.write(`indexed ${seats.length}\n`);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(seats));
  return seats;
}

/** "List of Candidates in BANKIPUR : BYE ELECTION ON 30-07-2026 : PATNA Bihar
 *  2025" -> the seat and the by-poll date. Null for an id that renders a Page
 *  Not Found. */
function parseSeatTitle(html: string, id: number): SeatIndexRow | null {
  const title = clean((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const m = title.match(/List of Candidates in (.+?)\s*:\s*(.+)$/i);
  if (!m) return null;
  return { id, cons: m[1].trim(), byeDate: (m[2].match(/BYE ELECTION ON (\d{2}-\d{2}-\d{4})/i) || [])[1] ?? null };
}

type SeatResolution = { row: SeatIndexRow } | { why: string };

/** The one page in this folder that is OUR seat's by-election on OUR poll date.
 *  Anything less than exactly one is an unresolved seat, never a best guess. */
function resolveSeat(rows: SeatIndexRow[], seat: ElectionSeat, pollDate: string): SeatResolution {
  const want = ddmmyyyy(pollDate);
  const onDate = rows.filter((r) => r.byeDate === want);
  if (!onDate.length) return { why: `no page in this folder is a BYE ELECTION ON ${want}` };

  const ck = consKey(seat.constituencyName);
  const exact = onDate.filter((r) => consKey(r.cons) === ck);
  // Transliteration tolerance only as a fallback, and only among pages already
  // narrowed to this poll date - seatClose is lenient enough that a whole
  // folder's worth of seats would give it too much room.
  const hits = exact.length ? exact : onDate.filter((r) => seatClose(consKey(r.cons), ck));
  if (!hits.length) {
    return { why: `no ${want} by-election page names this seat (folder has: ${onDate.map((r) => r.cons).join(', ')})` };
  }
  if (hits.length > 1) {
    return { why: `${hits.length} pages claim this seat on ${want}: ${hits.map((r) => `${r.cons} (id ${r.id})`).join(', ')}` };
  }
  return { row: hits[0] };
}

// ---- candidate rows --------------------------------------------------------

interface MyNetaRow {
  candidateId: string;
  name: string;
  party: string;
}

/** Every row of a seat page. parseSeatPage() in myneta.ts reads the same
 *  <tr>/candidate_id shape but keeps only the row flagged "Winner", which is all
 *  a settled election needs; a live ballot needs all of them. */
function parseSeatCandidates(html: string): MyNetaRow[] {
  const out: MyNetaRow[] = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const idm = tr.match(/candidate_id=(\d+)/);
    if (!idm) continue;
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => clean(x[1]));
    if (cells.length < 3) continue;
    const name = cells[1].replace(/\s*\bwinner\b\s*$/i, '').trim();
    if (!name) continue;
    out.push({ candidateId: idm[1], name, party: cells[2] || '' });
  }
  return out;
}

// ---- party agreement -------------------------------------------------------

const partyKey = (s: string) =>
  clean(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

/** First letters of the words: "Rashtriya Janata Dal" -> "rjd". */
const partyAcronym = (s: string) =>
  clean(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join('');

/**
 * Do the two sources name the same party? ECI writes it out in full
 * ("Bharatiya Janata Party", "Independent"); MyNeta abbreviates the big ones
 * ("BJP", "RJD", "IND") and writes the small ones out. So: compare normalised,
 * treat Independent/IND as one thing, and otherwise let an acronym stand in for
 * the spelled-out name.
 *
 * The acronym rule is ONLY ever a filter on a pair that already matched by name
 * within one seat, never a lookup key - acronyms collide ("BJP" is both
 * Bharatiya Janata Party and Bankipur's own Bihar Justice Party), and only the
 * name match keeps that harmless.
 */
const INDEPENDENT = /^(ind|independent)$/;

function partyAgrees(a: string, b: string): boolean {
  const ka = partyKey(a);
  const kb = partyKey(b);
  // One side is silent: nothing to contradict, so let the name decide.
  if (!ka || !kb) return true;
  if (ka === kb) return true;
  if (INDEPENDENT.test(ka) && INDEPENDENT.test(kb)) return true;
  const abbrev = (short: string, long: string) =>
    short.length >= 2 && short.length <= 6 && partyAcronym(long) === short;
  return abbrev(ka, b) || abbrev(kb, a);
}

// ---- what the affidavit page says ------------------------------------------

/** The candidate's OWN stated occupation. The page prints a "Spouse Profession"
 *  right beside it, which is a third party's information and is never read. */
function professionOf(html: string): string | undefined {
  const m = html.match(/<b>\s*Self Profession:\s*<\/b>\s*([^<]*)/i);
  if (!m) return undefined;
  const v = clean(m[1]);
  if (!v || /^(nan|n\/?a|not given|none|nil|others?|-)$/i.test(v)) return undefined;
  return v;
}

/** candidateTitleSeat() keeps the by-poll suffix MyNeta prints inside the
 *  constituency field ("BANKIPUR : BYE ELECTION ON 30-07-2026"); no seat
 *  comparison survives that, so it comes off before consKey sees it. */
const seatOfTitle = (s: string) => s.replace(/\s*:\s*BYE ELECTION.*$/i, '').trim();

// ---- matching --------------------------------------------------------------

interface Pairing {
  matched: { cand: ElectionCandidate; row: MyNetaRow }[];
  /** Our candidate -> several MyNeta rows, or several of ours -> one row. */
  ambiguous: string[];
  /** Name matched but the declared party did not - deliberately not a match. */
  partyClash: string[];
  /** No MyNeta row for this candidate at all. */
  absent: ElectionCandidate[];
}

function pairCandidates(cands: ElectionCandidate[], rows: MyNetaRow[]): Pairing {
  const out: Pairing = { matched: [], ambiguous: [], partyClash: [], absent: [] };
  const claims = new Map<string, ElectionCandidate[]>();

  for (const cand of cands) {
    const byName = rows.filter((r) => nameMatches(r.name, cand.name));
    const hits = byName.filter((r) => partyAgrees(r.party, cand.party));
    if (hits.length > 1) {
      out.ambiguous.push(`${cand.name} matches ${hits.length} MyNeta rows (${hits.map((r) => `${r.name} / ${r.party}`).join('; ')})`);
      continue;
    }
    if (hits.length === 0) {
      if (byName.length) {
        out.partyClash.push(`${cand.name} (${cand.party}) vs MyNeta ${byName.map((r) => `${r.name} / ${r.party}`).join('; ')}`);
      } else {
        out.absent.push(cand);
      }
      continue;
    }
    claims.set(hits[0].candidateId, [...(claims.get(hits[0].candidateId) ?? []), cand]);
  }

  // The mirror image of the ambiguity above: one MyNeta row that two of our
  // candidates both claim. Neither claim can be trusted, so both are dropped.
  for (const [candidateId, owners] of claims) {
    const row = rows.find((r) => r.candidateId === candidateId)!;
    if (owners.length > 1) {
      out.ambiguous.push(`MyNeta row "${row.name}" (${row.party}) is claimed by ${owners.map((c) => c.name).join(' and ')}`);
      continue;
    }
    out.matched.push({ cand: owners[0], row });
  }
  return out;
}

// ---- main ------------------------------------------------------------------

interface SeatReport {
  line: string;
  notes: string[];
}

async function enrichSeat(ev: ElectionEvent, seat: ElectionSeat): Promise<SeatReport> {
  const notes: string[] = [];
  const where = `${seat.constituencyName} (${seat.stateCode})`;
  const slug = MYNETA_SLUG[seat.stateCode];
  if (!slug) {
    return { line: `  ✗ ${where}: no confirmed MyNeta folder for this state - nothing written`, notes };
  }

  const index = await scanSeatIndex(slug);
  if (!index?.length) {
    return { line: `  ✗ ${where}: MyNeta folder ${slug} unreachable - nothing written`, notes };
  }

  const want = ddmmyyyy(ev.schedule.pollDate);
  const resolved = resolveSeat(index, seat, ev.schedule.pollDate);
  if ('why' in resolved) {
    return { line: `  ✗ ${where}: ${resolved.why}`, notes };
  }

  const seatUrl = `https://www.myneta.info/${slug}/index.php?action=show_candidates&constituency_id=${resolved.row.id}`;
  const seatHtml = await getHtml(seatUrl);
  if (!seatHtml) return { line: `  ✗ ${where}: ${seatUrl} unreachable - nothing written`, notes };
  const rows = parseSeatCandidates(seatHtml);

  const pairing = pairCandidates(seat.candidates, rows);
  const label = `${seat.constituencyName} by-election ${want}`;

  // Resume: a candidate that already carries an affidavit_url was read from this
  // same source on an earlier run. Facts are fill-only anyway, so a re-read costs
  // network and changes nothing - --force is how you ask for it.
  const targets = pairing.matched.filter(({ cand }) => FORCE || !cand.affidavit_url);
  const skipped = pairing.matched.length - targets.length;

  const pages = await pool(targets, CONCURRENCY, async ({ cand, row }) => {
    const url = `https://www.myneta.info/${slug}/candidate.php?candidate_id=${row.candidateId}`;
    return { cand, url, html: await getHtml(url) };
  });

  let facts = 0;
  let records = 0;
  let written = 0;

  for (const { cand, url, html } of pages) {
    if (!html) { notes.push(`${cand.name}: ${url} unreachable - re-run to retry`); continue; }

    // The page must still be about this candidate, in this seat, at THIS poll.
    // The join was made off a seat page, so all three hold by construction today;
    // they are re-checked because MyNeta reassigns candidate ids between
    // re-analyses, and a silently reassigned id is how one person's criminal
    // record gets printed under another person's name.
    const pageName = candidateTitleName(html);
    const pageSeat = candidateTitleSeat(html);
    const pageBye = pageSeat ? (pageSeat.match(/BYE ELECTION ON (\d{2}-\d{2}-\d{4})/i) || [])[1] : undefined;
    if (!pageName || !nameCouldBeSame(cand.name, pageName)) {
      notes.push(`${cand.name}: page is titled "${pageName}" - left untouched (${url})`);
      continue;
    }
    if (!pageSeat || !seatClose(consKey(seatOfTitle(pageSeat)), consKey(seat.constituencyName)) || pageBye !== want) {
      notes.push(`${cand.name}: page says "${pageSeat}", not ${seat.constituencyName} on ${want} - left untouched (${url})`);
      continue;
    }

    const cite: Omit<Fact, 'field_type' | 'value'> = {
      source_url: url,
      source_name: `MyNeta / ADR - ${label}`,
      retrieved_date: TODAY,
      as_of: label,
    };

    const aff = parseCandidatePage(html);
    let added = 0;
    for (const f of ['assets_total', 'liabilities_total', 'criminal_cases_declared', 'education'] as const) {
      const v = aff[f];
      if (v && fillFact(cand.facts, f, v, cite)) added++;
    }
    const profession = professionOf(html);
    if (profession && fillFact(cand.facts, 'profession', profession, cite)) added++;

    const detail = parseCriminalDetail(html);
    if (detail.declared_total) {
      if (detail.cases.length !== detail.declared_total) {
        notes.push(`${cand.name}: declares ${detail.declared_total} cases but the page lists ${detail.cases.length} rows (kept verbatim)`);
      }
      cand.criminal = {
        // The candidate's RATING id, not a politician id: a candidate lives in
        // its own namespace precisely so it can never be mistaken for - or
        // collide with - a sitting member (see lib/elections.ts).
        politician_id: candidateRatingId(seat.slug, cand.slug),
        declared_total: detail.declared_total,
        charges: detail.charges,
        cases: detail.cases,
        source_url: url,
        source_name: cite.source_name,
        retrieved_date: TODAY,
        as_of: label,
      };
      records++;
    } else if (detail.declared_total === 0 && cand.criminal) {
      // The page now declares none. Keeping a record the cited page contradicts
      // would be worse than having none - the count fact carries the zero.
      delete cand.criminal;
    }

    cand.affidavit_url = url;
    facts += added;
    written++;
  }

  const total = seat.candidates.length;
  const fray = pairing.absent.filter((c) => c.status === 'contesting');
  const out: SeatReport = {
    line:
      `  ✓ ${where.padEnd(18)} matched ${String(pairing.matched.length).padStart(2)}/${total} candidates ` +
      `(${rows.length} MyNeta rows, id ${resolved.row.id}) -> ${written} read, +${facts} facts, ${records} criminal record(s)` +
      (skipped ? `, ${skipped} already had data (--force to re-read)` : ''),
    notes,
  };

  if (fray.length) {
    out.notes.push(`no MyNeta row for ${fray.length} CONTESTING candidate(s): ${fray.map((c) => `${c.name} (${c.party})`).join(', ')}`);
  }
  const other = pairing.absent.filter((c) => c.status !== 'contesting');
  if (other.length) {
    // Expected, not a gap: MyNeta analyses the field that actually stands, so a
    // withdrawn or rejected nomination usually has no page at all.
    out.notes.push(`no MyNeta row for ${other.length} withdrawn/rejected candidate(s) - expected`);
  }
  for (const a of pairing.ambiguous) out.notes.push(`AMBIGUOUS, left untouched: ${a}`);
  for (const p of pairing.partyClash) out.notes.push(`party disagrees, left untouched: ${p}`);
  return out;
}

async function main() {
  const events = loadElections();
  if (!events.length) {
    console.error('data/seed/elections.json is empty - run import-elections.ts first.');
    process.exit(1);
  }

  let touched = 0;
  for (const ev of events) {
    if (ONLY && !ONLY.includes(ev.id)) continue;
    console.log(`\n${ev.id}  ${ev.title}  (poll ${ev.schedule.pollDate})`);
    for (const seat of ev.seats) {
      const { line, notes } = await enrichSeat(ev, seat);
      console.log(line);
      for (const n of notes) console.log(`      · ${n}`);
      touched++;
    }
  }

  if (!touched) {
    console.log(`\nNo seats selected${ONLY ? ` for ELECTION_ONLY=${ONLY.join(',')}` : ''}.`);
    return;
  }

  if (!APPLY) {
    console.log(`\n${HELP_APPLY}`);
    return;
  }
  saveElections(events);
  console.log('\n✓ wrote data/seed/elections.json');
  console.log('  Remember: `git add data/seed/elections.json` BEFORE `npm run build` -');
  console.log('  the prebuild gate hashes only tracked files, so an untracked seed silently stale-skips.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
