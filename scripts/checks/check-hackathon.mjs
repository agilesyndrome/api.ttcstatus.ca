import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Offline fixtures: no upstream TTC calls, location lookups or deployments.
const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const compiled = await build({
  stdin: {
    contents: `export { buildViewerData } from './shared/map/model'; export { mapToGps } from './shared/map/projection'; export { nearbyStops } from './web/ui/commute';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const { buildViewerData, mapToGps, nearbyStops } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const data = buildViewerData(map);
const queen = data.routes.find((route) => route.number === '501');
const stop = data.features.find(
  (feature) =>
    feature.routeIds.includes(queen.id) &&
    feature.accessible &&
    feature.boardingPoints > 0,
);
assert.ok(stop, 'fixture has an accessible Queen stop');
const location = mapToGps(stop.point, data.geographicTransform);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
let calls = 0;
const errors = [];
async function fixture(context) {
  await context.route('**/api/v1/map/streetcar?format=schematic-v1', (route) =>
    route.fulfill({ json: map }),
  );
  await context.route('**/api/v1/vehicles/streetcar', (route) => {
    calls++;
    const now = new Date().toISOString();
    return route.fulfill({
      headers: { 'x-live-update-seconds': '30' },
      json: {
        schemaVersion: 1,
        source: 'fixture',
        attribution: 'Fixture',
        fetchedAt: now,
        feedTimestamp: now,
        invalidPositions: 0,
        vehicles: [
          {
            id: '4400',
            label: '4400',
            ...location,
            routeId: queen.id,
            observedAt: now,
            speedMetresPerSecond: 5,
          },
          {
            id: '4401',
            label: '4401',
            ...location,
            routeId: queen.id,
            observedAt: new Date(Date.now() - 300000).toISOString(),
            speedMetresPerSecond: 20,
          },
        ],
      },
    });
  });
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
}
// The first-visit affiliation banner overlays the bottom of the map and the
// mobile panel; dismiss it so the checks can reach the tools underneath.
async function dismissNotice(page) {
  const gotIt = page.getByRole('button', { name: 'Got it', exact: true });
  if (await gotIt.count()) await gotIt.click();
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    geolocation: { ...location, accuracy: 25 },
    permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
    colorScheme: 'light',
  });
  await fixture(context);
  await context.addInitScript(() => {
    window.locationRequests = 0;
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...args) => {
      window.locationRequests++;
      return original(...args);
    };
  });
  const page = await context.newPage();
  await page.goto(`${origin}/#stop=${encodeURIComponent(stop.id)}`);
  await page.getByRole('heading', { name: stop.name, exact: true }).waitFor();
  await page.locator('.stop-cars .list-choice').waitFor();
  await dismissNotice(page);
  assert.equal(
    await page.locator('.stop-cars .list-choice').count(),
    1,
    'stale vehicles are excluded from nearby cars',
  );
  assert.equal(
    await page.evaluate(() => window.locationRequests),
    0,
    'location is never requested at startup',
  );
  await page.getByRole('button', { name: '☆ Save stop', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: '★ Saved stop', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await page.locator('.my-stops .list-choice').count(), 1);
  assert.equal(
    await page.locator('.saved-marker').count(),
    1,
    'saved stop is marked on the map',
  );
  const currentCalls = calls;
  await page.getByRole('button', { name: '↗ Share map', exact: true }).click();
  await page.getByText('Map link copied', { exact: true }).waitFor();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(new URLSearchParams(new URL(link).hash.slice(1)).get('stop'), stop.id);
  assert.equal(calls, currentCalls, 'sharing and saving reuse the existing feed');
  await page.getByRole('button', { name: 'Switch to night theme' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.getByRole('checkbox', { name: 'More stop labels' }).check();
  await page.reload();
  await page.getByRole('heading', { name: stop.name, exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.ok(await page.getByRole('checkbox', { name: 'More stop labels' }).isChecked());
  assert.equal(
    await page.locator('.my-stops .list-choice').count(),
    1,
    'saved stops survive reload',
  );
  await page.getByRole('button', { name: 'Locate me & centre map', exact: true }).click();
  await page.locator('.location-marker').waitFor();
  assert.equal(await page.evaluate(() => window.locationRequests), 1);
  assert.equal(
    await page.locator('.nearby-stops .list-choice').count(),
    nearbyStops(data, location).length,
  );
  await page.getByRole('checkbox', { name: 'Listed accessible boarding only' }).check();
  assert.equal(
    await page.locator('.nearby-stops .list-choice').count(),
    nearbyStops(data, location, true).length,
  );
  const stored = await page.evaluate(() => Object.entries(localStorage));
  assert.ok(
    !JSON.stringify(stored).includes(String(location.latitude)),
    'coordinates are not persisted',
  );
  assert.ok(
    !page.url().includes(String(location.latitude)),
    'coordinates are not shared',
  );
  await page.getByRole('button', { name: 'Clear location', exact: true }).click();
  assert.equal(await page.locator('.location-marker').count(), 0);
  await context.setGeolocation({ latitude: 45.42, longitude: -75.69, accuracy: 50 });
  await page.getByRole('button', { name: 'Locate me & centre map', exact: true }).click();
  await page
    .getByText(
      'No stops with listed accessible boarding within 2.5 km. Try searching for a stop or changing the filter.',
      { exact: true },
    )
    .waitFor();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator('.map-controls output').innerText(),
    '100%',
    'out-of-area locations keep the Toronto map in view',
  );
  await page.getByRole('button', { name: 'Clear location', exact: true }).click();
  await page.getByRole('button', { name: /501 Queen: 1 fresh, 1 stale/ }).click();
  await page.getByText('18 km/h median reported speed', { exact: true }).waitFor();
  assert.equal(await page.locator('.route-list button[aria-pressed="true"]').count(), 1);
  await page.locator('.my-stops .list-choice').click();
  await page.getByRole('heading', { name: stop.name, exact: true }).waitFor();
  assert.equal(
    await page.locator('.route-list button[aria-pressed="true"]').count(),
    1,
    'inspecting a stop preserves its highlighted route',
  );
  const highlightedLink = new URLSearchParams(new URL(page.url()).hash.slice(1));
  assert.equal(highlightedLink.get('stop'), stop.id);
  assert.equal(highlightedLink.get('route'), queen.id);
  await page.reload();
  await page.getByRole('heading', { name: stop.name, exact: true }).waitFor();
  assert.equal(
    await page.locator('.route-list button[aria-pressed="true"]').count(),
    1,
    'shared stop links restore route context',
  );
  await page.getByRole('button', { name: '✦ Surprise me', exact: true }).click();
  await page.getByRole('button', { name: '☆ Save stop', exact: true }).waitFor();
  await page.locator('.my-stops .list-choice').click();
  await page.getByRole('heading', { name: stop.name, exact: true }).waitFor();
  // A routine GPS refresh must not reset the camera of a selected stop.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForTimeout(100);
  const camera = await page.locator('#map').getAttribute('viewBox');
  await page.getByRole('checkbox', { name: 'Show live vehicles' }).uncheck();
  await page.getByRole('checkbox', { name: 'Show live vehicles' }).check();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator('#map').getAttribute('viewBox'),
    camera,
    'feed lifecycle does not recenter selected stops',
  );
  const carZoom = await page.locator('.map-controls output').innerText();
  await page.locator('.stop-cars .list-choice').click();
  await page.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(
    await page.locator('.map-controls output').innerText(),
    carZoom,
    'selecting a car keeps the current zoom level',
  );
  assert.equal(await page.locator('.selected-car-ring').count(), 1);
  await page.reload();
  await page.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(
    await page.locator('.map-controls output').innerText(),
    '100%',
    'streetcar link centers after the feed arrives without zooming',
  );
  await page.getByRole('button', { name: 'Fit map', exact: true }).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: '/tmp/ttc-hackathon-night.png' });
  await page.getByRole('button', { name: 'Switch to day theme' }).click();
  await page.screenshot({ path: '/tmp/ttc-hackathon-day.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'mobile fits the viewport',
  );
  await page.screenshot({ path: '/tmp/ttc-hackathon-mobile.png' });
  await page.goto(`${origin}/#route=missing-route`);
  await page
    .getByText(
      'That shared stop or route is no longer in this map. Choose another below.',
      { exact: true },
    )
    .waitFor();
  await page.goto(`${origin}/#car=4663`);
  await page
    .getByText('Car 4663 is not in the latest vehicle feed. It may be out of service.', {
      exact: true,
    })
    .waitFor();
  const nightRoute = data.routes.find((route) => route.overnight && route.scheduled);
  assert.ok(nightRoute);
  await page.goto(`${origin}/#route=${encodeURIComponent(nightRoute.id)}`);
  await page.locator('.route-list button[aria-pressed="true"]').waitFor();
  assert.ok(
    await page.getByRole('checkbox', { name: 'Include overnight routes' }).isChecked(),
    'night route links enable overnight layer',
  );
  await context.close();

  const restricted = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await fixture(restricted);
  await restricted.addInitScript(() => {
    Storage.prototype.getItem = () => '{corrupt';
    Storage.prototype.setItem = () => {
      throw new Error('Storage blocked');
    };
    navigator.geolocation.getCurrentPosition = (_success, fail) => fail({ code: 1 });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Clipboard blocked');
        },
      },
    });
  });
  const blocked = await restricted.newPage();
  await blocked.goto(`${origin}/#stop=${encodeURIComponent(stop.id)}`);
  await blocked.getByRole('heading', { name: stop.name, exact: true }).waitFor();
  await dismissNotice(blocked);
  await blocked.getByRole('button', { name: '☆ Save stop', exact: true }).click();
  await blocked
    .getByText('Browser storage unavailable; saved for this visit.', { exact: true })
    .waitFor();
  await blocked.getByRole('button', { name: '↗ Share map', exact: true }).click();
  assert.ok(
    (
      await blocked.getByRole('textbox', { name: 'Shareable map link' }).inputValue()
    ).includes('#stop='),
  );
  await blocked
    .getByRole('button', { name: 'Locate me & centre map', exact: true })
    .click();
  await blocked
    .getByRole('alert')
    .filter({ hasText: 'Location permission was declined' })
    .waitFor();
  await restricted.close();

  const full = await browser.newContext();
  await fixture(full);
  await full.addInitScript(() => {
    if (location.protocol === 'http:' || location.protocol === 'https:')
      localStorage.setItem(
        'ttc:stops:v1',
        JSON.stringify(Array.from({ length: 100 }, (_, index) => `retired-${index}`)),
      );
  });
  const fullPage = await full.newPage();
  await fullPage.goto(`${origin}/#stop=${encodeURIComponent(stop.id)}`);
  await fullPage.getByRole('heading', { name: stop.name, exact: true }).waitFor();
  await dismissNotice(fullPage);
  assert.ok(
    await fullPage.getByRole('button', { name: '☆ Save stop', exact: true }).isDisabled(),
    'saved-stop limit is enforced',
  );
  await fullPage.locator('.remove-stop').first().click();
  await fullPage.getByRole('button', { name: '☆ Save stop', exact: true }).click();
  assert.equal(
    await fullPage.locator('.my-stops .list-choice').count(),
    100,
    'retired bookmarks are removable and make room for a new stop',
  );
  await full.close();
  assert.deepEqual(errors, []);
  console.log(
    'Hackathon UI passed: bookmarks/limits/retired stops, geographic nearby stops, location privacy/out-of-area, nearby cars, route pulse, share/deep links, night theme, persistence, unavailable storage/clipboard/location, mobile layout; no browser errors.',
  );
} finally {
  await browser.close();
}
