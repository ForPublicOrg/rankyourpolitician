// Vercel "Ignored Build Step": exit 0 = skip the deployment, non-zero = build.
// Skips builds for commits that only touch docs/CI config (*.md, .github/,
// .claude/) - each skipped build saves the full prebuild + next-build minutes.
//
// Base commit: VERCEL_GIT_PREVIOUS_SHA (the previously deployed commit) when
// Vercel provides it and it exists in the clone - this spans ALL commits since
// the last deployment, so a push of [code fix, docs tweak] is still built.
// Fallback is HEAD^, which fully covers this repo's merge-commit PR workflow
// (HEAD^ of a merge commit is the previous main tip). Residual gap: a DIRECT
// multi-commit push whose tip is docs-only, on a clone where the previous-SHA
// var is absent - avoid pushing doc-only commits on top of undeployed code.
// Any error (missing base, shallow clone, no git) exits 1 = build: fail open.
import { execFileSync } from 'node:child_process';

const exists = (ref) => {
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const prev = process.env.VERCEL_GIT_PREVIOUS_SHA;
const base = prev && exists(prev) ? prev : 'HEAD^';
if (!exists(base)) {
  console.log(`vercel-ignore: no reachable base commit (${base}) - building.`);
  process.exit(1);
}

try {
  execFileSync('git', ['diff', '--quiet', base, 'HEAD', '--', ':!*.md', ':!.github/**', ':!.claude/**'], {
    stdio: 'ignore',
  });
  console.log(`vercel-ignore: only docs/CI files changed since ${base} - skipping this build.`);
  process.exit(0);
} catch {
  console.log(`vercel-ignore: build-relevant changes since ${base} - building.`);
  process.exit(1);
}
