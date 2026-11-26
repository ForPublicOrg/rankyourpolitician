import assert from 'node:assert/strict';
import politiciansSeed from '../../data/seed/politicians.json';
import {
  ROLLUP_SHARDS,
  ROLLUP_SHARD_WARN_BYTES,
  decodeAggregate,
  decodeShard,
  encodeAggregate,
  rollupShardId,
  shardBytes,
} from '../../lib/vote-rollup';
import type { VoteAggregate } from '../../lib/types';

// Pinned: changing the hash moves every person to a different shard, which
// makes the live rollup wrong until build-vote-rollup is re-run.
assert.deepEqual(
  ['a', 'cand:seat:slug', 'l-murugan-rs-mp'].map(rollupShardId),
  ['12', '3', '11'],
);

const ids = (politiciansSeed as { id: string }[]).map((p) => p.id);
const perShard = new Map<string, number>();
for (const id of ids) {
  const s = rollupShardId(id);
  assert.ok(Number(s) >= 0 && Number(s) < ROLLUP_SHARDS, `shard out of range for ${id}`);
  perShard.set(s, (perShard.get(s) ?? 0) + 1);
}
assert.equal(perShard.size, ROLLUP_SHARDS, 'every shard should receive people');
const even = ids.length / ROLLUP_SHARDS;
for (const [s, n] of perShard) assert.ok(n < even * 1.5, `shard ${s} holds ${n}, expected about ${even.toFixed(0)}`);

const agg: VoteAggregate = {
  politician_id: 'cand:seat:slug',
  counts: { '0': 1, '5': 3 },
  total: 4,
  sum: 15,
  updated_at: '2026-11-26T10:00:00.000Z',
  daily: { '2026-11-26': { '5': 2 } },
};
const encoded = encodeAggregate(agg);
assert.ok(!encoded.includes('politician_id'), 'the map key already carries the id');
assert.deepEqual(decodeAggregate(agg.politician_id, encoded), agg);
assert.equal(decodeAggregate('x', '{not json'), null);
assert.equal(decodeAggregate('x', 42), null);
assert.deepEqual([...decodeShard({ a: { [agg.politician_id]: encoded, bad: '{' } }).keys()], [agg.politician_id]);

// Worst case: every elected member rated, each with a full 14-day trending history.
const daily: Record<string, Record<string, number>> = {};
for (let d = 1; d <= 14; d++) daily[`2026-11-${String(d).padStart(2, '0')}`] = { '0': 99, '1': 99, '2': 99, '3': 99, '4': 99, '5': 99 };
const heavy = encodeAggregate({ ...agg, counts: { '0': 9999, '1': 9999, '2': 9999, '3': 9999, '4': 9999, '5': 9999 }, total: 59994, sum: 149985, daily });
const biggest = Math.max(...perShard.values());
const worst = shardBytes(Object.fromEntries(Array.from({ length: biggest }, (_, i) => [`some-long-person-id-${i}`, heavy])));
assert.ok(worst < ROLLUP_SHARD_WARN_BYTES, `worst-case shard is ${worst} bytes`);

console.log(`vote-rollup: ok (${ids.length} ids over ${ROLLUP_SHARDS} shards, largest ${biggest}; worst-case shard ${(worst / 1024).toFixed(0)} KB)`);
