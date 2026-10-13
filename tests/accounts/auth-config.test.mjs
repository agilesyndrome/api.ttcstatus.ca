import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { authConfig, overlayConfig, parseOverlayTransportConfig } = await compileModules(`
  export { authConfig, overlayConfig } from './workers/api/src/accounts/auth';
  export { parseOverlayTransportConfig } from './shared/live/config';
`);

// ---- The overlay block (docs/optimize-overlay.md E1S4) ----

test('auth/config returns the overlay block additively, disabled by default', () => {
  const config = authConfig({ DB: null });
  // The rollout switch ships off: the overlay is not public until the
  // OVERLAY_ENABLED var flips in the dashboard (E6S4).
  assert.equal(config.overlay.enabled, false);
  assert.equal(config.overlay.pathTemplate, '/live/t/{tick}/service-stops.json');
  assert.equal(config.overlay.pollSeconds, 30);
  // The recorder consumes the same defaults for its unconditional publish.
  assert.deepEqual(overlayConfig({}), {
    enabled: false,
    pathTemplate: '/live/t/{tick}/service-stops.json',
    pollSeconds: 30,
  });
});

test('overlay block honors env overrides and clamps the poll cadence', () => {
  const config = authConfig({
    DB: null,
    OVERLAY_ENABLED: 'true',
    LIVE_SERVICE_PATH_TEMPLATE: '/live/t/{tick}/service-stops.min.json',
    OVERLAY_POLL_SECONDS: '60',
  });
  assert.equal(config.overlay.enabled, true);
  assert.equal(config.overlay.pathTemplate, '/live/t/{tick}/service-stops.min.json');
  // A slower poll cadence is allowed (tick derivation stays on the grid);
  // nonsense falls back to the default, never divides by zero.
  assert.equal(config.overlay.pollSeconds, 60);
  assert.equal(overlayConfig({ OVERLAY_POLL_SECONDS: 'not-a-number' }).pollSeconds, 30);
});

test('parseOverlayTransportConfig validates like the live block — never a fallback', () => {
  const good = parseOverlayTransportConfig({
    overlay: {
      enabled: true,
      pathTemplate: '/live/t/{tick}/service-stops.json',
      pollSeconds: 60,
    },
  });
  assert.deepEqual(good, {
    enabled: true,
    pathTemplate: '/live/t/{tick}/service-stops.json',
    pollSeconds: 60,
  });
  // Unknown extra fields are tolerated (additive evolution).
  assert.equal(
    parseOverlayTransportConfig({
      overlay: {
        enabled: false,
        pathTemplate: '/live/t/{tick}/service-stops.json',
        extra: 1,
      },
    }).enabled,
    false,
  );
  // Missing/insane blocks throw before any overlay transport runs.
  assert.throws(() => parseOverlayTransportConfig({}), /missing overlay block/);
  assert.throws(
    () =>
      parseOverlayTransportConfig({
        overlay: { enabled: 'yes', pathTemplate: '/live/t/{tick}/x' },
      }),
    /overlay.enabled must be boolean/,
  );
  assert.throws(
    () =>
      parseOverlayTransportConfig({
        overlay: { enabled: true, pathTemplate: '/api/v1/service/stops?routes=506' },
      }),
    /immutable tick path/,
  );
});

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
