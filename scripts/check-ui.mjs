import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Run against npm run dev:viewer. TTC responses are intercepted with local data.
const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('streetcar-schematic.json', 'utf8'));
const route = map.routes.find(route => route.shortName === '501');
const now = new Date().toISOString();
const snapshot = { schemaVersion: 1, source: 'browser-test', attribution: 'Fixture', fetchedAt: now, feedTimestamp: now, invalidPositions: 0,
  vehicles: [{ id: '4400', label: '4400', latitude: 43.6488, longitude: -79.396, observedAt: now, routeId: route.id }] };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let mapCalls = 0, feedCalls = 0, conditional = false;
  await page.route('**/api/v1/map/streetcar', request => { mapCalls++; return request.fulfill({ json: map }); });
  await page.route('**/api/v1/vehicles/streetcar', async request => {
    feedCalls++;
    const headers = { etag: '"fixture"', 'x-live-update-seconds': '30', 'x-live-next-update-at': new Date(Date.now() + 1100).toISOString() };
    if (feedCalls === 2) { conditional = request.request().headers()['if-none-match'] === '"fixture"'; await request.fulfill({ status: 304, headers }); }
    else await request.fulfill({ json: snapshot, headers });
  });
  await page.goto(origin);
  await page.locator('[data-vehicle="4400"]').waitFor();
  assert.equal(mapCalls, 1);
  await page.waitForFunction(() => document.querySelector('.live-status')?.textContent.includes('1 car reported'));
  await page.waitForTimeout(1400);
  assert.ok(conditional, 'second feed request uses ETag');
  assert.equal(await page.locator('[data-vehicle]').count(), 1, '304 keeps the fleet');
  const before = await page.locator('#map').getAttribute('viewBox');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForTimeout(100);
  assert.notEqual(await page.locator('#map').getAttribute('viewBox'), before);
  await page.getByRole('button', { name: 'Fit map', exact: true }).click();
  const search = page.getByRole('searchbox');
  await search.fill('Queen');
  const first = page.locator('.search-results button').first();
  const name = (await first.innerText()).split('\n')[0];
  await first.click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close stop details' }).click();
  await page.getByRole('checkbox', { name: 'Show live streetcars' }).uncheck();
  const paused = feedCalls;
  await page.waitForTimeout(1500);
  assert.equal(feedCalls, paused, 'disabled live layer stops requests');
  assert.equal(await page.locator('[data-vehicle]').count(), 0);
  await page.getByRole('checkbox', { name: 'Show live streetcars' }).check();
  await page.locator('[data-vehicle="4400"]').waitFor();
  assert.equal(mapCalls, 1, 'filters and selection never reload geometry');
  await page.getByRole('button', { name: 'Fit map', exact: true }).click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: '/tmp/ttc-react-homepage.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert.ok(await page.locator('#map').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout fits viewport');
  assert.deepEqual(errors, []);
  console.log('UI passed: homepage, live feed/304, zoom, search, pause/resume, mobile layout; no browser errors.');
  await page.close();
} finally { await browser.close(); }
