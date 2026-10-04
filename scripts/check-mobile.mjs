import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

// Run against npm run dev:viewer, with deterministic TTC responses.
const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('streetcar-schematic.json', 'utf8'));
const queen = map.routes.find(route => route.shortName === '501');
const now = new Date().toISOString();
const snapshot = {
  schemaVersion: 1, source: 'mobile-test', attribution: 'Fixture', fetchedAt: now,
  feedTimestamp: now, invalidPositions: 0,
  vehicles: [{ id: '4400', label: '4400', latitude: 43.6488, longitude: -79.396,
    observedAt: now, routeId: queen.id, speedMetresPerSecond: 5 }],
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/api/v1/map/streetcar?format=schematic-v1', route => route.fulfill({ json: map }));
  await context.route('**/api/v1/vehicles/streetcar', route => route.fulfill({ json: snapshot, headers: { 'x-live-update-seconds': '30' } }));
  const page = await context.newPage();
  const toggle = page.locator('.mobile-panel-toggle');
  const content = page.locator('.sidebar-content');
  const search = page.getByRole('searchbox', { name: 'Search stops, stations, routes or streetcar numbers' });
  const assertHeadingVisible = async name => {
    const heading = page.getByRole('heading', { name, exact: true });
    await heading.waitFor();
    assert.ok(await heading.evaluate(node => {
      const box = node.getBoundingClientRect();
      const panel = document.querySelector('.sidebar-content').getBoundingClientRect();
      return box.top >= panel.top && box.bottom <= panel.bottom && box.bottom <= innerHeight;
    }), `${name} is visible immediately, without scrolling`);
  };

  for (const width of [390, 320, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(origin);
    await page.locator('[data-vehicle="4400"]').waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await content.isVisible(), false);
    assert.equal(await page.getByRole('tab', { name: 'Fleet', exact: true }).isVisible(), true);

    // Selecting a search result dismisses the keyboard and opens the details.
    await search.fill('4400');
    await page.locator('.search-results').getByRole('button', { name: /Streetcar 4400/ }).tap();
    await assertHeadingVisible('Car 4400');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await search.evaluate(node => node === document.activeElement), false);
    assert.ok(await search.evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16));
    await page.screenshot({ path: `/tmp/ttc-mobile-car-${width}.png` });

    // Reopening the same car with a real touch resets any previous panel scroll.
    await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await toggle.tap();
    await page.locator('[data-vehicle="4400"] .streetcar-body').last().tap();
    await assertHeadingVisible('Car 4400');
    assert.equal(await content.evaluate(node => node.scrollTop), 0);
    await page.getByRole('button', { name: 'Close streetcar details' }).tap();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');

    await page.getByRole('tab', { name: 'Fleet', exact: true }).tap();
    await assertHeadingVisible('Streetcar spotting');
    await page.locator('.fleet-list .list-choice').first().tap();
    await assertHeadingVisible('Car 4400');
    await page.getByRole('button', { name: 'Close streetcar details' }).tap();

    await search.fill('Queen');
    const firstStop = page.locator('.search-results button').first();
    const stopName = (await firstStop.innerText()).split('\n')[0];
    await firstStop.tap();
    await assertHeadingVisible(stopName);
    await page.getByRole('button', { name: 'Close stop details' }).tap();

    await toggle.tap();
    await page.getByRole('checkbox', { name: 'More stop labels', exact: true }).check();
    assert.equal(await page.getByRole('checkbox', { name: 'More stop labels', exact: true }).isChecked(), true);

    // Picking comparison endpoints makes room for the map, then restores tools.
    await page.getByRole('tab', { name: 'Compare', exact: true }).tap();
    await page.getByRole('button', { name: 'Pick start stop on map', exact: true }).tap();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await search.fill(stopName);
    await page.locator('.search-results button').first().tap();
    await assertHeadingVisible('Compare stops');
    assert.ok(await page.getByLabel('Start stop', { exact: true }).inputValue());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
  }

  // Shared selections open automatically, including after reload.
  await page.goto(`${origin}/#car=4400`);
  await assertHeadingVisible('Car 4400');
  await page.reload();
  await assertHeadingVisible('Car 4400');
  await page.setViewportSize({ width: 390, height: 667 });
  await assertHeadingVisible('Car 4400');
  await page.getByRole('button', { name: 'Follow this car', exact: false }).tap();
  assert.equal(await page.getByRole('button', { name: 'Following this car', exact: false }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  console.log('Mobile UI passed: touch selection/reselection, visible car/stop details, collapse/reopen, fleet and layers, search keyboard dismissal, shared links, 320/390/430px layouts; no browser errors.');
  await context.close();
} finally { await browser.close(); }
