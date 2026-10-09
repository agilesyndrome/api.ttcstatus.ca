// Runs from npm's "prepare" lifecycle script on npm install / npm ci.
// Copies scripts/hooks/pre-commit into .git/hooks so commits are gated on
// `./pre-flight precommit` (prettier --write, then every check). No dependencies; safe to run anywhere.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const source = fileURLToPath(new URL('pre-commit', import.meta.url));

let hooksPath = '';
try {
  hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // core.hooksPath not configured; fall through to .git/hooks.
}
if (hooksPath) {
  console.log(`Skipping hook install: core.hooksPath is set (${hooksPath}).`);
  process.exit(0);
}

if (!existsSync(join(repo, '.git'))) {
  console.log('Skipping hook install: not a git repository.');
  process.exit(0);
}

const hooksDir = join(repo, '.git', 'hooks');
mkdirSync(hooksDir, { recursive: true });
const target = join(hooksDir, 'pre-commit');
copyFileSync(source, target);
chmodSync(target, 0o755);
console.log('Installed .git/hooks/pre-commit (runs ./pre-flight precommit).');
