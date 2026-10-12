import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { authConfig } = await compileModules(`export { authConfig } from './workers/api/src/accounts/auth';`);

test('auth/config returns the live transport block additively', () => {
  const config = authConfig({ DB: null });
  // Existing fields unchanged: unconfigured Clerk reads as disabled.
  assert.equal(config.enabled, false);
  assert.equal(config.publishableKey, null);
  // New block: the only source of the live host, cadence, and path template.
  assert.equal(config.live.base, 'https://live.ttcstatus.ca');
  assert.equal(config.live.pathTemplate, '/live/t/{tick}/vehicles.json');
  assert.equal(config.live.updateSeconds, 30);
});

test('live block honors env overrides and rejects bad cadence', () => {
  const config = authConfig({
    DB: null,
    LIVE_PUBLIC_BASE: 'https://staging-live.example.ca',
    LIVE_PATH_TEMPLATE: '/live/t/{tick}/vehicles.min.json',
    LIVE_UPDATE_SECONDS: '60',
  });
  assert.equal(config.live.base, 'https://staging-live.example.ca');
  assert.equal(config.live.pathTemplate, '/live/t/{tick}/vehicles.min.json');
  assert.equal(config.live.updateSeconds, 60);
  // Unknown-field tolerance: extra env fields never throw; a nonsense
  // cadence falls back to the default grid rather than dividing by zero.
  const broken = authConfig({ DB: null, LIVE_UPDATE_SECONDS: 'not-a-number' });
  assert.equal(broken.live.updateSeconds, 30);
});

test('configured Clerk keys keep enabled semantics with the live block present', () => {
  const config = authConfig({
    DB: null,
    CLERK_PUBLISHABLE_KEY: 'pk_test_publishable',
    CLERK_SECRET_KEY: 'sk_test_secret',
    CLERK_AUTHORIZED_PARTIES: 'https://ttcstatus.ca,capacitor://localhost',
  });
  assert.equal(config.enabled, true);
  assert.equal(config.publishableKey, 'pk_test_publishable');
  assert.equal(config.live.updateSeconds, 30);
});