/**
 * Regression suite for MLA wikitext parsing — especially rowspan / by-election rows
 * where the sitting MLA is the continuation row, not the departed member.
 *
 * Fixtures use fictional names and constituencies only (no real roster rows).
 *
 * Usage:  npx tsx tools/data-manager/mla-parse.regress.ts
 */
import { parseMembers } from './mla-parse';

/** Rowspan: departed incumbent + by-election winner on continuation row (plain-text name). */
const ROWSPAN_BYELECTION = `
== Members of the Legislative Assembly ==
{|
|-
|rowspan=2|12
|rowspan=2|[[Northwood (Example Assembly constituency)|Northwood]]
|[[Alice Former]]
|{{Party name with color|Example Party Alpha}}
|Elected to Lok Sabha on 4 June 2024
|-
|Bob Successor
|{{Party name with color|Example Party Beta}}
|Elected on 23 November 2024
|}`;

/** Standard single-row seat with a wikilinked member. */
const SINGLE_ROW = `
== Members of the Legislative Assembly ==
{|
|-
|13
|[[Southvale (Example Assembly constituency)|Southvale]] (SC)
|[[Carol Incumbent]]
|{{Party name with color|Example Party Beta}}
|}`;

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else console.log('ok:', msg);
}

const byelection = parseMembers(ROWSPAN_BYELECTION);
assert(byelection.length === 1, 'rowspan seat yields one MLA');
assert(byelection[0].cons === 'Northwood', 'constituency name preserved');
assert(byelection[0].name === 'Bob Successor', 'by-election winner is sitting MLA');
assert(byelection[0].party.includes('Beta'), 'sitting member party from continuation row');
assert(!byelection[0].name.includes('Former'), 'departed incumbent not selected');

const single = parseMembers(SINGLE_ROW);
assert(single.length === 1, 'single-row seat still parses');
assert(single[0].name === 'Carol Incumbent', 'single-row wikilink member unchanged');

if (failed) { console.error(failed, 'failures'); process.exit(1); }
console.log('All MLA parse regressions passed.');
