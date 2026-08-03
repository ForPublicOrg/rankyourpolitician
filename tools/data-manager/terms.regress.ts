import assert from 'node:assert/strict';
import politiciansSeed from '../../data/seed/politicians.json';
import { electedRoleTerm, nextAssemblyElections } from '../../lib/terms';
import type { Politician } from '../../lib/types';

const next = nextAssemblyElections(Date.UTC(2026, 7, 3), 5);
assert.deepEqual(next.map((term) => term.stateCode), ['MN', 'GA', 'PB', 'UK', 'UP']);
assert.equal(next[0].to, '2027-03-13');

const withoutManipur = nextAssemblyElections(Date.UTC(2026, 7, 3), 5, new Set(['MN']));
assert.deepEqual(withoutManipur.map((term) => term.stateCode), ['GA', 'PB', 'UK', 'UP', 'GJ']);

const politicians = politiciansSeed as unknown as Politician[];
for (const person of politicians.filter((p) => p.house === 'Lok Sabha' || p.house === 'Vidhan Sabha')) {
  const term = electedRoleTerm(person);
  assert.ok(term, `missing lower-house term for ${person.id}`);
  assert.match(term.to, /^\d{4}-\d{2}-\d{2}$/);
}

const rajyaSabhaWithPublishedTerm = politicians.find((p) =>
  p.house === 'Rajya Sabha' && p.neutral_summary?.includes('Current term:'),
)!;
assert.equal(electedRoleTerm(rajyaSabhaWithPublishedTerm)?.basis, 'member');

console.log('✓ legislature-term regressions passed');
