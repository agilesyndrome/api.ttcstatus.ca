import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const config = 'workers/api/wrangler.jsonc';
const workerName = 'ttcstatus-api';
const wrangler = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const secretNames = [
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'SYNC_TOKEN',
  'CLERK_JWKS_URL',
];

function runWrangler(args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(wrangler, ['wrangler', ...args, '-c', config], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        // Wrangler may include the supplied JSON in an input error. Never echo secrets.
        const detail = input === undefined ? `: ${stderr.trim()}` : '';
        reject(new Error(`wrangler ${args.join(' ')} failed (exit ${code})${detail}`));
      }
    });
    child.stdin.end(input);
  });
}

async function cloudflareClient() {
  const credential = await runWrangler(['auth', 'token', '--json']);
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    const identity = JSON.parse(await runWrangler(['whoami', '--json']));
    if (identity.accounts?.length !== 1) {
      throw new Error('Set CLOUDFLARE_ACCOUNT_ID when Wrangler has multiple accounts.');
    }
    accountId = identity.accounts[0].id;
  }
  const auth = JSON.parse(credential);
  const headers =
    auth.type === 'api_key'
      ? { 'X-Auth-Email': auth.email, 'X-Auth-Key': auth.key }
      : { Authorization: `Bearer ${auth.token}` };
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`;

  return async (path, method = 'GET') => {
    const response = await fetch(`${base}${path}`, { method, headers });
    const body = await response.json();
    if (!response.ok || !body.success) {
      const message =
        body.errors?.map(({ message: error }) => error).join('; ') || response.statusText;
      throw new Error(`Cloudflare ${method} ${path} failed: ${message}`);
    }
    return body;
  };
}

async function listPages(request, path, select) {
  const items = [];
  const seen = new Set();
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const body = await request(`${path}${separator}page=${page}&per_page=100`);
    const batch = select(body.result);
    if (!Array.isArray(batch))
      throw new Error(`Unexpected Cloudflare response for ${path}`);
    const totalPages = body.result_info?.total_pages;
    if (
      totalPages !== undefined &&
      (!Number.isInteger(totalPages) || totalPages < page)
    ) {
      throw new Error(`Invalid pagination data for ${path}`);
    }
    for (const item of batch) {
      if (typeof item.id !== 'string' || seen.has(item.id)) {
        throw new Error(`Duplicate or invalid item while paging ${path}`);
      }
      seen.add(item.id);
    }
    items.push(...batch);
    // Some Cloudflare responses omit result_info. In that case, keep paging
    // until an empty page proves the list is complete before deleting anything.
    if (totalPages === undefined ? batch.length === 0 : page >= totalPages) {
      return items;
    }
  }
}

export function draftVersionIds(versions, deployments) {
  const deployed = new Set(
    deployments.flatMap(({ versions: entries }) =>
      entries.map(({ version_id: id }) => id),
    ),
  );
  return versions.filter(({ id }) => !deployed.has(id)).map(({ id }) => id);
}

export async function listDraftVersions(request) {
  const worker = encodeURIComponent(workerName);
  const [versions, deployments] = await Promise.all([
    listPages(request, `/workers/${worker}/versions`, (result) => result),
    listPages(request, `/scripts/${worker}/deployments`, (result) => result.deployments),
  ]);
  if (deployments.length === 0) {
    throw new Error('The Worker has no deployment to preserve while purging drafts.');
  }
  return draftVersionIds(versions, deployments);
}

export async function purgeDraftVersions(request, drafts) {
  const worker = encodeURIComponent(workerName);
  for (const id of drafts) {
    await request(`/workers/${worker}/versions/${encodeURIComponent(id)}`, 'DELETE');
  }
  console.log(`Purged ${drafts.length} undeployed Worker version(s).`);
}

async function waitForLatestVersion(request, tag) {
  const worker = encodeURIComponent(workerName);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const latest = (await request(`/workers/${worker}/versions/latest`)).result;
    if (latest?.id && latest.annotations?.['workers/tag'] === tag) return latest.id;
    if (attempt < 9) await delay(500);
  }
  throw new Error('The newly created secret version is not the latest Worker version.');
}

async function main() {
  const missing = secretNames.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required secret environment variables: ${missing.join(', ')}`,
    );
  }
  await access(resolve(root, config));

  const request = await cloudflareClient();
  await syncSecrets(request);
}

export async function syncSecrets(request, run = runWrangler, env = process.env) {
  // Cloudflare refuses to delete the latest version. Snapshot the old drafts,
  // then create a complete replacement before deleting any of them.
  const drafts = await listDraftVersions(request);

  const tag = `secret-sync-${randomUUID()}`;
  const secrets = Object.fromEntries(secretNames.map((name) => [name, env[name]]));
  await run(['versions', 'secret', 'bulk', '--tag', tag], JSON.stringify(secrets));
  console.log(`Created one Worker version with ${secretNames.length} secrets.`);
  const versionId = await waitForLatestVersion(request, tag);
  await purgeDraftVersions(request, drafts);
  await run(['versions', 'deploy', `${versionId}@100%`, '--yes']);
  console.log('Cloudflare Worker secrets are synchronized.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
