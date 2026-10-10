import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createDatabase } from '../helpers/database.mjs';
import { compileModules } from '../helpers/compile.mjs';
import {
  disableFeature,
  enableFeature,
  listFeatureFlags,
  resolveSubject,
  validFlagName,
} from '../../scripts/operations/feature-flags.mjs';

const { ownedAccountResponse } = await compileModules(
  `export * from './workers/api/src/accounts/index';`,
);
const schema = await readFile('migrations/0005_feature_flags.sql', 'utf8');
const database = () => createDatabase(schema);

test('feature flags round-trip through real SQLite: grant, upsert, revoke, list', async () => {
  const db = database();
  await enableFeature(db, {
    flag: 'voidOverlay',
    subject: 'user_a',
    grantedBy: 'drew',
    grantedAt: 1,
  });
  await enableFeature(db, {
    flag: 'voidOverlay',
    subject: 'user_b',
    grantedBy: 'drew',
    grantedAt: 2,
  });
  // Re-granting refreshes the grant instead of duplicating it.
  await enableFeature(db, {
    flag: 'voidOverlay',
    subject: 'user_a',
    grantedBy: 'kim',
    grantedAt: 3,
  });
  const listed = await listFeatureFlags(db);
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.flags, [
    {
      flag: 'voidOverlay',
      subjects: [
        { subject: 'user_a', grantedAt: 3, grantedBy: 'kim' },
        { subject: 'user_b', grantedAt: 2, grantedBy: 'drew' },
      ],
    },
  ]);
  const revoked = await disableFeature(db, { flag: 'voidOverlay', subject: 'user_b' });
  assert.equal(revoked.removed, true);
  assert.equal((await listFeatureFlags(db)).total, 1);
  const missing = await disableFeature(db, { flag: 'voidOverlay', subject: 'user_b' });
  assert.equal(missing.removed, false);
});

test('flag names are validated the way map tags are', () => {
  assert.equal(validFlagName('voidOverlay'), true);
  assert.equal(validFlagName('a'.repeat(64)), true);
  assert.equal(validFlagName(''), false);
  assert.equal(validFlagName('bad flag!'), false);
  assert.equal(validFlagName('.leading-dot'), false);
  assert.equal(validFlagName('-dash'), false);
});

test('non-email subjects pass through; emails require CLERK_SECRET_KEY', async () => {
  assert.equal(await resolveSubject('user_2abc'), 'user_2abc');
  await assert.rejects(() => resolveSubject('drew@easleyowl.com'), /CLERK_SECRET_KEY/);
});

test('emails resolve to Clerk user ids through the Backend API', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([{ id: 'user_resolved' }]), { status: 200 });
  };
  assert.equal(
    await resolveSubject('drew@easleyowl.com', {
      clerkSecretKey: 'sk_test',
      fetchImpl: fakeFetch,
    }),
    'user_resolved',
  );
  assert.match(calls[0].url, /email_address=drew%40easleyowl\.com/);
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk_test');
});

test("GET /api/v1/me/features: caller's flags, no-store, CORS; empty for strangers", async () => {
  const db = database();
  await enableFeature(db, {
    flag: 'voidOverlay',
    subject: 'user_a',
    grantedBy: 'drew',
    grantedAt: 1,
  });
  await enableFeature(db, {
    flag: 'other',
    subject: 'user_b',
    grantedBy: 'drew',
    grantedAt: 2,
  });
  const response = await ownedAccountResponse(
    new Request('https://ttcstatus.ca/api/v1/me/features'),
    { DB: db },
    'user_a',
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await response.json(), { schemaVersion: 1, flags: ['voidOverlay'] });
  const stranger = await ownedAccountResponse(
    new Request('https://ttcstatus.ca/api/v1/me/features'),
    { DB: db },
    'user_c',
  );
  assert.deepEqual(await stranger.json(), { schemaVersion: 1, flags: [] });
});
