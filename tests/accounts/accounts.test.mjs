import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../helpers/database.mjs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compileModules } from '../helpers/compile.mjs';

const {
  api,
  authConfig,
  authenticateAccount,
  ownedAccountResponse,
  publicProfileResponse,
} = await compileModules(
  `export * from './workers/api/src/accounts/index'; export { default as api } from './workers/api/src/index';`,
);
const schema = await readFile('migrations/0002_accounts.sql', 'utf8');
const database = () => createDatabase(schema);

const entry = {
  vehicleId: '4400',
  label: '4400',
  recordedAt: '2026-10-03T12:00:00.000Z',
  note: 'Private note',
  routeId: '501',
};
const request = (path, value, method = value === undefined ? 'GET' : 'PUT') =>
  new Request(`https://ttcstatus.ca/api/v1/me/${path}`, {
    method,
    ...(value === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }),
  });

test('runtime configuration exposes only the publishable key; missing keys leave public transit usable', async () => {
  assert.deepEqual(authConfig({ CLERK_PUBLISHABLE_KEY: 'pk_test_public' }), {
    enabled: false,
    publishableKey: null,
  });
  const response = await api.fetch(
    new Request('https://ttcstatus.ca/api/v1/auth/config'),
    { CLERK_PUBLISHABLE_KEY: 'pk_test_public', CLERK_SECRET_KEY: 'must-not-leak' },
    {},
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    enabled: true,
    publishableKey: 'pk_test_public',
  });
  assert.equal((await api.fetch(request('journal'), {}, {})).status, 503);
  assert.equal(
    (await api.fetch(new Request('https://ttcstatus.ca/api/healthz'), {}, {})).status,
    200,
  );
});

test('journal ownership, durable updates, revision conflicts and invalid payloads are enforced by real SQLite', async () => {
  const env = { DB: database() };
  const call = (value, user = 'user_a') =>
    ownedAccountResponse(request('journal', value), env, user);
  assert.deepEqual(await (await call()).json(), { entries: [], revision: 0 });
  assert.equal((await call({ entries: [entry], revision: 0 })).status, 200);
  assert.deepEqual(await (await call()).json(), { entries: [entry], revision: 1 });
  assert.deepEqual(await (await call(undefined, 'user_b')).json(), {
    entries: [],
    revision: 0,
  });
  assert.equal((await call({ entries: [], revision: 0 })).status, 409);
  assert.equal(
    (await call({ entries: [{ ...entry, note: 'Updated' }], revision: 1 })).status,
    200,
  );
  assert.equal((await call({ entries: [], revision: 1 })).status, 409);
  assert.equal((await call({ entries: [], revision: 2, userId: 'user_b' })).status, 400);
  assert.equal(
    (await call({ entries: [{ ...entry, latitude: 43.6 }], revision: 2 })).status,
    400,
  );
  assert.equal((await call({ entries: [], revision: -1 })).status, 400);
  const fresh = await (await call()).json();
  assert.equal(fresh.entries[0].note, 'Updated');
  assert.equal(fresh.revision, 2);
  assert.equal((await call({ entries: [], revision: 2 })).status, 200);
});

test('profile defaults are private, usernames are unique, and public profiles expose only earned badges', async () => {
  const env = { DB: database() };
  assert.deepEqual(
    await (await ownedAccountResponse(request('profile'), env, 'user_a')).json(),
    { username: '', publicBadges: false },
  );
  const profile = (username, publicBadges, user = 'user_a') =>
    ownedAccountResponse(request('profile', { username, publicBadges }), env, user);
  assert.equal((await profile('collector', false)).status, 200);
  assert.equal((await profile('collector', true, 'user_b')).status, 409);
  for (const username of ['../bad', 'Bad', 'x', '<script>', '-invalid', 'a'.repeat(31)])
    assert.equal((await profile(username, true)).status, 400);
  assert.equal((await profile('collector', 'yes')).status, 400);
  const hidden = await publicProfileResponse(env, 'collector');
  assert.equal(hidden.status, 404);
  assert.deepEqual(
    await hidden.json(),
    await (await publicProfileResponse(env, 'missing')).json(),
  );
  await ownedAccountResponse(
    request('journal', { entries: [entry], revision: 0 }),
    env,
    'user_a',
  );
  await profile('collector', true);
  const publicResponse = await publicProfileResponse(env, 'collector');
  assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
  const publicData = await publicResponse.json();
  assert.deepEqual(Object.keys(publicData), ['username', 'badges']);
  assert.equal(publicData.badges.length, 1);
  assert.equal(publicData.badges[0].name, 'First catch');
  assert.deepEqual(Object.keys(publicData.badges[0]), ['name', 'icon', 'description']);
  for (const privateValue of ['Private note', '4400', 'user_a', '2026-10-03'])
    assert.ok(!JSON.stringify(publicData).includes(privateValue));
  await profile('new-name', true);
  assert.equal((await publicProfileResponse(env, 'collector')).status, 404);
  await profile('new-name', false);
  assert.equal((await publicProfileResponse(env, 'new-name')).status, 404);
});

test('account writes reject wrong content types, malformed JSON, excessive bodies and unsupported methods', async () => {
  const env = { DB: database() };
  for (const [init, expected] of [
    [{ method: 'PUT', body: '{}' }, 415],
    [{ method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{' }, 400],
    [
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: ' '.repeat(1_500_001),
      },
      413,
    ],
    [{ method: 'DELETE' }, 405],
  ])
    assert.equal(
      (
        await ownedAccountResponse(
          new Request('https://ttcstatus.ca/api/v1/me/journal', init),
          env,
          'user_a',
        )
      ).status,
      expected,
    );
});

test('real Clerk session verification accepts signed tokens and rejects tampering, expiry, foreign origins and cookie-only requests', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'ttc-test-key',
    alg: 'RS256',
    use: 'sig',
  };
  const env = {
    CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('auth.test$').toString('base64')}`,
    CLERK_SECRET_KEY: 'sk_test_fake',
    DB: database(),
  };
  const originalFetch = globalThis.fetch;
  const originalEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.ok(url.includes('/jwks'), `unexpected authentication request: ${url}`);
    return Response.json({ keys: [key] });
  };
  const token = (extra = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user_signed',
        sid: 'sess_test',
        iss: 'https://auth.test',
        azp: 'https://ttcstatus.ca',
        iat: now,
        nbf: now - 1,
        exp: now + 60,
        ...extra,
      }),
    ).toString('base64url');
    const contents = `${header}.${payload}`;
    return `${contents}.${sign('RSA-SHA256', Buffer.from(contents), privateKey).toString('base64url')}`;
  };
  const authenticated = (value) =>
    new Request('https://ttcstatus.ca/api/v1/me/journal', {
      headers: { authorization: `Bearer ${value}` },
    });
  try {
    assert.equal(await authenticateAccount(authenticated(token()), env), 'user_signed');
    assert.equal((await api.fetch(authenticated(token()), env, {})).status, 200);
    for (const invalid of [
      token({ exp: 1 }),
      token({ azp: 'https://evil.test' }),
      token().replace(/.$/, '!'),
      'not-a-jwt',
    ])
      assert.equal((await authenticateAccount(authenticated(invalid), env)).status, 401);
    assert.equal(
      (
        await authenticateAccount(
          new Request('https://ttcstatus.ca/api/v1/me/journal', {
            headers: { cookie: `__session=${token()}` },
          }),
          env,
        )
      ).status,
      401,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
});

test('seen cars can be upgraded, edited and deleted privately with validated statuses', async () => {
  const env = { DB: database() };
  const call = (value, user = 'owner') =>
    ownedAccountResponse(request('journal', value), env, user);
  const seen = { ...entry, status: 'seen' };
  assert.equal((await call({ entries: [seen], revision: 0 })).status, 200);
  for (const status of ['invalid', null, 1, {}, 'Ridden']) {
    assert.equal(
      (await call({ entries: [{ ...seen, status }], revision: 1 })).status,
      400,
    );
  }
  const ridden = { ...seen, status: 'ridden', note: 'Rode this car today' };
  assert.equal((await call({ entries: [ridden], revision: 1 })).status, 200);
  assert.deepEqual((await (await call()).json()).entries, [ridden]);
  assert.equal((await call({ entries: [], revision: 2 }, 'another-user')).status, 409);
  assert.deepEqual((await (await call(undefined, 'another-user')).json()).entries, []);
  assert.equal((await call({ entries: [], revision: 2 })).status, 200);
  assert.deepEqual((await (await call()).json()).entries, []);
});
