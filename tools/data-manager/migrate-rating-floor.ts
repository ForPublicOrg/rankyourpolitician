// One-time migration for the 1-5 → 0-5 rating scale change.
//
// Why: the rating scale's floor moved from 1 to 0. Every vote recorded as a 1
// was cast when 1 WAS the floor ("Poor"), so it must now count as the new
// floor 0 - otherwise everyone rated at the old minimum silently gains a point
// against people rated after the change.
//
// What it does, per affected politician:
//   - vote docs with rating 1  → rating 0. `updated_at` is deliberately left
//     alone: trending buckets and the backfill script key off it, and bumping
//     it would make years-old votes look like this week's activity.
//   - the aggregate: counts["1"] merges into counts["0"], sum drops by that
//     count (each moved vote now contributes 0, not 1), total is unchanged,
//     and every daily trending bucket's "1" key merges into its "0" key.
//
// Most politicians fit in ONE transaction (vote docs + aggregate together, so
// the aggregate can never disagree with its own vote docs mid-run). Firestore
// caps a transaction at 500 writes, so a heavily-voted profile takes the
// chunked path instead: flip the vote docs in transactional chunks first, then
// fix the aggregate. The docs-first order is deliberate - if a migrated voter
// re-votes in the seconds between chunks, recordVote subtracts their prev of 0
// (correct new value), so the SUM stays exact; the worst case is one phantom
// count left in the distribution, the same seconds-wide trade-off
// backfill-trending accepts.
//
// RUN THIS EXACTLY ONCE, immediately after the 0-5 UI deploys. After the new
// scale is live a rating of 1 is a legitimate second-from-bottom vote, and a
// re-run would wrongly drag those to 0 too. A second run right after the first
// is a no-op (no rating-1 vote docs and no counts["1"] remain), but do not run
// it again weeks later.
//
// Run:  npm run dm -- migrate-rating-floor           (dry run - prints the plan)
//       npm run dm -- migrate-rating-floor --apply   (writes to Firestore)
import { getDb } from '../../lib/firebase-admin';
import type { VoteAggregate } from '../../lib/types';
import seedPoliticians from '../../data/seed/politicians.json';

type Daily = Record<string, Record<string, number>>;

/** Max vote-doc writes per transaction, safely under Firestore's 500 cap. */
const CHUNK = 400;

/** Copy of `daily` with every day's "1" count merged into its "0" count. */
function migrateDaily(daily: Daily | undefined): { out: Daily | undefined; moved: number } {
  if (!daily) return { out: undefined, moved: 0 };
  let moved = 0;
  const out: Daily = {};
  for (const [day, counts] of Object.entries(daily)) {
    const ones = Number(counts['1']) || 0;
    if (ones === 0) {
      out[day] = counts;
      continue;
    }
    moved += ones;
    const { ['1']: _drop, ...rest } = counts;
    out[day] = { ...rest, '0': (Number(counts['0']) || 0) + ones };
  }
  return { out, moved };
}

const mean = (sum: number, n: number) => (n > 0 ? (sum / n).toFixed(2) : '-');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();
  if (!db) {
    console.error('✗ Firestore is not configured (.env.local creds missing). Nothing to migrate.');
    process.exit(1);
  }

  const nameById = new Map(
    (seedPoliticians as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  // Plan pass: every politician that still holds a 1 anywhere - in the
  // aggregate's counts, in a daily trending bucket, or in a standing vote doc
  // (the union catches drifted docs whose aggregate lost or never had the
  // count). The per-politician work below re-reads everything transactionally,
  // so this scan only decides WHO to visit.
  console.log('Scanning vote_aggregates…');
  const aggSnap = await db.collection('vote_aggregates').get();
  const ids = new Set<string>();
  aggSnap.forEach((doc) => {
    const a = doc.data() as VoteAggregate;
    const inDaily = Object.values(a.daily ?? {}).some((day) => (Number(day['1']) || 0) > 0);
    if ((Number(a.counts?.['1']) || 0) > 0 || inDaily) ids.add(doc.id);
  });
  console.log('Scanning votes with rating 1…');
  const oneVotes = await db.collection('votes').where('rating', '==', 1).get();
  oneVotes.forEach((doc) => {
    const id = (doc.data() as { politician_id?: string }).politician_id;
    if (id) ids.add(id);
  });
  console.log(`  ${aggSnap.size} aggregates, ${oneVotes.size} rating-1 vote docs → ${ids.size} politicians to migrate\n`);

  let migrated = 0;
  let votesMoved = 0;
  for (const id of ids) {
    const aggRef = db.collection('vote_aggregates').doc(id);
    const oneQuery = db.collection('votes').where('politician_id', '==', id).where('rating', '==', 1);

    // Peek at the doc count to pick a path; both paths re-read transactionally.
    const probe = await oneQuery.limit(CHUNK + 1).get();
    const big = probe.size > CHUNK;

    /** Applies the aggregate half of the move; `docN1` is only for the log. */
    const migrateAggregate = async (docN1: number, flipDocs: boolean) =>
      db.runTransaction(async (tx) => {
        const [snap, votes] = flipDocs
          ? await Promise.all([tx.get(aggRef), tx.get(oneQuery)])
          : [await tx.get(aggRef), null];
        const agg = snap.exists ? (snap.data() as VoteAggregate) : null;
        const n1 = Number(agg?.counts?.['1']) || 0;
        const { out: daily, moved: dailyMoved } = migrateDaily(agg?.daily);
        const docs = votes ? votes.size : docN1;
        if (!agg && docs === 0) return null;

        if (votes && apply) {
          for (const doc of votes.docs) tx.update(doc.ref, { rating: 0 });
        }

        let before = '-';
        let after = '-';
        if (agg && (n1 > 0 || dailyMoved > 0)) {
          const { ['1']: _drop, ...rest } = agg.counts ?? {};
          const counts = n1 > 0 ? { ...rest, '0': (Number(agg.counts?.['0']) || 0) + n1 } : { ...rest };
          const sum = (agg.sum || 0) - n1; // each moved vote now contributes 0
          before = mean(agg.sum || 0, agg.total || 0);
          after = mean(sum, agg.total || 0);
          if (apply) {
            tx.update(aggRef, {
              counts,
              sum,
              ...(daily ? { daily } : {}),
              updated_at: new Date().toISOString(),
            });
          }
        }
        return { aggN1: n1, docN1: docs, dailyMoved, hasAgg: Boolean(agg), before, after };
      });

    let report;
    if (!big) {
      // Atomic path: vote docs + aggregate in one transaction.
      report = await migrateAggregate(0, true);
    } else {
      // Chunked path: flip the vote docs first (each chunk is its own
      // transaction, re-reading the query so a concurrent re-vote is never
      // stomped), then fix the aggregate. See the header for why docs-first.
      let flipped = 0;
      if (apply) {
        for (;;) {
          const moved = await db.runTransaction(async (tx) => {
            const chunk = await tx.get(oneQuery.limit(CHUNK));
            for (const doc of chunk.docs) tx.update(doc.ref, { rating: 0 });
            return chunk.size;
          });
          flipped += moved;
          if (moved < CHUNK) break;
        }
      } else {
        flipped = (await oneQuery.get()).size;
      }
      report = await migrateAggregate(flipped, false);
    }

    if (!report) continue;
    migrated++;
    votesMoved += report.docN1;
    const name = nameById.get(id) ?? id;
    console.log(
      `${apply ? '✓' : '·'} ${name}: ${report.docN1} vote doc(s) 1→0${big ? ' (chunked)' : ''}, ` +
        `mean ${report.before} → ${report.after}` +
        (report.dailyMoved ? `, ${report.dailyMoved} trending bucket entr${report.dailyMoved === 1 ? 'y' : 'ies'}` : ''),
    );
    if (!report.hasAgg) {
      console.log(`  ⚠ vote docs exist but no aggregate doc - docs updated, nothing to re-sum`);
    } else if (report.aggN1 !== report.docN1) {
      console.log(
        `  ⚠ aggregate counted ${report.aggN1} one(s) but ${report.docN1} vote doc(s) held a 1 - drifted before this run; both sides were still migrated`,
      );
    }
  }

  console.log(
    `\n${apply ? 'Applied' : 'DRY RUN - nothing written'}: ` +
      `${migrated} politicians, ${votesMoved} vote docs moved 1→0.`,
  );
  if (!apply && migrated > 0) console.log('Re-run with --apply to write.');
  if (apply && migrated > 0) {
    console.log(
      'Live pages read the 5-min TTL aggregate cache; means update within ~5 minutes.\n' +
        'This was a one-time migration - do NOT run it again now that 1 is a valid 0-5 rating.',
    );
  }
}

main().catch((e) => {
  console.error('✗ migration failed:', e);
  process.exit(1);
});
