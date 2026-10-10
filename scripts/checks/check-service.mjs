import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

// Run against `npm run dev:viewer` (the preview middleware serves the map and
// the corpus; this check intercepts only the flag gate and swaps in the FULL
// combined corpus so every overlay state is visible at once). Fixture data is
// computed with the real shared math — every layer agrees about what happened.
const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';

const bundle = await build({
  stdin: {
    contents: `
  export { SCENARIOS, VOID_CORRIDOR_STOPS } from './shared/service/fixtures';
  export { serviceStatesAt } from './shared/service/wait-metrics';
  export { serviceConfig } from './shared/service/config';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});
const directory = await mkdtemp(join(tmpdir(), 'ttc-check-service-'));
await writeFile(join(directory, 'corpus.mjs'), bundle.outputFiles[0].text);
const { SCENARIOS, VOID_CORRIDOR_STOPS, serviceStatesAt, serviceConfig } = await import(
  pathToFileURL(join(directory, 'corpus.mjs')).href
);
await rm(directory, { recursive: true, force: true });

const config = serviceConfig();
// One combined payload across every scenario: each state carries its own
// lastTouchAt/elapsed, so a single snapshot can show all five states at once.
const combined = { schemaVersion: 1, at: Date.now(), states: [] };
const positions = {};
for (const scenario of SCENARIOS) {
  const states = serviceStatesAt(scenario.touches, scenario.coverage, {
    windowStart: scenario.windowStart,
    at: scenario.at,
    config,
  });
  for (const state of states.values()) combined.states.push(state);
  Object.assign(positions, scenario.stopPositions);
}
const wavePayload = {
  schemaVersion: 1,
  windowStart: Date.now() - 30 * 60 * 1000,
  windowEnd: Date.now(),
  routes: [
    {
      routeId: '506',
      directionId: 0,
      patternStopIds: [...VOID_CORRIDOR_STOPS, 'st_clock', 'st_bunched'],
      touches: [],
    },
  ],
};
for (const scenario of SCENARIOS) {
  const shift = wavePayload.windowEnd - scenario.at;
  for (const touch of scenario.touches) {
    const stopIndex = wavePayload.routes[0].patternStopIds.indexOf(touch.stopId);
    if (stopIndex < 0) continue;
    wavePayload.routes[0].touches.push({
      stopIndex,
      dt: touch.t + shift - wavePayload.windowStart,
      vehicleId: touch.vehicleId,
      directionId: touch.directionId,
      mode: touch.mode,
    });
  }
}
wavePayload.routes[0].touches.sort((a, b) => a.dt - b.dt);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
try {
  // ---- 1. Flag gated OFF: nothing renders, nothing is even fetched.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await installAccountFixture(context, { signedIn: true });
    let serviceCalls = 0;
    await context.route('**/api/v1/me/features', (route) =>
      route.fulfill({ json: { schemaVersion: 1, flags: [] } }),
    );
    await context.route('**/api/v1/service/**', (route) => {
      serviceCalls += 1;
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    assert.equal(serviceCalls, 0, 'flag off must mean zero /service/* requests');
    assert.equal(await page.locator('.void-overlay').count(), 0);
    assert.equal(await page.locator('.service-panel').count(), 0);
    await context.close();
  }

  // ---- 2. Flag ON: all five states at a glance, directions split, honesty.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await installAccountFixture(context, { signedIn: true });
    await context.route('**/api/v1/me/features', (route) =>
      route.fulfill({ json: { schemaVersion: 1, flags: ['voidOverlay'] } }),
    );
    await context.route('**/api/v1/service/stops', (route) =>
      route.fulfill({ json: combined }),
    );
    await context.route('**/api/v1/service/wave', (route) =>
      route.fulfill({ json: wavePayload }),
    );
    await context.route('**/api/v1/service/preview-positions', (route) =>
      route.fulfill({ json: { schemaVersion: 1, positions } }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page
      .locator('.void-overlay')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });

    // All five states are distinguishable at a glance (5.2).
    for (const state of ['fresh', 'due', 'void', 'unmonitored', 'collecting']) {
      const count = await page.locator(`.void-marker--${state}`).count();
      assert.ok(count > 0, `expected at least one ${state} marker`);
    }
    // Directions split: both direction markers exist (a one-way void is
    // visible as exactly that).
    assert.ok((await page.locator('.void-marker[data-direction="0"]').count()) > 0);
    assert.ok((await page.locator('.void-marker[data-direction="1"]').count()) > 0);
    // Night vs day: the calm night stop is due; the all-day disaster is void.
    const night = await page
      .locator('[data-stop-id="st_night"]')
      .getAttribute('data-state');
    const disaster = await page
      .locator('[data-stop-id="st_disaster"]')
      .getAttribute('data-state');
    assert.equal(night, 'due');
    assert.equal(disaster, 'void');
    // Unmonitored vs void: hatched and classed differently, never confused.
    const silent = page.locator('[data-stop-id="st_silent"]');
    assert.equal(await silent.getAttribute('data-state'), 'unmonitored');
    assert.equal(await silent.locator('rect').count(), 1); // hatched, not a circle
    // Absolute minutes always present on void markers (both truths, always).
    const voided = page.locator('.void-marker--void').first();
    const label = await voided
      .locator('text', /\dm(\.\d)?/)
      .first()
      .textContent();
    assert.match(label ?? '', /\dm/);
    // Back-to-back badges show where the pairs passed through (5.5 display).
    assert.ok(
      (await page.locator('.void-overlay text', { hasText: 'b2b×' }).count()) > 0,
    );
    // The replay renders touch dots from the wave; the bunch fixture's
    // back-to-back cluster and the empty wedge are pure geometry (5.3).
    const dots = await page.locator('.service-replay__plot circle').count();
    assert.ok(dots > 10, `expected replay dots, got ${dots}`);
    const scrub = page.locator('.service-replay__scrubber input');
    await scrub.fill(String(10 * 60 * 1000));
    assert.ok(await page.locator('.service-replay__scrub').count());
    // The selected stop's 36-hour sparkline renders from /service/history
    // (5.4): per-bucket touches at the 5-minute grain, coherently.
    await page
      .locator('.service-panel__sparkline select')
      .selectOption({ label: 'st_void_1' });
    await page
      .locator('.service-sparkline')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
    const bars = await page.locator('.service-sparkline rect').count();
    assert.ok(bars > 10, `expected sparkline buckets, got ${bars}`);
    // Pan/zoom still behaves with the layer on (5.2: no measurable regression).
    await page.locator('#map').hover();
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(200);
    assert.ok((await page.locator('.void-overlay').count()) === 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('check-service: PASS — overlay states, gating, honesty, replay, zoom');
} finally {
  await browser.close();
}
