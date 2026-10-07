import { spawn } from 'node:child_process';

/** Runs every pre-flight task in parallel, prints each task's full output
 * once it finishes, then a summary line per task. Unlike `a && b && c`, one
 * failure never hides the results of the other tasks. */
const bin = (name) => `node_modules/.bin/${name}`;

const tasks = [
  { name: 'check:secrets', command: 'node scripts/checks/check-secrets.mjs' },
  { name: 'check:boundaries', command: 'node scripts/checks/check-boundaries.mjs' },
  { name: 'typecheck', command: `${bin('tsc')} --noEmit` },
  { name: 'lint', command: `${bin('eslint')} .` },
  { name: 'format:check', command: `${bin('prettier')} --check .` },
  { name: 'test', command: 'node --test --test-isolation=none tests/*/*.test.mjs' },
  { name: 'build:ui', command: `${bin('vite')} build` },
  { name: 'build:viewer', command: 'node scripts/build/build-viewer.mjs' },
];

const checkOnly = process.argv.includes('--check-only');
const selected = checkOnly
  ? tasks.filter((task) => !task.name.startsWith('build'))
  : tasks;

function run(task) {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(task.command, {
      shell: true,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const capture = (stream) => stream.on('data', (data) => (output += data));
    capture(child.stdout);
    capture(child.stderr);
    child.on('close', (code) =>
      resolve({ ...task, code, output, seconds: (performance.now() - started) / 1000 }),
    );
  });
}

console.log(
  `Running ${selected.length} tasks in parallel${checkOnly ? ' (checks only)' : ''}...\n`,
);
const results = await Promise.all(selected.map(run));

for (const result of results) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(
    `${result.code === 0 ? '✔' : '✖'} ${result.name} (${result.seconds.toFixed(1)}s)`,
  );
  console.log('─'.repeat(60));
  if (result.output.trim()) console.log(result.output.trimEnd());
}

const failures = results.filter((result) => result.code !== 0);
console.log(`\n${'═'.repeat(60)}`);
console.log(
  results.map((result) => `${result.code === 0 ? '✔' : '✖'} ${result.name}`).join('  '),
);
console.log(
  `${failures.length ? `${failures.length} task(s) failed` : 'All tasks passed'} in ${(
    Math.max(...results.map((result) => result.seconds)) || 0
  ).toFixed(1)}s`,
);

if (failures.length) {
  console.error(`\nFailed: ${failures.map((task) => task.name).join(', ')}`);
  process.exit(1);
}
