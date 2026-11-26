// One-time backfill of the trending daily buckets (VoteAggregate.daily).
//
// Why: votes cast BEFORE the trending feature shipped have no daily buckets,
// so "N ratings this week" undercounts anyone who was rated before the
// deploy. The votes collection stores one doc per (politician, voter) with an
// updated_at timestamp, so the buckets can be rebuilt from the actual vote
// records: bucket every standing vote by its UTC day, keeping the days inside
// the retention window.
//
// The rebuilt buckets REPLACE the live-tracked ones: both count the same vote
// docs (one entry per standing voter), so replacing is idempotent and keeps
// the invariant that a weekly count can never exceed the distinct-voter
// total. Merging instead would double-count anyone who re-voted after the
// feature shipped (old bucket entry + new one). The trade-off: a vote landing
// in the seconds between the scan and a doc's transaction is bucketed only on
// the next run - its rating/total are untouched either way.
//
// Run:  npm run dm -- backfill-trending           (dry run - prints the plan)
//       npm run dm -- backfill-trending --apply   (writes to Firestore)
import { getDb } from '../../lib/firebase-admin';
import {
  utcDayKey,
  pruneDaily,
  TRENDING_RETENTION_DAYS,
  TRENDING_WINDOW_DAYS,
} from '../../lib/trending';
import type { VoteAggregate } from '../../lib/types';
import { writeRollupEntry } from '../../lib/vote-rollup';
import seedPoliticians from '../../data/seed/politicians.json';

type Daily = Record<string, Record<string, number>>;

const DAY_MS = 86_400_000;

/** Votes inside the 7-day trending window (what the UI shows as "this week"). */
function windowCount(daily: Daily | undefined, now: Date): number {
  if (!daily) return 0;
  const cutoff = utcDayKey(new Date(now.getTime() - (TRENDING_WINDOW_DAYS - 1) * DAY_MS));
  let n = 0;
  for (const [day, counts] of Object.entries(daily)) {
    if (day < cutoff) continue;
    for (const c of Object.values(counts)) n += Number(c) || 0;
  }
  return n;
}

/** Key-order-independent equality (Firestore maps come back in any order). */
function canon(d: Daily): string {
  return JSON.stringify(
    Object.keys(d)
      .sort()
      .map((day) => [day, Object.keys(d[day]).sort().map((r) => [r, d[day][r]])]),
  );
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();
  if (!db) {
    console.error('✗ Firestore is not configured (.env.local creds missing). Nothing to backfill.');
    process.exit(1);
  }

  const now = new Date();
  const cutoffDay = utcDayKey(new Date(now.getTime() - TRENDING_RETENTION_DAYS * DAY_MS));
  const nameById = new Map(
    (seedPoliticians as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  // Rebuild per-politician buckets from the standing vote docs. A re-voter is
  // bucketed on their last-update day - the only day the record retains, and
  // consistent with "one distinct voter, once".
  console.log('Scanning votes collection…');
  const votesSnap = await db.collection('votes').get();
  const rebuiltById = new Map<string, Daily>();
  let skippedOld = 0;
  let skippedBad = 0;
  votesSnap.forEach((doc) => {
    const v = doc.data() as { politician_id?: string; rating?: number; updated_at?: string };
    if (!v.politician_id || typeof v.rating !== 'number' || !v.updated_at) {
      skippedBad++;
      return;
    }
    const at = new Date(v.updated_at);
    if (Number.isNaN(at.getTime())) {
      skippedBad++;
      return;
    }
    const day = utcDayKey(at);
    if (day < cutoffDay) {
      skippedOld++; // outside retention - the live path would prune it anyway
      return;
    }
    const daily = rebuiltById.get(v.politician_id) ?? {};
    daily[day] = { ...(daily[day] ?? {}), [v.rating]: (daily[day]?.[v.rating] ?? 0) + 1 };
    rebuiltById.set(v.politician_id, daily);
  });
  console.log(
    `  ${votesSnap.size} vote docs → ${rebuiltById.size} politicians ` +
      `(${skippedOld} outside ${TRENDING_RETENTION_DAYS}d retention, ${skippedBad} malformed)\n`,
  );

  let changed = 0;
  let unchanged = 0;
  let missingAgg = 0;
  for (const [id, rebuilt] of rebuiltById) {
    const aggRef = db.collection('vote_aggregates').doc(id);

    const report = await db.runTransaction(async (tx) => {
      const snap = await tx.get(aggRef);
      if (!snap.exists) return null; // recordVote always writes both - just flag it
      const agg = snap.data() as VoteAggregate;
      const existing = pruneDaily(agg.daily, now);
      const before = windowCount(existing, now);
      const after = windowCount(rebuilt, now);
      const same = canon(rebuilt) === canon(existing);
      if (apply && !same) {
        tx.update(aggRef, { daily: rebuilt });
        writeRollupEntry(tx, db, { ...agg, daily: rebuilt, politician_id: id });
      }
      return { before, after, same, total: agg.total };
    });

    if (!report) {
      missingAgg++;
      console.log(`⚠ ${id}: vote docs exist but no aggregate doc - skipped`);
      continue;
    }
    if (report.same) {
      unchanged++;
      continue;
    }
    changed++;
    const name = nameById.get(id) ?? id;
    console.log(
      `${apply ? '✓' : '·'} ${name}: this-week ${report.before} → ${report.after} ` +
        `(distinct voters: ${report.total})`,
    );
    if (report.after > report.total) {
      console.log(`  ⚠ window count ${report.after} exceeds voter total ${report.total} - check manually`);
    }
  }

  console.log(
    `\n${apply ? 'Applied' : 'DRY RUN - nothing written'}: ` +
      `${changed} aggregates ${apply ? 'updated' : 'would change'}, ${unchanged} already correct` +
      (missingAgg ? `, ${missingAgg} skipped (no aggregate)` : '') +
      '.',
  );
  if (!apply && changed > 0) console.log('Re-run with --apply to write.');
}

main().catch((e) => {
  console.error('✗ backfill failed:', e);
  process.exit(1);
});
