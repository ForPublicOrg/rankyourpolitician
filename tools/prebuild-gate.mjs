// Hash-gated prebuild: regenerates the public/*.json payloads only when their
// inputs changed. `next build` dominates build minutes, but the three
// generator scripts re-parsed the 15MB seed on every deploy - including the
// common UI-only deploys where nothing they read had changed.
//
// How it works: the committed public/.prebuild-hash holds two SHA-256 digests -
// one over every GIT-TRACKED input (data/seed/**, lib/**/*.ts(x),
// tools/**/*.ts|mjs, package-lock.json) and one over the generated outputs.
// Both match -> skip. Anything else -> regenerate and refresh the file (commit
// it alongside regenerated payloads so the next CI/Vercel build can skip too).
// Tracked-files-only means local scratch/WIP files cannot poison the hash;
// attesting the outputs means a partially-committed regeneration can never
// stale-skip. Line endings are normalised so Windows (CRLF) and CI (LF)
// checkouts agree. Every failure mode - missing git, unreadable file, hash
// drift - falls back to today's behaviour, a full regenerate; never a stale
// skip.
//
// Run: node tools/prebuild-gate.mjs   (wired to `npm run prebuild`)
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HASH_FILE = join(ROOT, 'public', '.prebuild-hash');
const SCRIPTS = ['tools/build-search-index.ts', 'tools/build-who-data.ts', 'tools/build-rankings-data.ts'];

const isCodeFile = (p) => p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.mjs');

/** Git-tracked input files (repo-relative, forward slashes). Tracked-only is
 *  the point: CI hashes the checkout, so untracked local files must not feed
 *  the committed hash. */
function trackedInputs() {
  const out = execSync('git ls-files -z -- data/seed lib tools package-lock.json', {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((p) => p.startsWith('data/seed/') || p === 'package-lock.json' || isCodeFile(p));
}

/** Current output files on disk (the two payloads + everything under who/). */
function outputFiles() {
  const files = ['public/search-index.json', 'public/rankings.json'];
  const whoDir = join(ROOT, 'public', 'who');
  if (existsSync(whoDir)) {
    for (const name of readdirSync(whoDir).sort()) {
      if (statSync(join(whoDir, name)).isFile()) files.push(`public/who/${name}`);
    }
  }
  return files;
}

/** SHA-256 over relative paths + CRLF-normalised contents. A listed-but-missing
 *  file hashes as a marker: deterministic, and it can only force a regenerate. */
function hashFiles(relPaths) {
  const h = createHash('sha256');
  for (const rel of relPaths) {
    h.update(rel);
    h.update('\0');
    try {
      h.update(readFileSync(join(ROOT, rel)).toString('binary').replaceAll('\r\n', '\n'));
    } catch {
      h.update('<missing>');
    }
    h.update('\0');
  }
  return h.digest('hex');
}

let current = null;
try {
  current = `inputs=${hashFiles(trackedInputs())}\noutputs=${hashFiles(outputFiles())}\n`;
} catch (err) {
  // No git / unexpected failure: fall back to always-regenerate, loudly.
  console.warn(`prebuild: could not compute input hash (${err instanceof Error ? err.message : err}) - regenerating unconditionally.`);
}
const prev = existsSync(HASH_FILE) ? readFileSync(HASH_FILE, 'utf8').replaceAll('\r\n', '\n') : null;

if (current !== null && prev === current) {
  console.log(`prebuild: inputs and outputs unchanged (${current.slice(7, 19)}…) - skipping payload regeneration.`);
} else {
  console.log('prebuild: inputs or outputs changed - regenerating public payloads.');
  if (current !== null && prev !== null && (process.env.VERCEL || process.env.CI)) {
    console.warn(
      'prebuild: NOTE hash mismatch in CI. Run `npm run build` locally and commit public/.prebuild-hash (plus any regenerated payloads) to let CI builds skip this step.',
    );
  }
  for (const s of SCRIPTS) execSync(`npx tsx ${s}`, { cwd: ROOT, stdio: 'inherit' });
  if (current !== null) {
    // Re-attest the outputs that were just written.
    writeFileSync(HASH_FILE, `inputs=${hashFiles(trackedInputs())}\noutputs=${hashFiles(outputFiles())}\n`);
    console.log('prebuild: refreshed public/.prebuild-hash - commit it (with any regenerated payloads) so CI builds can skip.');
  }
}
