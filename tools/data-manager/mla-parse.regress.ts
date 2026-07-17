/**
 * Regression suite for MLA wikitext parsing — especially rowspan / by-election rows
 * where the sitting MLA is the continuation row, not the departed member.
 *
 * Usage:  npx tsx tools/data-manager/mla-parse.regress.ts
 */
import { parseMembers } from './mla-parse';

const SHIGGAON_ROWSPAN = `
== Members of the Legislative Assembly ==
{|
|-
|rowspan=2|83
|rowspan=2|[[Shiggaon (Karnataka Assembly constituency)|Shiggaon]]
|[[Basavaraj Bommai]]
|{{Party name with color|Bharatiya Janata Party}}
|Elected to Lok Sabha on 4 June 2024
|-
|Pathan Yasir Ahmed Khan
|{{Party name with color|Indian National Congress}}
|Elected on 23 November 2024
|}`;

const SINGLE_ROW = `
== Members of the Legislative Assembly ==
{|
|-
|84
|[[Haveri (Karnataka Assembly constituency)|Haveri]] (SC)
|[[Rudrappa Manappa Lamani]]
|{{Party name with color|Indian National Congress}}
|}`;

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else console.log('ok:', msg);
}

const shiggaon = parseMembers(SHIGGAON_ROWSPAN);
assert(shiggaon.length === 1, 'Shiggaon yields one MLA');
assert(shiggaon[0].name.includes('Pathan'), 'Shiggaon MLA is Pathan, not Bommai');
assert(!shiggaon[0].name.includes('Bommai'), 'Bommai not selected as sitting MLA');

const haveri = parseMembers(SINGLE_ROW);
assert(haveri.length === 1, 'Single-row seat still parses');
assert(haveri[0].name.includes('Lamani'), 'Haveri MLA unchanged');

if (failed) { console.error(failed, 'failures'); process.exit(1); }
console.log('All MLA parse regressions passed.');
