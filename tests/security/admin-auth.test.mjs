import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { authorizedSync } = await compileModules(`
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
  // Digest comparison: extra material after the token must not match.
  assert.equal(
    await authorizedSync(request('Bearer test extra'), { SYNC_TOKEN: 'test' }),
    false,
  );
  // Only the Bearer scheme is honored.
  assert.equal(
    await authorizedSync(request('Token test'), { SYNC_TOKEN: 'test' }),
    false,
  );
  assert.equal(
    await authorizedSync(request('Bearer test'), { SYNC_TOKEN: 'test' }),
    true,
  );
});
