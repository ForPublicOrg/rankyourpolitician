// Rebuilds lib/vote-rollup.ts's shards from `vote_aggregates`, the source of
// truth. Used by build-vote-rollup.ts and by any tool that rewrites aggregates.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { VoteAggregate } from '../../lib/types';
import {
  ROLLUP_COLLECTION,
  ROLLUP_SHARDS,
  ROLLUP_SHARD_WARN_BYTES,
  encodeAggregate,
  rollupShardId,
  shardBytes,
  type RollupShard,
} from '../../lib/vote-rollup';

/** Hard stop below Firestore's 1 MiB document limit. */
const SHARD_MAX_BYTES = 1_000_000;

export interface RollupShardReport {
  shard: string;
  people: number;
  bytes: number;
  changed: number;
}

/**
 * One transaction per shard reads the shard and every aggregate it should hold,
 * then replaces it. The reads lock those docs, so a vote landing mid-rebuild
 * either commits first (and is read here) or waits and re-applies its entry.
 * Writes all 16 shards, empty ones included: readers need every shard marked
 * `complete` before they trust the rollup.
 */
export async function rebuildVoteRollup(db: Firestore, apply: boolean): Promise<RollupShardReport[]> {
  const listed = await db.collection('vote_aggregates').select().get();
  const idsByShard = new Map<string, Set<string>>();
  for (const d of listed.docs) {
    const shard = rollupShardId(d.id);
    if (!idsByShard.has(shard)) idsByShard.set(shard, new Set());
    idsByShard.get(shard)!.add(d.id);
  }

  const reports: RollupShardReport[] = [];
  for (let i = 0; i < ROLLUP_SHARDS; i++) {
    const shard = String(i);
    const shardRef = db.collection(ROLLUP_COLLECTION).doc(shard);
    const report = await db.runTransaction(async (tx) => {
      const current = ((await tx.get(shardRef)).data() as RollupShard | undefined)?.a ?? {};
      // People already in the shard but not in the listing were first rated after it.
      const ids = [...new Set([...(idsByShard.get(shard) ?? []), ...Object.keys(current)])];
      const aggSnaps = ids.length
        ? await tx.getAll(...ids.map((id) => db.collection('vote_aggregates').doc(id)))
        : [];
      const a: Record<string, string> = {};
      for (const s of aggSnaps) {
        if (s.exists) a[s.id] = encodeAggregate({ ...(s.data() as VoteAggregate), politician_id: s.id });
      }
      const bytes = shardBytes(a);
      if (bytes > SHARD_MAX_BYTES) {
        throw new Error(`shard ${shard} would be ${bytes} bytes, over Firestore's 1 MiB limit - raise ROLLUP_SHARDS`);
      }
      const keys = new Set([...Object.keys(a), ...Object.keys(current)]);
      const changed = [...keys].filter((k) => a[k] !== current[k]).length;
      if (apply) tx.set(shardRef, { a, complete: true, updated_at: FieldValue.serverTimestamp() });
      return { shard, people: Object.keys(a).length, bytes, changed };
    });
    reports.push(report);
  }
  return reports;
}

export function printRollupReport(reports: RollupShardReport[], apply: boolean): void {
  const people = reports.reduce((n, r) => n + r.people, 0);
  const changed = reports.reduce((n, r) => n + r.changed, 0);
  const largest = reports.reduce((m, r) => Math.max(m, r.bytes), 0);
  for (const r of reports) {
    const warn = r.bytes > ROLLUP_SHARD_WARN_BYTES ? '  ⚠ approaching the 1 MiB document limit' : '';
    console.log(`  shard ${r.shard.padStart(2)}: ${String(r.people).padStart(5)} people, ${(r.bytes / 1024).toFixed(1)} KB, ${r.changed} entries differ${warn}`);
  }
  console.log(
    `\n${apply ? 'Applied' : 'DRY RUN - nothing written'}: ${people} rated people in ${reports.length} shards ` +
      `(largest ${(largest / 1024).toFixed(1)} KB), ${changed} entries ${apply ? 'rewritten' : 'would change'}.`,
  );
}
