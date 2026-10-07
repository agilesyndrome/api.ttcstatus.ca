#!/usr/bin/env node
// Working-tree secret scan via gitleaks.
//
// gitleaks' `dir` mode takes exactly one target path (extra positional
// arguments are silently ignored in v8.30) and does not respect .gitignore,
// so this wrapper:
//
//   1. asks git for the files it tracks plus new untracked files — the same
//      set the old regex scanner covered, so ignored local credentials
//      (.env.local, .env.prod) never reach the scanner;
//   2. hardlinks (or copies) them into a staging tree under the tools
//      directory, mirroring their repo-relative paths;
//   3. runs ONE `gitleaks dir .` from inside the staging tree, so findings
//      print repo-relative paths and fingerprints match .gitleaksignore.
//
// Swap out the secret scanner someday? This wrapper is referenced from
// security.json's `checks.secrets.command` — replace it there with another
// tool; nothing else needs to change.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { ROOT, loadConfig } from './config.mjs';

function toolsDirPath() {
  return join(ROOT, '.tools');
}

// Prefer the binary this repo manages in its tools directory; fall back to
// whatever `gitleaks` resolves to on PATH (the runner puts .tools on PATH).
async function resolveBinary() {
  let toolsDir = '.tools';
  try {
    const config = await loadConfig();
    toolsDir = config.toolsDir ?? toolsDir;
  } catch {
    // No/invalid security.json: the standard install location still works.
  }
  const name = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  const local = join(ROOT, toolsDir, name);
  return { binary: existsSync(local) ? local : 'gitleaks', toolsDir };
}

function gitFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(`git ls-files failed: ${result.stderr}`);
    process.exit(1);
  }
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((file) => existsSync(join(ROOT, file))); // tracked but deleted
}

const { binary, toolsDir } = await resolveBinary();
const files = gitFiles();
const stage = join(toolsDirPath() || toolsDir, '.scan');
const toml = join(ROOT, 'scripts', 'preflight', 'gitleaks.toml');

if (!files.length) {
  console.log('No tracked files to scan.');
  process.exit(0);
}

rmSync(stage, { recursive: true, force: true });
try {
  for (const file of files) {
    const target = join(stage, file);
    mkdirSync(dirname(target), { recursive: true });
    try {
      linkSync(join(ROOT, file), target); // instant when the fs allows it
    } catch {
      copyFileSync(join(ROOT, file), target);
    }
  }
  // The ignore file documents accepted findings; honor it here too so the
  // same fingerprints work for both the tree and history scans.
  const ignoreFile = join(ROOT, '.gitleaksignore');
  if (existsSync(ignoreFile)) copyFileSync(ignoreFile, join(stage, '.gitleaksignore'));

  const result = spawnSync(
    binary,
    ['dir', '--redact', '--no-banner', '--verbose', '--config', toml],
    { cwd: stage, encoding: 'utf8' },
  );
  if (result.error) {
    console.error(`gitleaks could not run: ${result.error.message}`);
    console.error('Install it with: ./pre-flight install');
    process.exit(1);
  }
  const output = `${result.stdout}${result.stderr}`.trim();
  if (output) console.log(output);
  process.exitCode = result.status === 0 ? 0 : 1;
  if (result.status === 0) {
    console.log(`Working-tree secret scan passed (${files.length} files, gitleaks).`);
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}
