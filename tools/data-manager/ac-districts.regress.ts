/**
 * Regression suite for the AC -> district join (ac-districts-shared.ts).
 *
 * The failure this guards against is not a crash, it is a confident wrong
 * answer: a seat quietly attributed to the wrong district sends a reader to a
 * Collector who does not administer them, and nothing on the page looks broken.
 * So most of these cases assert a REFUSAL.
 *
 * Fixtures are real rows captured from the Commission's district/constituency
 * lists (gateway-voters.eci.gov.in), including their upper-casing and padding.
 *
 * Usage:  npx tsx tools/data-manager/ac-districts.regress.ts
 */
import {
  cleanDistrictName,
  matchState,
  normaliseName,
  normaliseDistrict,
  splitDistricts,
  suspectedDistrictSplits,
  ELECTORAL_DISTRICT_STATES,
  SEAT_ALIASES,
  type EciAcRow,
  type SeatLike,
} from './ac-districts-shared';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else console.log('ok:', msg);
}

const eci = (acNo: number, ac: string, district: string, districtCd = 'S0301'): EciAcRow => ({
  stateCd: 'S03', districtCd, district, acNo, ac, pcNo: '1',
});
const seat = (name: string, districts: string[] = []): SeatLike => ({
  id: `ac-as-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, districts,
});

// ---------------------------------------------------------------------------
// 1. District name cleanup. The ECI pads and upper-cases these strings.
// ---------------------------------------------------------------------------
assert(cleanDistrictName('SOUTH SALMARA MANKACHAR') === 'South Salmara Mankachar', 'upper-case district is title-cased');
assert(cleanDistrictName('GOLAGHAT   ') === 'Golaghat', 'trailing padding is stripped');
assert(cleanDistrictName('KAMRUP (METRO)') === 'Kamrup (Metro)', 'parenthesised qualifier is kept and cased');
assert(cleanDistrictName('KAMRUP.', 'AS') === 'Kamrup', 'stray full stop is repaired via DISTRICT_DISPLAY');
assert(cleanDistrictName('WEST KARBI ANGLONG ') === 'West Karbi Anglong', 'multi-word district is title-cased');
assert(cleanDistrictName('DIMA HASAO') === 'Dima Hasao', 'renamed district keeps the current name');

// A district the ECI merely spells differently from the old census vintage must
// NOT be quietly mapped back - re-aligning to the current spelling is the point.
assert(cleanDistrictName('MORIGAON ', 'AS') === 'Morigaon', 'current spelling is not aliased back to the 2001 vintage');
assert(cleanDistrictName('SRIBHUMI', 'AS') === 'Sribhumi', 'renamed district is not aliased back to its old name');

// ---------------------------------------------------------------------------
// 2. The happy path: names match outright, and a reviewed alias covers a
//    romanisation difference.
// ---------------------------------------------------------------------------
const clean = matchState('AS', [seat('Baksa'), seat('Jaleshwar')], [
  eci(42, 'BAKSA', 'BAKSA', 'S0312'),
  eci(12, 'JALESWAR', 'GOALPARA', 'S0315'),
]);
assert(clean.complete, 'exact + alias match over a whole state is complete');
assert(clean.matches.find((m) => m.seat.name === 'Baksa')?.district === 'Baksa', 'exact name match resolves district');
const jal = clean.matches.find((m) => m.seat.name === 'Jaleshwar');
assert(jal?.district === 'Goalpara', `alias match resolves district (got ${jal?.district})`);
assert(jal?.via === 'alias', 'alias match is reported as an alias, not as a name match');

// Reservation qualifiers are formatting, not name.
const resv = matchState('AS', [seat('Baksa')], [eci(42, 'BAKSA (ST)', 'BAKSA')]);
assert(resv.complete && resv.matches[0].district === 'Baksa', 'reservation qualifier does not block the match');

// ---------------------------------------------------------------------------
// 3. Actions: fill an empty row, re-align a stale one, leave an agreeing one.
// ---------------------------------------------------------------------------
const actions = matchState('AS', [
  seat('Baksa'),                              // empty -> fill
  seat('Sonari', ['Sivasagar']),              // stale -> re-align (Charaideo was carved out)
  seat('Nagaon', ['Nagaon']),                 // agrees -> unchanged
], [
  eci(42, 'BAKSA', 'BAKSA'),
  eci(97, 'SONARI', 'CHARAIDEO'),
  eci(55, 'NAGAON', 'NAGAON '),
]);
assert(actions.matches.find((m) => m.seat.name === 'Baksa')?.action === 'fill', 'empty districts -> fill');
assert(actions.matches.find((m) => m.seat.name === 'Sonari')?.action === 'realign', 'stale district -> realign');
assert(actions.matches.find((m) => m.seat.name === 'Nagaon')?.action === 'unchanged', 'agreeing district (modulo padding) -> unchanged');

// ---------------------------------------------------------------------------
// 4. REFUSALS. Everything below must fail closed - the importer writes nothing
//    for a state whose report is not complete.
// ---------------------------------------------------------------------------

// 4a. Near-miss names are NOT matched. "Dharashiv" is one edit from "Dharavi"
//     and 400 km from it; "Bajali" is two from "Majuli". Edit-distance matching
//     produced exactly these pairs before it was removed.
const nearMiss = matchState('AS', [seat('Bajali')], [eci(85, 'MAJULI', 'MAJULI')]);
assert(!nearMiss.complete, 'a one-seat state with only a near-miss name is incomplete');
assert(nearMiss.matches.length === 0 && nearMiss.unmatchedSeats.length === 1, 'near-miss name is refused, not guessed');

// 4b. A seed name hitting two ECI seats is reported, never picked. Tamil Nadu
//     really does have two Tiruppattur seats, in different districts.
const ambiguous = matchState('AS', [seat('Tiruppattur')], [
  eci(50, 'TIRUPPATTUR', 'VELLORE', 'S0350'),
  eci(51, 'TIRUPPATTUR', 'SIVAGANGA', 'S0351'),
]);
assert(ambiguous.matches.length === 0, 'an ambiguous name yields no match');
assert(ambiguous.ambiguous[0]?.candidates.length === 2, 'both candidates are reported for review');
assert(!ambiguous.complete, 'ambiguity makes the state incomplete');

// 4c. An ECI seat nothing claimed makes the state incomplete, even though every
//     seed seat matched. This is the delimitation tripwire: a seat the roster
//     has not caught up with must stop the import, not pass unnoticed.
const leftover = matchState('AS', [seat('Baksa')], [
  eci(42, 'BAKSA', 'BAKSA'),
  eci(26, 'BAJALI', 'BAJALI'),
]);
assert(leftover.matches.length === 1 && leftover.unclaimedEci.length === 1, 'unclaimed ECI seat is reported');
assert(!leftover.complete, 'an unclaimed ECI seat makes the state incomplete');

// 4d. Two seed seats cannot both claim one ECI seat.
const dupe = matchState('AS', [seat('Baksa'), seat('BAKSA')], [eci(42, 'BAKSA', 'BAKSA')]);
assert(dupe.matches.length === 1 && dupe.unmatchedSeats.length === 1, 'one ECI seat is claimed at most once');
assert(!dupe.complete, 'a duplicated seed seat makes the state incomplete');

// ---------------------------------------------------------------------------
// 5. Split-district detection - two spellings of one district in one state.
//    This is what "fill the gaps but leave stale rows alone" would have caused.
// ---------------------------------------------------------------------------
// 5a. Certain splits: the /district lookup normalises case, padding and
//     punctuation away, so these are literally one page's data on two pages.
const splits = splitDistricts(['Morigaon', 'MORIGAON ', 'Nagaon', 'Kamrup (Metro)']);
assert(splits.length === 1, `exactly one certain split found (got ${splits.length})`);
assert(splits[0].join('|') === 'MORIGAON |Morigaon', `the split pair is reported (got ${splits[0].join('|')})`);
assert(!splitDistricts(['Cachar', 'North Cachar Hills']).length, 'a district whose name contains another is not a split');
assert(!splitDistricts(['Kamrup', 'Kamrup (Metro)']).length, 'Kamrup and Kamrup (Metro) are two real districts, not a split');

// 5b. Suspected splits: one letter apart, so normalisation cannot see them,
//     yet this is exactly the residue a half-finished re-alignment leaves.
//     Both real pairs below appear in Assam's own two vintages.
const suspects = suspectedDistrictSplits(['Sivasagar', 'Sibsagar', 'Nagaon', 'Cachar', 'Charaideo']);
assert(suspects.length === 1, `exactly one suspected split found (got ${suspects.length})`);
assert(suspects[0].join('|') === 'Sibsagar|Sivasagar', `the suspected pair is reported (got ${suspects[0]?.join('|')})`);
assert(suspectedDistrictSplits(['Marigaon', 'Morigaon']).length === 1, 'Marigaon/Morigaon is flagged as one district, two vintages');
// The real find in West Bengal's existing data, and the reason this check exists.
assert(suspectedDistrictSplits(['Paschim Medinipur', 'Pashchim Medinipur']).length === 1, 'Paschim/Pashchim Medinipur is flagged');
assert(suspectedDistrictSplits(['Balangir', 'Bolangir']).length === 1, 'Balangir/Bolangir is flagged');

// Genuinely different districts that an edit-distance check flagged and this
// one must not. Every pair below is two real districts of one state.
const distinctPairs: [string, string][] = [
  ['East Godavari', 'West Godavari'], ['East Siang', 'West Siang'], ['East Kameng', 'West Kameng'],
  ['Nalanda', 'Nawada'], ['North Goa', 'South Goa'], ['Panipat', 'Sonipat'],
  ['East Nimar', 'West Nimar'], ['Dindori', 'Indore'], ['Kolhapur', 'Solapur'],
  ['Nashik', 'Washim'], ['Imphal East', 'Imphal West'], ['East Garo Hills', 'West Garo Hills'],
  ['Jaipur', 'Udaipur'], ['Thiruvallur', 'Thiruvarur'], ['North Tripura', 'South Tripura'],
  ['North 24 Parganas', 'South 24 Parganas'], ['Bajali', 'Majuli'], ['Cachar', 'North Cachar Hills'],
  // Both fold to the same consonant skeleton; only the direction word separates them.
  ['East Garo Hills', 'South Garo Hills'], ['Purba Bardhaman', 'Paschim Bardhaman'],
  ['Kamrup', 'Kamrup (Metro)'], ['Karbi Anglong', 'West Karbi Anglong'],
];
for (const [a, b] of distinctPairs) {
  assert(!suspectedDistrictSplits([a, b]).length, `${a} and ${b} are two real districts, not a split`);
}
assert(!suspectedDistrictSplits(['Jorhat', 'Majuli', 'Dhubri', 'Nalbari', 'Barpeta', 'Goalpara']).length, 'a real Assam district list is clean');

// ---------------------------------------------------------------------------
// 6. Guards that are easy to erode later.
// ---------------------------------------------------------------------------
assert(ELECTORAL_DISTRICT_STATES.has('DL'), 'Delhi stays refused (ECI roll districts there are electoral, not revenue)');
assert(ELECTORAL_DISTRICT_STATES.has('KA'), 'Karnataka stays refused (B.B.M.P zones are not districts)');
assert(Object.keys(SEAT_ALIASES.AS ?? {}).length === 9, 'Assam still carries exactly its 9 reviewed romanisation pairs');
assert(normaliseName('Dr. Radhakrishnan Nagar') === 'drradhakrishnannagar', 'punctuation is ignored when joining names');
assert(normaliseName('Aizawl North-II') !== normaliseName('Aizawl North-III'), 'roman-numeral suffixes stay distinct');
// The seat normaliser drops "(SC)"/"(ST)"; the district normaliser must not,
// or Kamrup (Metro) folds into Kamrup. Keep the two apart.
assert(normaliseName('Kamrup (Metro)') === normaliseName('Kamrup'), 'seat normaliser drops parenthesised qualifiers');
assert(normaliseDistrict('Kamrup (Metro)') !== normaliseDistrict('Kamrup'), 'district normaliser keeps Kamrup (Metro) distinct');
assert(normaliseDistrict('Kamrup (Metro)') === 'kamrupmetro', 'district normaliser mirrors normSimple in lib/data.ts');

if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1); }
console.log('\nAll AC-district regressions passed.');
