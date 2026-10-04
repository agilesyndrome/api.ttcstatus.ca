import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Generate the map with map:import first; all browser feed requests use fixtures.
const map = JSON.parse(
  await readFile(process.env.MAP_INPUT || '.wrangler/preview/rail-map.json', 'utf8'),
);
const now = new Date().toISOString();
const subwayPredictions = ['1', '2', '4', '5', '6'].map((routeId, index) => {
  assert.ok(map.routes.some((r) => r.shortName === routeId));
  const pattern = map.patterns.find((p) => p.routeId === routeId && p.stopIds.length > 3);
  assert.ok(pattern, `Line ${routeId} has scheduled station patterns`);
  return {
    id: `subway:${routeId}:${15 + index}`,
    label: String(15 + index),
    routeId,
    tripId: pattern.id,
    observedAt: now,
    stops: pattern.stopIds.slice(1, 3).map((stopId, i) => ({
      stopId,
      sequence: i + 1,
      arrivalAt: new Date(Date.now() + (i + 1) * 60000).toISOString(),
    })),
  };
});
assert.ok(!map.routes.some((r) => r.shortName === '3'));
const snapshot = {
  schemaVersion: 1,
  vehicles: [
    {
      id: '4400',
      label: '4400',
      latitude: 43.6488,
      longitude: -79.396,
      observedAt: now,
      routeId: '501',
    },
  ],
  subwayPredictions,
  subwayStatus: 'available',
  source: 'fixture',
  fetchedAt: now,
  feedTimestamp: now,
  invalidPositions: 0,
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/map/streetcar*', (route) => route.fulfill({ json: map }));
  await page.route('**/api/v1/vehicles/streetcar', (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.goto(process.env.UI_URL || 'http://127.0.0.1:4173');
  await page.locator('[data-vehicle="subway:1:15"]').waitFor();
  assert.equal(await page.locator('[data-mode="subway"]').count(), 5);
  await page.getByRole('searchbox').fill('train 15');
  await page
    .locator('.search-results')
    .getByRole('button', { name: /Train 15/ })
    .click();
  await page.getByRole('heading', { name: 'Train 15', exact: true }).waitFor();
  assert.match(
    await page.locator('#details').innerText(),
    /predicted station, not a GPS position/,
  );
  assert.equal(
    await page.locator('[data-vehicle="subway:1:15"] .streetcar-body').count(),
    6,
  );
  assert.match(
    await page.locator('[data-vehicle="subway:1:15"] .vehicle-number').textContent(),
    /1 · 15/,
  );
  assert.equal(
    await page.locator('[data-vehicle="subway:1:15"] .streetcar-cab').count(),
    1,
  );
  await mkdir('dist/checks', { recursive: true });
  await page.screenshot({ path: 'dist/checks/subway-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'dist/checks/subway-mobile.png' });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await page.getByRole('searchbox').fill('4400');
  await page
    .locator('.search-results')
    .getByRole('button', { name: /Streetcar 4400/ })
    .click();
  await page.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  assert.equal(await page.locator('[data-vehicle="4400"] .streetcar-body').count(), 5);
  assert.match(
    await page.locator('[data-vehicle="4400"] .vehicle-number').textContent(),
    /501 · 4400/,
  );
  // A downstream station must show its own prediction, not the marker's next stop.
  const station = map.stops.find((stop) =>
    stop.stopIds.includes(subwayPredictions[0].stops[1].stopId),
  );
  const stationUrl = `${process.env.UI_URL || 'http://127.0.0.1:4173'}/#stop=${encodeURIComponent(station.id)}`;
  await page.goto(stationUrl);
  const board = page.getByRole('region', { name: 'Station arrivals' });
  await board.getByText('Line 1 · Train 15', { exact: true }).waitFor();
  assert.equal(
    await board.locator('time').first().getAttribute('datetime'),
    subwayPredictions[0].stops[1].arrivalAt,
  );
  assert.equal(
    await page
      .locator('#details')
      .getByText('Streetcars nearby', { exact: true })
      .count(),
    0,
  );
  await board.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'dist/checks/arrivals-mobile.png' });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await page.getByRole('checkbox', { name: 'Show live vehicles' }).uncheck();
  await board.getByText('Enable live vehicles to see arrival predictions.').waitFor();
  assert.equal(await board.locator('time').count(), 0);
  await page.getByRole('checkbox', { name: 'Show live vehicles' }).check();
  await board.getByText('Line 1 · Train 15', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await board.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'dist/checks/arrivals-desktop.png' });
  snapshot.subwayStatus = 'unavailable';
  await page.reload();
  await board
    .getByText('Subway arrival predictions are temporarily unavailable.')
    .waitFor();
  assert.equal(await board.locator('time').count(), 0);
  snapshot.subwayStatus = 'available';
  snapshot.subwayPredictions = [];
  await page.reload();
  await board.getByText(/No fresh upcoming predictions/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Subway routes, station arrivals, pause/resume, empty/unavailable feeds, train numbers, directional cabs, streetcars and phone layout passed.',
  );
} finally {
  await browser.close();
}
