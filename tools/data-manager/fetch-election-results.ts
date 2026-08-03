/**
 * Freeze the Election Commission's declared result into data/seed/elections.json.
 * LOCAL ONLY - never deployed.
 *
 * While counting runs, /api/election-live reads ECI directly so the page is
 * current to the minute. That is the exception, not the rule: once the result
 * is declared it must become ordinary seed data, because a settled election
 * should cost the site nothing - no outbound request, no cache, no way for a
 * future ECI reorganisation to blank a historical page.
 *
 * This command is that hand-off. It reads the same tables /api/election-live
 * reads, through the same parser, and writes them once.
 *
 * Refuses to overwrite an already-frozen result unless --force, so re-running
 * it during a later election cannot quietly rewrite history.
 *
 * Usage:  npx tsx tools/data-manager/fetch-election-results.ts                (dry run)
 *         npx tsx tools/data-manager/fetch-election-results.ts --apply
 *         npx tsx tools/data-manager/fetch-election-results.ts --apply --force
 *         ELECTION_ONLY=ac-bye-2026-07 npx tsx ... --apply
 */
import type { ElectionResult } from '../../lib/types';
import {
  attachSlugs, constituencyCandidateUrl, constituencyResultUrl, parseConstituencyResult, winnerOf,
} from '../../lib/eci-results';
import { TODAY, fetchEci, loadElections, saveElections, seatKey, HELP_APPLY } from './elections-shared';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const ONLY = process.env.ELECTION_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);

async function main() {
  const events = loadElections();
  if (events.length === 0) {
    console.error('✗ data/seed/elections.json is empty - run import-elections first.');
    process.exit(1);
  }

  let wrote = 0;
  let skipped = 0;

  for (const ev of events) {
    if (ONLY && !ONLY.includes(ev.id)) continue;
    if (!ev.results_base) {
      console.log(`- ${ev.id}: no results microsite published yet (ECI puts it up at counting time)`);
      continue;
    }
    console.log(`\n${ev.id}  ${ev.title}`);

    for (const seat of ev.seats) {
      const label = `${seat.constituencyName} (${seat.state})`;
      if (seat.result && !FORCE) {
        console.log(`  = ${label}: already frozen (${seat.result.retrieved_date}) - pass --force to refetch`);
        skipped++;
        continue;
      }

      const url = constituencyResultUrl(ev.results_base, seat.eci.stateCode, seat.eci.acNo);
      const html = await fetchEci(url);
      if (!html) {
        console.error(`  ✗ ${label}: could not read ${url}`);
        continue;
      }
      const parsed = parseConstituencyResult(html);
      if (!parsed) {
        console.error(`  ✗ ${label}: page did not parse - the table layout may have changed`);
        continue;
      }

      // The page prints "182 - BANKIPUR (Bihar)". If that is not the seat we
      // asked for, the ECI state code in the registry is wrong and every number
      // below belongs to somebody else's constituency. Fail loudly.
      if (parsed.heading && !seatKey(parsed.heading).includes(seatKey(seat.constituencyName))) {
        console.error(
          `  ✗ ${label}: ECI returned "${parsed.heading}" - the eci.stateCode/acNo for this seat is wrong. ` +
            'Refusing to store another constituency\'s votes.',
        );
        continue;
      }

      // Counting is only over when every round is in. A partial table is live
      // data, not a result, and must never be frozen as one.
      if (parsed.round && parsed.round.done < parsed.round.total) {
        console.log(`  … ${label}: counting in progress (round ${parsed.round.done}/${parsed.round.total}) - not freezing`);
        continue;
      }

      const rows = attachSlugs(parsed.rows, seat.candidates);
      const unmatched = rows.filter((r) => !r.isNota && !r.candidateSlug);
      if (unmatched.length) {
        console.warn(`  ! ${label}: ${unmatched.length} result row(s) did not match a nomination: ${unmatched.map((r) => r.name).join(', ')}`);
      }

      const result: ElectionResult = {
        declared_date: TODAY,
        ...winnerOf(rows),
        total_votes: parsed.total_votes,
        rows,
        source_url: constituencyCandidateUrl(ev.results_base, seat.eci.stateCode, seat.eci.acNo),
        source_name: 'Election Commission of India - Results',
        retrieved_date: TODAY,
      };
      seat.result = result;
      wrote++;

      const win = rows.find((r) => r.candidateSlug && r.candidateSlug === result.winner_slug);
      console.log(
        `  ✓ ${label}: ${rows.length} rows, ${parsed.total_votes.toLocaleString('en-IN')} votes` +
          (win ? `, won by ${win.name} (${win.party}) with a margin of ${result.margin?.toLocaleString('en-IN')}` : ''),
      );
    }
  }

  console.log(`\n${wrote} result(s) ready, ${skipped} already frozen`);
  if (!APPLY) {
    console.log(`\n${HELP_APPLY}`);
    return;
  }
  if (wrote === 0) {
    console.log('Nothing to write.');
    return;
  }
  saveElections(events);
  console.log('✓ wrote data/seed/elections.json');
  console.log('  Next: `npx tsx tools/data-manager/link-candidates.ts` once the winner is in politicians.json.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
