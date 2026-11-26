// Builds the vote rollup (lib/vote-rollup.ts) from `vote_aggregates`.
//
// Run it once AFTER the deploy that added the rollup is live: votes cast on the
// old code never reach the rollup. Until it runs, the site keeps scanning
// `vote_aggregates` as before. Safe to re-run at any time; it also repairs drift.
//
// Cost: about two reads per rated person plus 16, and 16 writes.
//
// Run:  npx tsx tools/data-manager/build-vote-rollup.ts           (dry run)
//       npx tsx tools/data-manager/build-vote-rollup.ts --apply   (writes)
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getDb } from '../../lib/firebase-admin';
import { rebuildVoteRollup, printRollupReport } from './vote-rollup-shared';

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();
  if (!db) {
    console.error('✗ Firestore is not configured (.env.local creds missing). Nothing to build.');
    process.exit(1);
  }
  console.log(`Building vote rollup from vote_aggregates${apply ? '' : ' (dry run)'}…`);
  printRollupReport(await rebuildVoteRollup(db, apply), apply);
  if (!apply) console.log('Re-run with --apply to write.');
}

main().catch((e) => {
  console.error('✗ build-vote-rollup failed:', e);
  process.exit(1);
});
