import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const {
  apiUrl,
  createApiClient,
  internalDestination,
  platform,
  readSnapshot,
  saveSnapshot,
  removeSnapshot,
  snapshotKey,
} = await compileModules(`
  export { apiUrl } from './web/ui/services/http/config';
  export { createApiClient } from './web/ui/services/http/client';
  export { internalDestination } from './web/ui/services/navigation/destinations';
  export { platform } from './web/ui/services/platform';
  export { readSnapshot, saveSnapshot, removeSnapshot, snapshotKey } from './web/ui/services/cache/snapshots';
`);

test('API origin configuration preserves same-origin web and explicit native HTTPS requests', () => {
  assert.equal(apiUrl('/api/v1/map/ttcstatus', ''), '/api/v1/map/ttcstatus');
  assert.equal(
    apiUrl('/api/v1/me/stops', 'https://ttcstatus.ca'),
    'https://ttcstatus.ca/api/v1/me/stops',
  );
  assert.equal(
    apiUrl('/api/v1/me/stops', 'http://localhost:8787'),
    'http://localhost:8787/api/v1/me/stops',
  );
  for (const path of [
    'https://other.test/api/v1/me/stops',
    '//other.test/api/v1/me/stops',
    '/settings',
    '/api/\\other.test',
  ])
    assert.throws(() => apiUrl(path, 'https://ttcstatus.ca'));
  assert.throws(() => apiUrl('/api/v1/me/stops', 'http://other.test'));
});

test('authorized clients inject the current token without sharing it with public requests', async () => {
  const seen = [];
  const transport = async (url, init) => {
    seen.push({ url, init });
    return new Response('{}');
  };
  let token = 'first';
  const privateClient = createApiClient({
    origin: 'https://ttcstatus.ca',
    token: async () => token,
    credentials: 'omit',
    fetch: transport,
  });
  await privateClient('/api/v1/me/stops', { method: 'PUT', body: '{}' });
  token = 'second';
  await privateClient('/api/v1/me/journal');
  await createApiClient({ origin: 'https://ttcstatus.ca', fetch: transport })(
    '/api/v1/map/ttcstatus',
  );
  assert.equal(seen[0].init.headers.get('authorization'), 'Bearer first');
  assert.equal(seen[1].init.headers.get('authorization'), 'Bearer second');
  assert.equal(seen[2].init.headers.get('authorization'), null);
  assert.equal(seen[0].init.credentials, 'omit');
  assert.equal(seen[2].init.credentials, 'same-origin');
  token = null;
  await assert.rejects(privateClient('/api/v1/me/stops'));
  assert.equal(seen.length, 3);
});

test('request cancellation and timeouts stop the transport rather than leaving polling in flight', async () => {
  const transport = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  const client = createApiClient({
    origin: 'https://ttcstatus.ca',
    fetch: transport,
    timeoutMs: 10,
  });
  await assert.rejects(client('/api/v1/map/ttcstatus'), /timed out/);
  const controller = new AbortController();
  const pending = client('/api/v1/map/ttcstatus', { signal: controller.signal });
  controller.abort(new Error('screen closed'));
  await assert.rejects(pending, /screen closed/);
});

test('notification and shared-link destinations accept only known internal app routes', () => {
  assert.equal(
    internalDestination(
      '/settings#language',
      'capacitor://localhost/',
      'https://ttcstatus.ca',
    ),
    '/settings#language',
  );
  assert.equal(
    internalDestination(
      'capacitor://other/settings',
      'capacitor://localhost/',
      'https://ttcstatus.ca',
    ),
    undefined,
  );
  assert.equal(
    internalDestination(
      'https://ttcstatus.ca/#stop=stop%3A1436',
      'capacitor://localhost',
      'https://ttcstatus.ca',
    ),
    '/#stop=stop%3A1436',
  );
  assert.equal(
    internalDestination(
      '/settings#language',
      'https://ttcstatus.ca',
      'https://ttcstatus.ca',
    ),
    '/settings#language',
  );
  for (const value of [
    'https://other.test/settings',
    'javascript:alert(1)',
    '/api/v1/me/stops',
    '/snake/v1',
    '/unknown',
  ])
    assert.equal(
      internalDestination(value, 'https://ttcstatus.ca', 'https://ttcstatus.ca'),
      undefined,
    );
});

test('the request deadline covers native token acquisition and a response body still arriving', async () => {
  const waitingToken = createApiClient({
    origin: 'https://ttcstatus.ca',
    timeoutMs: 10,
    token: () => new Promise(() => {}),
    fetch: async () => {
      assert.fail('transport must wait for a token');
    },
  });
  await assert.rejects(waitingToken('/api/v1/me/stops'), /timed out/);
  const waitingBody = createApiClient({
    origin: 'https://ttcstatus.ca',
    timeoutMs: 10,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'));
          },
        }),
      ),
  });
  await assert.rejects(waitingBody('/api/v1/map/ttcstatus'), /timed out/);
  const cancelled = new AbortController();
  cancelled.abort(new Error('already closed'));
  await assert.rejects(
    createApiClient({
      fetch: async () => assert.fail('cancelled requests never start transport'),
    })('/api/v1/map/ttcstatus', { signal: cancelled.signal }),
    /already closed/,
  );
});

test('cached snapshots validate data and isolate users, origins, and pinned map versions', async () => {
  const original = platform().cache;
  const values = new Map();
  platform().cache = {
    get: async (key) => values.get(key),
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
  try {
    const first = snapshotKey('account:a', '/api/v1/me/stops', 'https://ttcstatus.ca');
    const other = snapshotKey('account:b', '/api/v1/me/stops', 'https://ttcstatus.ca');
    const valid = (value) =>
      Array.isArray(value) && value.every((id) => typeof id === 'string');
    await saveSnapshot(first, {
      value: ['stop:1436'],
      savedAt: Date.now(),
      etag: '"one"',
    });
    assert.deepEqual((await readSnapshot(first, valid)).value, ['stop:1436']);
    assert.equal(await readSnapshot(other, valid), undefined);
    values.set(first, { value: [42], savedAt: Date.now() });
    assert.equal(await readSnapshot(first, valid), undefined);
    assert.notEqual(
      snapshotKey('public-map', '?tag=stable', 'https://ttcstatus.ca'),
      snapshotKey('public-map', '?tag=latest', 'https://ttcstatus.ca'),
    );
    assert.notEqual(
      first,
      snapshotKey('account:a', '/api/v1/me/stops', 'https://preview.test'),
    );
  } finally {
    platform().cache = original;
  }
});

test('sign-out deletion follows an already pending native cache save', async () => {
  const original = platform().cache;
  const operations = [];
  let finish;
  platform().cache = {
    get: async () => undefined,
    set: async () => {
      operations.push('save-start');
      await new Promise((resolve) => {
        finish = resolve;
      });
      operations.push('save-end');
    },
    remove: async () => {
      operations.push('remove');
    },
  };
  try {
    const save = saveSnapshot('private-account', { value: [], savedAt: Date.now() });
    const remove = removeSnapshot('private-account');
    await Promise.resolve();
    assert.deepEqual(operations, ['save-start']);
    finish();
    await Promise.all([save, remove]);
    assert.deepEqual(operations, ['save-start', 'save-end', 'remove']);
  } finally {
    platform().cache = original;
  }
});
