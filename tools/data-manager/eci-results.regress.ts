/**
 * Regression checks for the live-to-final election hand-off. ECI deliberately
 * keeps a completed table at "leading" until a Returning Officer marks the
 * winner as "won"; never turn the former into the latter ourselves.
 *
 * Usage: npm run test:eci-results
 */
import {
  officialWinnerOf,
  parseReaderWinnerDeclaration,
  parseWinnerDeclaration,
} from '../../lib/eci-results';
import type { ElectionResultRow } from '../../lib/types';

let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log('ok:', message);
  else {
    console.error('FAIL:', message);
    failed++;
  }
}

const leadingHtml = `
  <div class='cand-box'><div class='status leading'><div class='captli'>leading</div></div>
  <div class='nme-prty'><h5>PRASHANT KISHOR</h5></div></div>`;
const wonHtml = `
  <div class='cand-box'><div class='status won'><div class='captli'>won</div></div>
  <div class='nme-prty'><h5>SATENDRABHAI PATEL (SATISH PATEL)</h5></div></div>`;
const wonReader = `
won

55481 (+ 30630)

##### SATENDRABHAI PATEL (SATISH PATEL)
`;

const rows: ElectionResultRow[] = [
  { name: 'SATENDRABHAI PATEL (SATISH PATEL)', party: 'Bharatiya Janata Party', evm_votes: 55321, postal_votes: 160, total_votes: 55481, vote_share_pct: 67.19, candidateSlug: 'satendrabhai-patel-satish-patel' },
  { name: 'BHIKHABHAI RABARI (B.E. MECHANICAL)', party: 'Indian National Congress', evm_votes: 24759, postal_votes: 92, total_votes: 24851, vote_share_pct: 30.09, candidateSlug: 'bhikhabhai-rabari-b-e-mechanical' },
  { name: 'NOTA', party: 'None of the Above', evm_votes: 2239, postal_votes: 8, total_votes: 2247, vote_share_pct: 2.72, isNota: true },
];

assert(parseWinnerDeclaration(leadingHtml) === null, 'a complete count marked leading is not a winner declaration');
assert(parseWinnerDeclaration(wonHtml) === 'SATENDRABHAI PATEL (SATISH PATEL)', 'HTML declaration extracts ECI’s winner');
assert(parseReaderWinnerDeclaration(wonReader) === 'SATENDRABHAI PATEL (SATISH PATEL)', 'reader declaration extracts ECI’s winner');

const official = officialWinnerOf(rows, 'SATENDRABHAI PATEL (SATISH PATEL)');
assert(official?.winner_slug === 'satendrabhai-patel-satish-patel', 'declared winner joins the candidate roster');
assert(official?.margin === 30630, 'declared winner uses the exact table margin');
assert(officialWinnerOf(rows, 'BHIKHABHAI RABARI (B.E. MECHANICAL)') === null, 'a stale or mismatched declaration cannot override the table leader');

if (failed) process.exit(1);
console.log('All ECI result regressions passed.');
