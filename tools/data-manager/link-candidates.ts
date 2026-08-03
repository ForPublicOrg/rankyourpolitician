/**
 * Data-manager step: LINK an election candidate to the profile of the SAME
 * HUMAN in data/seed/politicians.json, by setting
 * `ElectionCandidate.politicianId`. LOCAL ONLY - never deployed.
 *
 * WHY THIS IS NOT A COSMETIC JOIN
 * Candidates are ratable (`cand:{seat}:{slug}`) and so are sitting members
 * (`/person/{id}`). One human ratable under two ids means one visitor can rate
 * them twice, once under each - the double-vote vector this repo has already
 * shipped once, through a duplicate ratable page for a minister. A candidate
 * carrying politicianId is NOT separately ratable: their page redirects to
 * /person/{id}. This command is what sets that flag.
 *
 * THE HARM IS ASYMMETRIC, so the rules are asymmetric. An unlinked candidate is
 * a rating that could have been merged. A WRONGLY linked candidate redirects a
 * reader to a different person's profile and files their rating there - a false
 * claim about a named human, made in public. Missing beats wrong, so nothing is
 * written on anything less than the evidence below, and every refusal is
 * printed rather than quietly swallowed.
 *
 * EVIDENCE REQUIRED (all of it, or nothing is written)
 *   - the politician's stateCode is the seat's stateCode. Names repeat across
 *     India; nameMatches() is documented as safe only inside such an anchor.
 *   - party agrees, normalised - or a party_history entry does (a defector's
 *     roster party is their new one, the ballot carries the one they stood on).
 *   - the name matches, at a strength that depends on the anchor available:
 *
 *       (a) SEAT-ANCHORED: p.constituencyId === seat.constituencyId. This is
 *           the case this command exists for - once a result is frozen, the
 *           roster commands add the winner as a sitting member, and from that
 *           moment they are ratable in two places. The seat is a hard anchor,
 *           so the lenient nameMatches() (transliteration, aliases, extra given
 *           names) is safe here, exactly as in enrich-affidavits-byseat.
 *
 *       (b) NO SEAT ANCHOR (a sitting MP or another seat's MLA contesting this
 *           by-poll): names must be TOKEN-IDENTICAL, modulo romanisation.
 *           nameMatches() alone is provably not enough here - run against
 *           today's seed it pairs Bankipur's candidate "NEERAJ KUMAR" (BJP)
 *           with Chhatapur's sitting MLA "Neeraj Kumar Singh" (BJP), and
 *           Manjalpur's "SATENDRABHAI PATEL" with two different Gujarat MLAs
 *           surnamed Patel, on its subset and initials rules. Those are
 *           different people; this is the "Aditya Kumar" / "Aditya Kumar
 *           Shorya" class of error that already cost this dataset once.
 *
 *   - the declared ages do not contradict each other, where both are stated
 *     (rule (b) only - under (a) the seat already corroborates). ECI publishes
 *     the candidate's age; the roster's `age` fact usually implies a birth year.
 *     Two same-named, same-party people in one state are usually a generation
 *     apart, and this is the only independent signal we hold.
 *
 * AMBIGUITY IS FATAL, NOT RESOLVABLE. Two politicians passing the same tests
 * means the evidence does not identify one human, so neither is linked and both
 * are reported. Picking "the best" would be guessing.
 *
 * The reverse hazard is checked too: a politicianId whose target has left
 * politicians.json redirects a reader into a 404. `--unlink` removes such a
 * link (and any other that review finds wrong).
 *
 * Usage:  npx tsx tools/data-manager/link-candidates.ts                  (dry run)
 *         npx tsx tools/data-manager/link-candidates.ts --apply
 *         npx tsx tools/data-manager/link-candidates.ts --unlink cand:datia-mp-2026-07:xyz --apply
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ElectionCandidate, ElectionEvent, ElectionSeat, Politician } from '../../lib/types';
import { candidateRatingId } from '../../lib/elections';
import { SEED_DIR, loadElections, saveElections, HELP_APPLY } from './elections-shared';
import { initials, nameMatches, nameTokens, nameVariants, translitKey } from './myneta';

const APPLY = process.argv.includes('--apply');
const UNLINK = (() => {
  const i = process.argv.indexOf('--unlink');
  return i > 0 ? (process.argv[i + 1] ?? '') : null;
})();

// ---- party -----------------------------------------------------------------

/** "Independent politician" (Wikidata), "Independent (politician)" and ECI's
 *  "Independent"/"IND" are one thing; standing unaffiliated is not a party. */
const INDEPENDENT = /^(ind|independent)$/;

const partyKey = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bpolitician\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');

/**
 * Same party? Exact after normalisation, else the same consonant skeleton.
 *
 * The skeleton is needed because the roster carries three romanisations of one
 * party - "Bharatiya Janata Party", "Bharatiya Janta Party", "Bhartiya Janata
 * Party" (2240/51/49 records) - while ECI prints a fourth spelling of whatever
 * the party registered. It is EXACT skeleton equality with no edit slack, which
 * is what keeps the splits apart: "Lok Jan Shakti Party" (lksnsktprt) and "Lok
 * Janshakti Party (Ram Vilas)" (lksnsktprtrmvls) are two different parties, as
 * are CPI and CPI(M), and all of those keep different skeletons.
 */
function partyAgrees(a: string, b: string): boolean {
  const ka = partyKey(a), kb = partyKey(b);
  if (!ka || !kb) return false;
  if (INDEPENDENT.test(ka) && INDEPENDENT.test(kb)) return true;
  if (ka === kb) return true;
  const sa = translitKey(ka), sb = translitKey(kb);
  return sa.length >= 6 && sa === sb;
}

/** How this politician's affiliation reaches the candidate's, or null. */
function partyEvidence(p: Politician, c: ElectionCandidate): string | null {
  if (partyAgrees(p.party, c.party)) return 'party';
  const h = p.party_history?.find((x) => partyAgrees(x.party, c.party));
  return h ? `party-history "${h.party}"` : null;
}

// ---- names -----------------------------------------------------------------

/**
 * The STRICT name test used when no seat anchors the comparison: the two names
 * carry the same tokens, one for one, each pair either identical or the same
 * name romanised differently. No subset rule, no extra given name, and the
 * initials must agree on both sides - every one of those leniencies in
 * nameMatches() is what pairs "Neeraj Kumar" with "Neeraj Kumar Singh", or
 * "SATENDRABHAI PATEL" with "R. C. Patel".
 *
 * A skeleton pairing needs >=3 consonants, so short tokens ("Devi", "Rai") must
 * match outright: on a bare name+party pool a two-consonant skeleton is not
 * evidence of anything.
 */
function sameNameStrict(a: string, b: string): boolean {
  for (const va of nameVariants(a)) {
    for (const vb of nameVariants(b)) {
      const A = nameTokens(va), B = nameTokens(vb);
      if (A.length < 2 || A.length !== B.length) continue;
      if (initials(va).join('') !== initials(vb).join('')) continue;
      const rest = [...B];
      const take = (pred: (t: string) => boolean) => {
        const i = rest.findIndex(pred);
        if (i < 0) return false;
        rest.splice(i, 1);
        return true;
      };
      // Exact pairs first, so an exact twin is never consumed by a skeleton
      // pairing and its own partner then left stranded.
      const unpaired = A.filter((t) => !take((u) => u === t));
      const ok = unpaired.every((t) => {
        const k = translitKey(t);
        return k.length >= 3 && take((u) => translitKey(u) === k);
      });
      if (ok && rest.length === 0) return true;
    }
  }
  return false;
}

// ---- age -------------------------------------------------------------------

/**
 * Birth year implied by the roster's `age` fact, or null. Wikidata states it
 * outright ("Born 19 June 1950 (age 76)"); an affidavit-sourced fact states
 * only the age, which is an age AS OF ITS OWN RETRIEVAL DATE - so it is turned
 * into a birth year rather than compared to a number from another year.
 */
function rosterBirthYear(p: Politician): number | null {
  const f = p.facts.find((x) => x.field_type === 'age');
  if (!f) return null;
  const born = f.value.match(/\b(1[89]\d{2}|20[0-2]\d)\b/);
  if (born) return Number(born[1]);
  const age = f.value.match(/\(age\s*(\d{1,3})\)/i) ?? f.value.match(/^\s*(\d{1,3})\s*$/);
  const at = Number((f.retrieved_date || '').slice(0, 4));
  return age && at ? at - Number(age[1]) : null;
}

/** Do the two declared ages rule this out? Only ever a veto - an agreeing age
 *  is corroboration, never on its own a reason to link. Two years of slack:
 *  ECI's age is as of nomination and rosters round to the year. */
function ageContradicts(p: Politician, c: ElectionCandidate, pollDate: string): number | null {
  if (!c.age) return null;
  const rb = rosterBirthYear(p);
  if (!rb) return null;
  const cb = Number(pollDate.slice(0, 4)) - c.age;
  const gap = Math.abs(cb - rb);
  return gap > 2 ? gap : null;
}

// ---- matching --------------------------------------------------------------

interface Near {
  p: Politician;
  /** Why it qualifies, or why it does not - printed either way. */
  why: string;
  ok: boolean;
}

function examine(c: ElectionCandidate, seat: ElectionSeat, pollDate: string, inState: Politician[]): Near[] {
  return inState
    .filter((p) => nameMatches(p.name, c.name)) // the floor, never the ceiling
    .map((p) => {
      const seatAnchor = p.constituencyId === seat.constituencyId;
      if (!seatAnchor && !sameNameStrict(p.name, c.name)) {
        return { p, ok: false, why: `name differs beyond romanisation ("${p.name}") and no seat anchor` };
      }
      const party = partyEvidence(p, c);
      if (!party) return { p, ok: false, why: `party disagrees (${p.party} vs ${c.party})` };
      if (!seatAnchor) {
        const gap = ageContradicts(p, c, pollDate);
        if (gap) return { p, ok: false, why: `declared ages ${gap} years apart` };
      }
      return { p, ok: true, why: seatAnchor ? `same seat + name + ${party}` : `name + ${party} in ${p.stateCode}` };
    });
}

// ---- unlink ----------------------------------------------------------------

function unlink(events: ElectionEvent[], ratingId: string): boolean {
  for (const ev of events) {
    for (const s of ev.seats) {
      for (const c of s.candidates) {
        if (candidateRatingId(s.slug, c.slug) !== ratingId) continue;
        if (!c.politicianId) {
          console.log(`${ratingId} carries no politicianId - nothing to remove.`);
          return false;
        }
        console.log(`${ratingId}  ${c.name}\n  unlink from ${c.politicianId}`);
        delete c.politicianId;
        return true;
      }
    }
  }
  console.log(`✗ no candidate with rating id ${ratingId} (expected \`cand:{seat-slug}:{candidate-slug}\`).`);
  return false;
}

// ---- main ------------------------------------------------------------------

function main() {
  const pols: Politician[] = JSON.parse(readFileSync(resolve(SEED_DIR, 'politicians.json'), 'utf8'));
  const byId = new Map(pols.map((p) => [p.id, p]));
  const byState = new Map<string, Politician[]>();
  for (const p of pols) {
    if (!byState.has(p.stateCode)) byState.set(p.stateCode, []);
    byState.get(p.stateCode)!.push(p);
  }

  const events = loadElections();
  const allCandidates = events.flatMap((ev) =>
    ev.seats.flatMap((s) => s.candidates.map((c) => ({ ev, s, c }))),
  );

  if (UNLINK !== null) {
    const changed = unlink(events, UNLINK);
    if (changed && APPLY) {
      saveElections(events);
      console.log('✓ wrote data/seed/elections.json');
    } else if (changed) {
      console.log(`\n${HELP_APPLY}`);
    }
    return;
  }

  const proposals: { s: ElectionSeat; c: ElectionCandidate; p: Politician; why: string }[] = [];
  const refused: string[] = [];
  let already = 0;

  for (const { ev, s, c } of allCandidates) {
    if (c.politicianId) { already++; continue; }
    const nears = examine(c, s, ev.schedule.pollDate, byState.get(s.stateCode) ?? []);
    const ok = nears.filter((n) => n.ok);
    const where = `${s.slug}/${c.slug}`;
    if (ok.length === 1) {
      proposals.push({ s, c, p: ok[0].p, why: ok[0].why });
      continue;
    }
    if (ok.length > 1) {
      // Two profiles fit the same evidence, so the evidence does not identify a
      // human. Neither is linked - a redirect to the wrong profile is worse
      // than no redirect at all.
      refused.push(`${where}: AMBIGUOUS - ${ok.map((n) => `${n.p.id} (${n.p.name}, ${n.p.constituencyName})`).join(' | ')}`);
      continue;
    }
    for (const n of nears) refused.push(`${where}: ${n.p.id} - ${n.why}`);
  }

  // ---- report -------------------------------------------------------------

  console.log(`${allCandidates.length} candidates in ${events.length} event(s); ${already} already linked.\n`);

  if (proposals.length) {
    console.log(`Proposed links (${proposals.length}):`);
    const w = Math.max(...proposals.map((x) => `${x.s.slug}/${x.c.slug}`.length));
    for (const x of proposals) {
      console.log(
        `  ${`${x.s.slug}/${x.c.slug}`.padEnd(w)}  ${x.c.name} (${x.c.party})\n` +
          `  ${' '.repeat(w)}  -> ${x.p.id}  ${x.p.name} (${x.p.party}, ${x.p.constituencyName})  [${x.why}]`,
      );
    }
  } else {
    console.log('Proposed links: none.');
  }

  if (refused.length) {
    // Not failures. Every line here is a candidate whose name reached a
    // profile but whose evidence stopped short - printed so the gap is visible
    // and can be curated, never silently linked.
    console.log(`\nConsidered and NOT linked (${refused.length}) - evidence short of the bar:`);
    for (const r of refused) console.log(`  - ${r}`);
  }

  // ---- reverse hazards ----------------------------------------------------

  const dangling = allCandidates.filter(({ c }) => c.politicianId && !byId.has(c.politicianId));
  if (dangling.length) {
    console.log(`\n✗ DANGLING links (${dangling.length}) - the profile is gone, so the redirect 404s:`);
    for (const { s, c } of dangling) {
      console.log(`  - ${candidateRatingId(s.slug, c.slug)} -> ${c.politicianId} (not in politicians.json)`);
    }
    console.log('  Fix by re-adding the profile, or: npx tsx tools/data-manager/link-candidates.ts --unlink <id> --apply');
  }

  const byTarget = new Map<string, string[]>();
  for (const { s, c } of allCandidates) {
    if (!c.politicianId) continue;
    byTarget.set(c.politicianId, [...(byTarget.get(c.politicianId) ?? []), `${s.slug}/${c.slug}`]);
  }
  const shared = [...byTarget].filter(([, cands]) => cands.length > 1);
  if (shared.length) {
    // One profile behind two candidate pages means at least one of the links is
    // wrong: a person cannot be two people on one ballot, and across seats they
    // cannot stand twice in the same poll.
    console.log(`\n✗ ONE profile linked from several candidates (${shared.length}) - at least one link is wrong:`);
    for (const [id, cands] of shared) console.log(`  - ${id} <- ${cands.join(', ')}`);
  }

  // A declared winner is now a sitting member, so this is the moment the
  // double-vote vector opens. Say so plainly rather than leaving it to a re-run.
  const proposed = new Set(proposals.map((x) => x.c));
  const winnersUnlinked = events.flatMap((ev) =>
    ev.seats
      .filter((s) => s.result?.winner_slug)
      .map((s) => ({ s, c: s.candidates.find((x) => x.slug === s.result!.winner_slug) }))
      .filter(({ c }) => c && !c.politicianId && !proposed.has(c)),
  );
  if (winnersUnlinked.length) {
    console.log(`\n⚠ Declared winners with no profile link (${winnersUnlinked.length}):`);
    for (const { s, c } of winnersUnlinked) {
      console.log(`  - ${s.slug}/${c!.slug} (${c!.name}) - re-run once the roster import adds them to politicians.json`);
    }
  }

  if (!proposals.length) {
    console.log(`\nNothing to write.${refused.length ? ' Every near-match above failed a rule - that is the command working.' : ''}`);
    return;
  }
  if (!APPLY) {
    console.log(`\n${HELP_APPLY}`);
    return;
  }
  for (const x of proposals) x.c.politicianId = x.p.id;
  saveElections(events);
  console.log(`\n✓ wrote data/seed/elections.json - ${proposals.length} candidate(s) now redirect to their profile.`);
  console.log('  Next: npm run dm -- validate');
}

main();
