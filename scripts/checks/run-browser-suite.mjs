import { spawn } from 'node:child_process';

/** A local child server makes the suite reproducible, including isolated network environments. */
const checks = process.argv.slice(2);
const names = checks.length ? checks : ['ui', 'mobile', 'auth', 'i18n'];
const port = process.env.UI_TEST_PORT ?? '4175';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let diagnostics = '';
server.stderr.on('data', (data) => {
  diagnostics += data.toString();
});
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`UI server startup timed out: ${diagnostics}`)),
      15000,
    );
    server.stdout.on('data', (data) => {
      if (data.toString().includes('Local:')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.once('error', reject);
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`UI server exited ${code}: ${diagnostics}`));
    });
  });
  for (const name of names) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid browser check name');
    const check = spawn(process.execPath, [`scripts/checks/check-${name}.mjs`], {
      stdio: 'inherit',
      env: { ...process.env, UI_URL: `http://127.0.0.1:${port}` },
    });
    const code = await new Promise((resolve, reject) => {
      check.once('error', reject);
      check.once('exit', resolve);
    });
    if (code !== 0) throw new Error(`Browser check failed: ${name}`);
  }
} finally {
  server.kill();
}
