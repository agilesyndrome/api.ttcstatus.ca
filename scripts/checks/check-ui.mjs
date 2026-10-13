import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

// Run against npm run dev:viewer. TTC responses are intercepted with local data.
const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const route = map.routes.find((route) => route.shortName === '501');
const now = new Date().toISOString();
const snapshot = {
  schemaVersion: 1,
  source: 'browser-test',
  attribution: 'Fixture',
  fetchedAt: now,
  feedTimestamp: now,
  invalidPositions: 0,
  vehicles: [
    {
      id: '4400',
      label: '4400',
      latitude: 43.6488,
      longitude: -79.396,
      observedAt: now,
      routeId: route.id,
    },
  ],
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await installAccountFixture(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The explorer no longer ships a zoom/fit overlay: the camera answers the
  // same wheel and keyboard gestures the map itself handles.
  const zoom = async (steps = 1) => {
    await page.locator('#map').hover();
    await page.mouse.wheel(0, -240 * steps);
    await page.waitForTimeout(150);
  };
  const fit = async () => {
    await page.locator('#map').focus();
    await page.keyboard.press('Home');
    await page.waitForTimeout(150);
  };
  const viewWidth = async () =>
    Number((await page.locator('#map').getAttribute('viewBox')).split(' ')[2]);
  let mapCalls = 0,
    feedCalls = 0,
    conditional = false;
  await page.route('**/api/v1/map/ttcstatus*', (request) => {
    mapCalls++;
    return request.fulfill({ json: map });
  });
  // The live path (optimize-transport.md Epic 2): config-driven tick URLs,
  // no x-live-* headers — cadence comes from /api/v1/auth/config (served by
  // the preview stack). The second poll (30 s cadence) revalidates its ETag.
  await page.route('**/live/t/*/vehicles.json', async (request) => {
    feedCalls++;
    const headers = { etag: '"fixture"' };
    if (feedCalls === 2) {
      conditional = request.request().headers()['if-none-match'] === '"fixture"';
      await request.fulfill({ status: 304, headers });
    } else await request.fulfill({ json: snapshot, headers });
  });
  await page.goto(origin);
  await page.locator('[data-vehicle="4400"]').waitFor();
  const loadedMapCalls = mapCalls;
  assert.ok(loadedMapCalls >= 1);
  const railLayers = page.getByRole('group', { name: 'Rail layers' });
  await railLayers.getByRole('button', { name: 'Subway', exact: true }).click();
  assert.equal(await page.locator('[data-vehicle="4400"]').count(), 0);
  await railLayers.getByRole('button', { name: 'Streetcar', exact: true }).click();
  await page.locator('[data-vehicle="4400"]').waitFor();
  await railLayers.getByRole('button', { name: 'Both', exact: true }).click();
  assert.equal(
    await railLayers
      .getByRole('button', { name: 'Both', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  // Data views occupy the main pane; the navigation rail stays stable.
  await page.getByRole('tab', { name: 'Route pulse' }).click();
  assert.equal(await page.locator('.workspace-map').isVisible(), false);
  assert.equal(await page.locator('.app-nav .route-pulse').count(), 0);
  await page.waitForFunction(() =>
    document
      .querySelector('.route-pulse .pulse-total')
      ?.textContent.includes('1 total on routes'),
  );
  await page.getByRole('tab', { name: 'Explore' }).click();
  assert.ok(await page.locator('.workspace-map').isVisible());
  await page.waitForTimeout(31_000);
  assert.ok(conditional, 'second feed request uses ETag');
  assert.equal(await page.locator('[data-vehicle]').count(), 1, '304 keeps the fleet');
  const before = await page.locator('#map').getAttribute('viewBox');
  await zoom(2);
  assert.notEqual(await page.locator('#map').getAttribute('viewBox'), before);
  await fit();
  const search = page.getByRole('searchbox', {
    name: 'Search stops, stations, routes or vehicle numbers',
    exact: true,
  });
  await search.fill('Queen');
  const first = page.locator('.search-results button').first();
  const name = (await first.innerText()).split('\n')[0];
  await first.click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close stop details' }).click();
  const liveMode = page.getByRole('group', { name: 'Live map mode' });
  await liveMode.getByRole('button', { name: 'Service Overlay' }).click();
  await page.locator('[data-vehicle="4400"]').waitFor();
  await liveMode.getByRole('button', { name: 'Vehicles Only' }).click();
  await liveMode.getByRole('button', { name: 'Off', exact: true }).click();
  const paused = feedCalls;
  await page.waitForTimeout(1500);
  assert.equal(feedCalls, paused, 'disabled live layer stops requests');
  assert.equal(await page.locator('[data-vehicle]').count(), 0);
  await liveMode.getByRole('button', { name: 'Vehicles Only' }).click();
  await page.locator('[data-vehicle="4400"]').waitFor();
  await page.getByRole('tab', { name: 'Route pulse' }).click();
  const kingRoute = page.locator(
    '#panel-route-pulse button.pulse-row[aria-label^="504 King"]',
  );
  await kingRoute.click();
  await page.getByRole('tab', { name: 'Explore' }).waitFor();
  // Let the camera glide to the route before sampling the zoom level.
  await page.waitForTimeout(500);
  const zoomBeforeSearch = await viewWidth();
  await search.fill('4400');
  await page
    .locator('.search-results')
    .getByRole('button', { name: /Streetcar 4400/ })
    .click();
  await page.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(
    await viewWidth(),
    zoomBeforeSearch,
    'streetcar search centers without changing the zoom level',
  );
  assert.equal(await page.locator('#panel-route-pulse').count(), 0);
  const [x, y, width, height] = (await page.locator('#map').getAttribute('viewBox'))
    .split(' ')
    .map(Number);
  const headTransform = await page
    .locator('[data-vehicle="4400"] > g')
    .last()
    .getAttribute('transform');
  const [, carX, carY] = headTransform.match(/translate\(([-\d.]+) ([-\d.]+)\)/);
  assert.ok(
    Math.abs(x + width / 2 - Number(carX)) < 0.1 &&
      Math.abs(y + height / 2 - Number(carY)) < 0.1,
    'searched streetcar is centered in the map',
  );
  // The latest loaded fleet remains searchable with the live layer off.
  await liveMode.getByRole('button', { name: 'Off', exact: true }).click();
  await fit();
  const fittedWidth = await viewWidth();
  await search.fill('#4400');
  await search.press('Enter');
  assert.equal(
    await liveMode
      .getByRole('button', { name: 'Vehicles Only' })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.locator('[data-vehicle="4400"]').waitFor();
  await page.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  await page.waitForTimeout(100);
  assert.equal(
    await viewWidth(),
    fittedWidth,
    'reselecting the same streetcar centers it without zooming',
  );
  assert.equal(mapCalls, loadedMapCalls, 'filters and selection never reload geometry');
  await page.evaluate(() => {
    window.__navigationMarker = 'kept';
  });
  await page.getByRole('link', { name: 'Status', exact: true }).click();
  await page.waitForURL('**/sla');
  assert.equal(await page.evaluate(() => window.__navigationMarker), 'kept');
  await page.getByRole('link', { name: 'Explore', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await fit();
  await page.waitForTimeout(100);
  await page.screenshot({ path: '/tmp/ttc-react-homepage.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert.ok(await page.locator('#map').isVisible());
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'mobile layout fits viewport',
  );
  assert.deepEqual(errors, []);
  console.log(
    'UI passed: homepage, live feed/304, zoom, stop/streetcar search, pause/resume, mobile layout; no browser errors.',
  );
  await page.close();
  await context.close();
} finally {
  await browser.close();
}
