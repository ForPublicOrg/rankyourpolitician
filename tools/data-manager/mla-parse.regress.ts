/**
 * Regression suite for MLA wikitext parsing - especially rowspan by-election
 * rows, where the sitting MLA is the continuation row and the departed
 * incumbent is the first row (the Shiggaon/Bommai staleness bug).
 *
 * Usage:  npx tsx tools/data-manager/mla-parse.regress.ts
 */
import { parseMembers, parseSeats, isDepartureNote } from './mla-parse';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else console.log('ok:', msg);
}

const wrap = (rows: string) => `\n== Members of the Legislative Assembly ==\n{|\n${rows}\n|}`;

// 1. Rowspan by-election pair: departed incumbent first, winner below.
const shiggaon = parseMembers(wrap(`|-
|rowspan=2|83
|rowspan=2|[[Shiggaon (Karnataka Assembly constituency)|Shiggaon]]
|[[Basavaraj Bommai]]
|{{Party name with color|Bharatiya Janata Party}}
|Resigned on 13 June 2024 after getting elected to [[Lok Sabha]]
|-
|Pathan Yasir Ahmed Khan
|{{Party name with color|Indian National Congress}}
|Elected on 23 November 2024`));
assert(shiggaon.length === 1, 'rowspan pair yields one MLA');
assert(shiggaon[0]?.name === 'Pathan Yasir Ahmed Khan', `rowspan pair picks the by-election winner (got ${shiggaon[0]?.name})`);
assert(shiggaon[0]?.party === 'Indian National Congress', `winner carries own party (got ${shiggaon[0]?.party})`);

// 2. Plain single-row seat unchanged.
const single = parseMembers(wrap(`|-
|84
|[[Haveri (Karnataka Assembly constituency)|Haveri]] (SC)
|[[Rudrappa Manappa Lamani]]
|{{Party name with color|Indian National Congress}}`));
assert(single.length === 1 && single[0].name === 'Rudrappa Manappa Lamani', 'single-row seat still parses');

// 3. Same-line || cells in the continuation row.
const sameLine = parseMembers(wrap(`|-
| rowspan="2" |12 || rowspan="2" |[[Channapatna (Karnataka Assembly constituency)|Channapatna]] || [[H. D. Kumaraswamy]] || {{Party name with color|Janata Dal (Secular)}} || Elected to Lok Sabha
|-
| [[C. P. Yogeshwara]] || {{Party name with color|Indian National Congress}} || Elected on 23 November 2024`));
assert(sameLine.length === 1 && sameLine[0].name === 'C. P. Yogeshwara', `same-line cells pick winner (got ${sameLine[0]?.name})`);

// 4. Member died, continuation row says Vacant -> seat reported vacant.
const vac = parseSeats(wrap(`|-
|rowspan=2|7
|rowspan=2|[[Milkipur (Assembly constituency)|Milkipur]]
|[[Some Member]]
|{{Party name with color|Samajwadi Party}}
|Died on 1 January 2025
|-
| colspan=3 | ''Vacant''`));
assert(vac.length === 1 && vac[0].sitting === null, 'trailing Vacant row vacates the seat');
assert(vac[0]?.departed[0]?.name === 'Some Member', 'departed member reported for vacant seat');

// 5. Sole row whose note says the member left -> vacant, not stale.
const soleDeparted = parseSeats(wrap(`|-
|9
|[[Somewhere (Assembly constituency)|Somewhere]]
|[[Gone Member]]
|{{Party name with color|Bharatiya Janata Party}}
|Elected to Lok Sabha on 4 June 2024`));
assert(soleDeparted[0]?.sitting === null, 'sole departed row -> vacant');

// 6. "Resigned as minister" / "expelled from the party" are NOT departures.
const stillSitting = parseMembers(wrap(`|-
|10
|[[Elsewhere (Assembly constituency)|Elsewhere]]
|[[Busy Member]]
|{{Party name with color|Indian National Congress}}
|Resigned as minister on 2 February 2025
|-
|11
|[[Elsewhen (Assembly constituency)|Elsewhen]]
|[[Rebel Member]]
|{{Party name with color|Indian National Congress}}
|Expelled from the party on 3 March 2025`));
assert(stillSitting.length === 2, 'non-seat resignations/expulsions keep the member');
assert(stillSitting[0]?.name === 'Busy Member' && stillSitting[1]?.name === 'Rebel Member', 'both members kept');

// 7. A stray later row re-linking a constituency does not override (first group wins).
const stray = parseMembers(wrap(`|-
|13
|[[Firstseat (Assembly constituency)|Firstseat]]
|[[Real Member]]
|{{Party name with color|Bharatiya Janata Party}}
|-
|Speaker
|[[Firstseat (Assembly constituency)|Firstseat]]
|[[Other Person]]
|{{Party name with color|Bharatiya Janata Party}}`));
assert(stray.length === 1 && stray[0].name === 'Real Member', 'first group wins over stray re-link');

// 8. Plain-text member in the continuation row (no wikilink).
const plain = parseMembers(wrap(`|-
|rowspan=2|14
|rowspan=2|[[Plainseat (Assembly constituency)|Plainseat]]
|[[Old Member]]
|{{Party name with color|Bharatiya Janata Party}}
|Resigned on 1 May 2025
|-
|New Plain Member
|{{Party name with color|Indian National Congress}}
|Elected on 30 June 2025`));
assert(plain.length === 1 && plain[0].name === 'New Plain Member', `plain-text continuation member (got ${plain[0]?.name})`);

// 9. Two by-elections in one term (rowspan=3): last row wins.
const triple = parseMembers(wrap(`|-
|rowspan=3|15
|rowspan=3|[[Tripleseat (Assembly constituency)|Tripleseat]]
|[[First Member]]
|{{Party name with color|Bharatiya Janata Party}}
|Died on 1 January 2025
|-
|[[Second Member]]
|{{Party name with color|Bharatiya Janata Party}}
|Elected on 1 April 2025; died on 15 April 2026
|-
|[[Third Member]]
|{{Party name with color|Bharatiya Janata Party}}
|Elected on 30 June 2026`));
assert(triple.length === 1 && triple[0].name === 'Third Member', `rowspan=3 picks last winner (got ${triple[0]?.name})`);

// 10. Party carried from a rowspanned party cell (party-sectioned tables).
const carried = parseMembers(wrap(`|-
|16
|[[Carryseat (Assembly constituency)|Carryseat]]
|[[Member A]]
|rowspan=2 {{Party name with color|Bharatiya Janata Party}}
|-
|17
|[[Carryseat Two (Assembly constituency)|Carryseat Two]]
|[[Member B]]`));
assert(carried.length === 2 && carried[1]?.party === 'Bharatiya Janata Party', `party carries across rowspan (got ${carried[1]?.party})`);

// 11. A leading district-column link is not a member name (16th KA format).
const district = parseMembers(wrap(`|-
| rowspan="6" |[[Uttara Kannada]]
|76
|[[Haliyal (Karnataka Assembly constituency)|Haliyal]]
|[[R. V. Deshpande]]
|{{Party name with color|Indian National Congress}}
|`));
assert(district.length === 1 && district[0].name === 'R. V. Deshpande', `district link not a name (got ${district[0]?.name})`);

// 12. rowspan inside a party template is NOT a seat rowspan (Nalasopara/Jayadev):
// the next constituency-less junk row must not be swallowed as a member.
const tmplSpan = parseSeats(wrap(`|-
|132
|[[Nalasopara Assembly constituency|Nalasopara]]
|[[Rajan Naik]]
|{{Party name with color|Bharatiya Janata Party|rowspan=2}}
|-
|[[Vasai]]
|Some junk row without a constituency link`));
assert(tmplSpan.length === 1 && tmplSpan[0].sitting?.name === 'Rajan Naik', `template rowspan not a seat span (got ${tmplSpan[0]?.sitting?.name})`);

// 13. Attr params inside party templates are skipped; a suspension note keeps the member.
const suspended = parseMembers(wrap(`|-
| rowspan="8" | [[Khordha district|Khordha]]
| 111
| [[Jayadev Assembly constituency|Jayadev]] (SC)
| [[Naba Kishor Mallick]]
| {{Full party name with color|rowspan=3|Biju Janata Dal}}
|Suspended from Party for cross voting`));
assert(suspended.length === 1 && suspended[0].name === 'Naba Kishor Mallick', 'suspended member still sitting');
assert(suspended[0]?.party === 'Biju Janata Dal', `attr param skipped in party template (got ${suspended[0]?.party})`);

// 14. Member-rowspan party-history rows: member kept, party updated to the last row's.
const history = parseMembers(wrap(`|-
| rowspan="2"|251
|rowspan="2"|[[Sirathu (Assembly constituency)|Sirathu]]
|rowspan="2"|[[Pallavi Patel]]
|bgcolor=#FF0000|
|[[Samajwadi Party]]
| {{Party name with colour|Indian National Developmental Inclusive Alliance}}
|-
|bgcolor=#27176D|
|[[Apna Dal (Kamerawadi)]]
| {{Party name with colour|Pichhra Dalit Muslim|shortname=PDM|color=#030303}}`));
assert(history.length === 1 && history[0].name === 'Pallavi Patel', 'party-history rows keep the member');
assert(history[0]?.party === 'Apna Dal (Kamerawadi)', `party updated from history row (got ${history[0]?.party})`);

// 15. Links inside <ref> cites are never names; Vacant + resignation -> vacant.
const refJunk = parseSeats(wrap(`|-
|rowspan="2" |182
|rowspan="2" |[[Bankipur Assembly constituency|Bankipur]]
|[[Nitin Nabin]]
|-
|colspan="5" style="text-align:center;"|''[[Casual vacancy#India|Vacant]]''
|Resigned on 30 March 2026<ref name="X">{{cite web |title=... |url=https://x |website=[[The Economic Times]]}}</ref>`));
assert(refJunk.length === 1 && refJunk[0].sitting === null, 'resigned + Vacant row -> vacant');
assert(refJunk[0]?.departed.length === 1 && refJunk[0].departed[0].name === 'Nitin Nabin', `ref links not names (got ${JSON.stringify(refJunk[0]?.departed.map(d => d.name))})`);

// 16. Departure-note semantics.
assert(isDepartureNote('Resigned on 30 March 2026'), 'bare resignation = departure');
assert(isDepartureNote('On 25 May 2026, resigned from office and joined TVK'), 'resigned from office = departure');
assert(!isDepartureNote('Resigned from AIADMK on 1 June 2026'), 'resigned from a party != departure');
assert(!isDepartureNote('Resigned as minister on 2 February 2025'), 'resigned as minister != departure');
assert(isDepartureNote('Died on 10 May 2026'), 'death = departure');
assert(!isDepartureNote('Suspended from Party for cross voting'), 'suspension != departure');

// 17. Party year-range tails are stripped (en dash included); role prefixes too.
const dash = parseMembers(wrap(`|-
|1
|[[Someplace (Assembly constituency)|Someplace]]
|[[Member C]]
|{{Party name with color|Shiv Sena (2022–present)}}
|-
|2
|[[Otherplace (Assembly constituency)|Otherplace]]
|[[Member D]]
|{{Party name with color|National Working President of Telugu Desam Party}}`));
assert(dash[0]?.party === 'Shiv Sena', `en-dash year tail stripped (got ${dash[0]?.party})`);
assert(dash[1]?.party === 'Telugu Desam Party', `role prefix stripped (got ${dash[1]?.party})`);

// 18. Two party columns (party then alliance): the party column wins (17th TN).
const alliance = parseMembers(wrap(`|-
| rowspan="2" |141
| rowspan="2" |[[Tiruchirappalli East Assembly constituency|Tiruchirappalli East]]
|[[C. Joseph Vijay]]
|{{Party name with color|Tamilaga Vettri Kazhagam}}
|{{Party name with color|TVK-led Alliance|color=#800200|shortname=TVK+}}
|
|-
|colspan="5" style="text-align:center;"|''[[Casual vacancy#India|Vacant]]''
|On 10 May 2026, resigned from office and retained the Perambur Assembly constituency`));
assert(alliance.length === 0, 'resigned-from-office continuation vacates the seat');
const allianceSeat = parseSeats(wrap(`|-
|142
|[[Perambur Assembly constituency|Perambur]]
|[[C. Joseph Vijay]]
|{{Party name with color|Tamilaga Vettri Kazhagam}}
|{{Party name with color|TVK-led Alliance|color=#800200|shortname=TVK+}}
|`));
assert(allianceSeat[0]?.sitting?.party === 'Tamilaga Vettri Kazhagam', `party column beats alliance column (got ${allianceSeat[0]?.sitting?.party})`);

if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1); }
console.log('\nAll MLA parse regressions passed.');
