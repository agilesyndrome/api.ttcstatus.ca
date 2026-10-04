import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// Inspect tracked and new source files; ignored local credentials stay private.
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sk_(?:live|test)_[A-Za-z0-9]{20,}/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/,
  /\bSYNC_TOKEN\s*=\s*(?!REPLACE_WITH_)[A-Za-z0-9_-]{20,}/,
];
const failures = new Set();
for (const file of files) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.example')) failures.add(file);
  try {
    const source = await readFile(file, 'utf8');
    if (patterns.some((pattern) => pattern.test(source))) failures.add(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
if (failures.size) {
  // Never print the matching credential, even in CI logs.
  console.error('Possible credentials in source files:\n' + [...failures].join('\n'));
  process.exitCode = 1;
} else {
  console.log('Source credential scan passed.');
}
