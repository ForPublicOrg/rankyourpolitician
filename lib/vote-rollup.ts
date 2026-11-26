// Every vote aggregate, folded into ROLLUP_SHARDS documents so the site loads
// all live ratings in 16 reads instead of one read per rated person.
// `vote_aggregates/{id}` stays the source of truth; the rollup is a copy of it
// that every writer updates in the same transaction.
import { FieldPath, FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { VoteAggregate } from './types';

export const ROLLUP_COLLECTION = 'vote_rollup';
export const ROLLUP_SHARDS = 16;

/** Firestore's per-document cap is 1 MiB; warn well before a shard gets there. */
export const ROLLUP_SHARD_WARN_BYTES = 700_000;

/**
 * Shard doc shape. Each person is ONE string field (their aggregate as JSON):
 * nested maps would cost an index entry per bucket and hit Firestore's
 * 20,000-fields-per-document limit at a few hundred people per shard.
 */
export interface RollupShard {
  a?: Record<string, string>;
  /** Set only by `build-vote-rollup`; readers fall back to a full scan without it. */
  complete?: boolean;
  updated_at?: Timestamp;
}

/** FNV-1a, so the vote route and the build script always agree on a shard. */
export function rollupShardId(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return String((h >>> 0) % ROLLUP_SHARDS);
}

export function encodeAggregate(agg: VoteAggregate): string {
  const { politician_id: _id, ...rest } = agg;
  return JSON.stringify(rest);
}

export function decodeAggregate(id: string, raw: unknown): VoteAggregate | null {
  if (typeof raw !== 'string') return null;
  try {
    return { ...(JSON.parse(raw) as Omit<VoteAggregate, 'politician_id'>), politician_id: id };
  } catch {
    return null;
  }
}

export function decodeShard(shard: RollupShard | undefined): Map<string, VoteAggregate> {
  const out = new Map<string, VoteAggregate>();
  for (const [id, raw] of Object.entries(shard?.a ?? {})) {
    const agg = decodeAggregate(id, raw);
    if (agg) out.set(id, agg);
  }
  return out;
}

/** Approximate stored size of a shard's `a` map, for the 1 MiB guard. */
export function shardBytes(a: Record<string, string>): number {
  let n = 0;
  for (const [k, v] of Object.entries(a)) n += Buffer.byteLength(k) + Buffer.byteLength(v) + 2;
  return n;
}

/**
 * Copy one aggregate into its shard inside the caller's transaction. A blind
 * write to one field path: it costs no read, and two votes for different
 * people in the same shard never overwrite each other.
 */
export function writeRollupEntry(tx: Transaction, db: Firestore, agg: VoteAggregate): void {
  const id = agg.politician_id;
  tx.set(
    db.collection(ROLLUP_COLLECTION).doc(rollupShardId(id)),
    { a: { [id]: encodeAggregate(agg) }, updated_at: FieldValue.serverTimestamp() },
    { mergeFields: [new FieldPath('a', id), 'updated_at'] },
  );
}

export function laterTimestamp(a: Timestamp | undefined, b: Timestamp | undefined): Timestamp | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.seconds > b.seconds || (a.seconds === b.seconds && a.nanoseconds >= b.nanoseconds) ? a : b;
}
