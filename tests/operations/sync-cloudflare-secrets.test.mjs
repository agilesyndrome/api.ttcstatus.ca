import assert from 'node:assert/strict';
import test from 'node:test';
import {
  draftVersionIds,
  listDraftVersions,
  purgeDraftVersions,
  syncSecrets,
} from '../../scripts/operations/sync-cloudflare-secrets.mjs';

test('only versions absent from all deployments are drafts', () => {
  const versions = ['current', 'rollback', 'split', 'draft'].map((id) => ({ id }));
  const deployments = [
    { versions: [{ version_id: 'current' }] },
    { versions: [{ version_id: 'rollback' }, { version_id: 'split' }] },
  ];
  assert.deepEqual(draftVersionIds(versions, deployments), ['draft']);
});

test('purge checks every page before deleting drafts', async () => {
  const deleted = [];
  const request = async (path, method) => {
    if (method === 'DELETE') {
      deleted.push(path);
      return { success: true };
    }
    if (path.includes('/workers/ttcstatus-api/versions')) {
      return path.includes('?page=1&')
        ? {
            result: [{ id: 'draft-one' }, { id: 'current' }],
            result_info: { total_pages: 2 },
          }
        : {
            result: [{ id: 'draft-two' }, { id: 'rollback' }],
            result_info: { total_pages: 2 },
          };
    }
    return {
      result: {
        deployments: [
          {
            id: 'deployment',
            versions: [{ version_id: 'current' }, { version_id: 'rollback' }],
          },
        ],
      },
      result_info: { total_pages: 1 },
    };
  };

  const drafts = await listDraftVersions(request);
  await purgeDraftVersions(request, drafts);
  assert.deepEqual(deleted, [
    '/workers/ttcstatus-api/versions/draft-one',
    '/workers/ttcstatus-api/versions/draft-two',
  ]);
});

test('purge pages until empty when Cloudflare omits result_info', async () => {
  const deleted = [];
  const request = async (path, method) => {
    if (method === 'DELETE') {
      deleted.push(path);
      return { success: true };
    }
    const page = Number(new URL(path, 'https://example.com').searchParams.get('page'));
    if (path.includes('/workers/ttcstatus-api/versions')) {
      return {
        result: [[{ id: 'current' }, { id: 'draft' }], [{ id: 'draft-two' }], []][
          page - 1
        ],
      };
    }
    return {
      result: {
        deployments: [[{ id: 'deployment', versions: [{ version_id: 'current' }] }], []][
          page - 1
        ],
      },
    };
  };

  const drafts = await listDraftVersions(request);
  await purgeDraftVersions(request, drafts);
  assert.deepEqual(deleted, [
    '/workers/ttcstatus-api/versions/draft',
    '/workers/ttcstatus-api/versions/draft-two',
  ]);
});

test('purge refuses repeated pages when pagination metadata is absent', async () => {
  let deleted = false;
  const request = async (path, method) => {
    if (method === 'DELETE') deleted = true;
    return path.includes('/versions')
      ? { result: [{ id: 'same-version' }] }
      : { result: { deployments: [{ id: 'same-deployment', versions: [] }] } };
  };
  await assert.rejects(listDraftVersions(request), /Duplicate or invalid item/);
  assert.equal(deleted, false);
});

test('purge refuses to delete versions without a deployment to preserve', async () => {
  let deleted = false;
  const request = async (_path, method) => {
    if (method === 'DELETE') deleted = true;
    return _path.includes('/versions')
      ? { result: [{ id: 'sole-version' }], result_info: { total_pages: 1 } }
      : { result: { deployments: [] }, result_info: { total_pages: 1 } };
  };
  await assert.rejects(listDraftVersions(request), /no deployment to preserve/);
  assert.equal(deleted, false);
});

test('sync stages a complete version before purging the old latest draft and deploying', async () => {
  const calls = [];
  let tag;
  const request = async (path, method) => {
    if (method === 'DELETE') {
      calls.push({ action: 'purge', path });
      return { success: true };
    }
    if (path.endsWith('/versions/latest')) {
      calls.push({ action: 'latest' });
      return { result: { id: 'new-version', annotations: { 'workers/tag': tag } } };
    }
    return path.includes('/versions')
      ? {
          result: [{ id: 'old-latest-draft' }, { id: 'current' }],
          result_info: { total_pages: 1 },
        }
      : {
          result: {
            deployments: [{ id: 'deployment', versions: [{ version_id: 'current' }] }],
          },
          result_info: { total_pages: 1 },
        };
  };
  const run = async (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'versions' && args[1] === 'secret') tag = args[4];
  };
  const env = {
    CLERK_PUBLISHABLE_KEY: 'publishable',
    CLERK_SECRET_KEY: 'private',
    SYNC_TOKEN: 'sync',
    CLERK_JWKS_URL: 'jwks',
  };

  await syncSecrets(request, run, env);

  assert.deepEqual(calls[0].args.slice(0, 4), ['versions', 'secret', 'bulk', '--tag']);
  assert.deepEqual(JSON.parse(calls[0].input), env);
  assert.deepEqual(calls[1], { action: 'latest' });
  assert.deepEqual(calls[2], {
    action: 'purge',
    path: '/workers/ttcstatus-api/versions/old-latest-draft',
  });
  assert.deepEqual(calls[3], {
    args: ['versions', 'deploy', 'new-version@100%', '--yes'],
    input: undefined,
  });
  assert.equal(calls.length, 4);
});

test('sync stops before purge and deploy if the new version is not latest', async () => {
  const calls = [];
  const request = async (path, method) => {
    if (method === 'DELETE') calls.push('delete');
    if (path.endsWith('/versions/latest')) {
      return { result: { id: 'old-draft', annotations: {} } };
    }
    return path.includes('/versions')
      ? {
          result: [{ id: 'old-draft' }, { id: 'current' }],
          result_info: { total_pages: 1 },
        }
      : {
          result: {
            deployments: [{ id: 'deployment', versions: [{ version_id: 'current' }] }],
          },
          result_info: { total_pages: 1 },
        };
  };
  const run = async (args) => calls.push(args[1]);
  await assert.rejects(
    syncSecrets(request, run, {
      CLERK_PUBLISHABLE_KEY: 'publishable',
      CLERK_SECRET_KEY: 'private',
      SYNC_TOKEN: 'sync',
      CLERK_JWKS_URL: 'jwks',
    }),
    /not the latest Worker version/,
  );
  assert.deepEqual(calls, ['secret']);
});
