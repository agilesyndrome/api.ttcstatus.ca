import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { authorizedSync, REVOKED_SYNC_TOKEN_SHA256 } = await compileModules(`
  export * from './workers/shared/http/admin-auth';
`);
const request = (value) =>
  new Request('https://example.test/api/v1/admin/sync', {
    headers: { authorization: value },
  });

test('admin authorization rejects missing or incorrect bearer credentials', async () => {
  assert.equal(await authorizedSync(request('Bearer test'), {}), false);
  assert.equal(
    await authorizedSync(request('Bearer wrong'), { SYNC_TOKEN: 'test' }),
    false,
  );
  assert.equal(
    await authorizedSync(request('Bearer test'), { SYNC_TOKEN: 'test' }),
    true,
  );
});

test('the exposed credential fingerprint is denied even when bearer and configuration match', async () => {
  const original = crypto.subtle.digest;
  crypto.subtle.digest = async () =>
    Uint8Array.from(Buffer.from(REVOKED_SYNC_TOKEN_SHA256, 'hex')).buffer;
  try {
    assert.equal(
      await authorizedSync(request('Bearer test'), { SYNC_TOKEN: 'test' }),
      false,
    );
  } finally {
    crypto.subtle.digest = original;
  }
});
