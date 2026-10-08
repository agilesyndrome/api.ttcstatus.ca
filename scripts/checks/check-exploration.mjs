import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const compiled = await build({
  stdin: {
    contents: `export { buildViewerData } from './shared/map/model'; export { mapToGps } from './shared/map/projection';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const { buildViewerData, mapToGps } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const data = buildViewerData(map);
const queen = data.routes.find((route) => route.number === '501');
const king = data.routes.find((route) => route.number === '504');
const stop = data.features.find((feature) => feature.boardingPoints > 0);
const gps = mapToGps(stop.point, data.geographicTransform);
const errors = [];
let feedCalls = 0;
let reportTime = Date.now();
let latitude = gps.latitude;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
// The first-visit affiliation banner overlays the bottom of the map and the
// mobile panel; dismiss it so the checks can reach the tools underneath.
async function dismissNotice(page) {
  const gotIt = page.getByRole('button', { name: 'Got it', exact: true });
  if (await gotIt.count()) await gotIt.click();
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    colorScheme: 'light',
  });
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  await context.route('**/api/v1/map/streetcar?format=schematic-v1', (route) =>
    route.fulfill({ json: map }),
  );
  await context.route('**/api/v1/vehicles/streetcar', (route) => {
    feedCalls++;
    return route.fulfill({
      headers: { 'x-live-update-seconds': '30' },
      json: {
        schemaVersion: 1,
        source: 'exploration-fixture',
        attribution: 'Fixture',
        fetchedAt: new Date(reportTime).toISOString(),
        feedTimestamp: new Date(reportTime).toISOString(),
        invalidPositions: 0,
        vehicles: Array.from({ length: 26 }, (_, index) => ({
          id: String(4400 + index),
          label: index === 7 ? '=1+1' : String(4400 + index),
          latitude: index === 2 ? 43.75 : index === 0 ? latitude : gps.latitude,
          longitude: index === 2 ? -79.55 : gps.longitude,
          routeId: index === 2 ? undefined : index === 3 ? king.id : queen.id,
          speedMetresPerSecond:
            index === 1
              ? 50
              : index === 25
                ? 20
                : index === 0
                  ? 10
                  : index === 3
                    ? 0
                    : undefined,
          observedAt: new Date(reportTime - (index === 1 ? 600000 : 0)).toISOString(),
        })),
      },
    });
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('[data-vehicle="4400"]').waitFor();
  await dismissNotice(page);

  // Personal tabs need an account; signed-out visitors only get Explore.
  assert.equal(await page.getByRole('tab').count(), 1, 'only Explore renders signed out');
  assert.equal(
    await page
      .getByRole('tab', { name: 'Explore', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );

  // Live cars select and follow from the map, reusing the shared snapshot.
  const startCalls = feedCalls;
  await page.locator('[data-vehicle="4400"] .streetcar-body').last().click();
  await page.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  await page.getByRole('button', { name: '4400 Unfollow', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '4400 Unfollow', exact: true }).count(),
    0,
    'manual zoom pauses following and removes the unfollow control',
  );
  await page.getByRole('button', { name: 'Fit map', exact: true }).click();
  assert.equal(
    feedCalls,
    startCalls,
    'car selection and following reuse the shared snapshot',
  );
  await page.getByRole('button', { name: 'Close streetcar details' }).click();

  // Geolocation places a marker without sharing or persisting coordinates.
  await context.grant_permissions(['geolocation'], { origin: new URL(origin).origin });
  await context.setGeolocation({ ...gps, accuracy: 25 });
  await page.getByRole('button', { name: 'Locate me & centre map', exact: true }).click();
  await page.locator('.location-marker').waitFor();
  await page.getByRole('button', { name: 'Clear location', exact: true }).click();
  assert.equal(await page.locator('.location-marker').count(), 0);

  // Letter keys are opt-out and never intercept typing inside tool controls.
  const headerSearch = page.getByRole('searchbox', {
    name: 'Search stops, stations, routes or streetcar numbers',
  });
  await headerSearch.fill('fncrs');
  assert.equal(
    await page
      .getByRole('tab', { name: 'Explore', exact: true })
      .getAttribute('aria-selected'),
    'true',
    'typing in a search does not trigger shortcuts',
  );
  await page.locator('#map').focus();
  await page.keyboard.press('e');
  await page.getByRole('tab', { name: 'Explore', exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('tab', { name: 'Explore', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );
  await page.keyboard.press('/');
  assert.equal(
    await headerSearch.evaluate((node) => node === document.activeElement),
    true,
  );
  await page.locator('#map').focus();
  await page.keyboard.press('?');
  await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).waitFor();
  await page
    .getByRole('checkbox', { name: 'Enable keyboard shortcuts', exact: true })
    .uncheck();
  await page.keyboard.press('Escape');
  assert.equal(
    await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count(),
    0,
  );
  await page.locator('#map').focus();
  await page.keyboard.press('f');
  assert.equal(
    await page
      .getByRole('tab', { name: 'Explore', exact: true })
      .getAttribute('aria-selected'),
    'true',
    'opted-out letter keys do nothing',
  );
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Enable keyboard shortcuts', exact: true })
    .check();
  await page.getByRole('button', { name: 'Close shortcut help', exact: true }).click();
  await page.getByRole('tab', { name: 'Explore', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page
      .getByRole('tab', { name: 'Explore', exact: true })
      .getAttribute('aria-selected'),
    'true',
    'the single signed-out tab wraps onto itself',
  );
  await page.screenshot({ path: '/tmp/ttc-hackathon-explore.png' });

  // Narrow layouts keep the tools on screen without horizontal overflow.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `tools fit a ${width}px screen`,
    );
    await page.screenshot({ path: `/tmp/ttc-hackathon-tools-${width}.png` });
  }

  // Virtual time verifies actual following across snapshot refreshes without waiting 30 seconds.
  const follower = await context.newPage();
  reportTime = Date.now();
  await follower.clock.install({ time: reportTime });
  await follower.goto(`${origin}/#car=4400`);
  await follower.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  await dismissNotice(follower);
  await follower.getByRole('button', { name: '4400 Unfollow', exact: true }).waitFor();
  const before = await follower.locator('#map').getAttribute('viewBox');
  latitude += 0.001;
  reportTime += 30000;
  await follower.clock.fastForward(30000);
  await follower.waitForFunction(
    (previous) => document.querySelector('#map').getAttribute('viewBox') !== previous,
    before,
  );
  await follower.getByRole('button', { name: 'Fit map', exact: true }).click();
  const paused = await follower.locator('#map').getAttribute('viewBox');
  latitude += 0.001;
  reportTime += 30000;
  await follower.clock.fastForward(30000);
  await follower.waitForTimeout(100);
  assert.equal(
    await follower.locator('#map').getAttribute('viewBox'),
    paused,
    'manual camera interaction stops automatic following',
  );
  await follower.close();
  assert.deepEqual(errors, []);
  console.log(
    'Exploration UI passed: signed-out explore-only tabs, live-car selection/following/pause, geolocation, keyboard help/opt-out, 320px/390px layouts; no browser errors.',
  );
  await context.close();
} finally {
  await browser.close();
}
