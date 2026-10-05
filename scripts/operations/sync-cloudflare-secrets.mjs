import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();

const secretBindings = [
  {
    name: 'CLERK_PUBLISHABLE_KEY',
    config: 'workers/api/wrangler.jsonc',
  },
  {
    name: 'CLERK_SECRET_KEY',
    config: 'workers/api/wrangler.jsonc',
  },
  {
    name: 'SYNC_TOKEN',
    config: 'workers/api/wrangler.jsonc',
  },
  {
    name: 'SYNC_TOKEN',
    config: 'workers/map-generator/wrangler.jsonc',
  },
];

const missing = [
  ...new Set(secretBindings.map(({ name }) => name).filter((name) => !process.env[name])),
];

if (missing.length > 0) {
  console.error(`Missing required secret environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const wrangler = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function putSecret(name, config) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(wrangler, ['wrangler', 'secret', 'put', name, '-c', config], {
      cwd: root,
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(
          new Error(
            `wrangler secret put failed for ${name} (${config}) with exit code ${code}`,
          ),
        );
      }
    });

    child.stdin.end(`${process.env[name]}\n`);
  });
}

await Promise.all(secretBindings.map(({ config }) => access(resolve(root, config))));

for (const { name, config } of secretBindings) {
  console.log(`Syncing ${name} -> ${config}`);
  await putSecret(name, config);
}

console.log('Cloudflare Worker secrets are synchronized.');
