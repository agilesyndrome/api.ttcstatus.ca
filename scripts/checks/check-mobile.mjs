import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

// Run against npm run dev:viewer, with deterministic TTC responses.
const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const queen = map.routes.find((route) => route.shortName === '501');
const now = new Date().toISOString();
const snapshot = {
  schemaVersion: 1,
  source: 'mobile-test',
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
      routeId: queen.id,
      speedMetresPerSecond: 5,
    },
  ],
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const errors = [];
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  await context.route('**/api/v1/map/ttcstatus', (route) => route.fulfill({ json: map }));
  await context.route('**/api/v1/vehicles/streetcar', (route) =>
    route.fulfill({ json: snapshot, headers: { 'x-live-update-seconds': '30' } }),
  );
  const page = await context.newPage();
  const content = page.locator('.sidebar-content');
  const search = page.getByRole('searchbox', {
    name: 'Search stops, stations, routes or vehicle numbers',
  });
  const assertHeadingVisible = async (name) => {
    const heading = page.getByRole('heading', { name, exact: true });
    await heading.waitFor();
    assert.ok(
      await heading.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const panel = document.querySelector('.sidebar-content').getBoundingClientRect();
        return (
          box.top >= panel.top && box.bottom <= panel.bottom && box.bottom <= innerHeight
        );
      }),
      `${name} is visible immediately, without scrolling`,
    );
  };
  // The first-visit affiliation banner overlays the bottom of the map and the
  // collapsed panel toggle; dismiss it so the checks can reach under it.
  const dismissNotice = async () => {
    const gotIt = page.getByRole('button', { name: 'Got it', exact: true });
    if (await gotIt.count()) await gotIt.tap();
  };
  // The brand symbol is the mobile menu button: the nav panel opens as a
  // full overlay over the map, never as a bottom sheet with a handle.
  const menu = () => page.getByRole('button', { name: 'Open menu', exact: true });
  const menuOpen = () => page.getByRole('button', { name: 'Close menu', exact: true });

  for (const width of [390, 320, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(origin);
    await page.locator('[data-vehicle="4400"]').waitFor();
    await dismissNotice();
    assert.equal(await menu().getAttribute('aria-expanded'), 'false');
    assert.equal(await content.isVisible(), false);
    // The header is one compact row: menu button, title, search.
    const header = await page.locator('.topbar').boundingBox();
    assert.ok(header && header.height <= 72, `header fits one row at ${width}`);
    assert.ok(
      await search.isVisible(),
      'search stays visible beside the title while the menu is closed',
    );

    // Selecting a search result dismisses the keyboard and opens the nav with
    // the car's details over the map.
    await search.fill('4400');
    await page
      .locator('.search-results')
      .getByRole('button', { name: /Streetcar 4400/ })
      .tap();
    await assertHeadingVisible('Car 4400');
    assert.equal(await menuOpen().getAttribute('aria-expanded'), 'true');
    assert.equal(await search.evaluate((node) => node === document.activeElement), false);
    assert.ok(
      await search.evaluate((node) => parseFloat(getComputedStyle(node).fontSize) >= 16),
    );
    await page.screenshot({ path: `/tmp/ttc-mobile-car-${width}.png` });

    // Reopening the same car with a real touch resets any previous panel scroll.
    await content.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await menuOpen().tap();
    await page.locator('[data-vehicle="4400"] .streetcar-body').last().tap();
    await assertHeadingVisible('Car 4400');
    assert.equal(await content.evaluate((node) => node.scrollTop), 0);
    await page.getByRole('button', { name: 'Close streetcar details' }).tap();
    // Closing the details closes the nav with them: the menu button reverts.
    assert.equal(await menu().getAttribute('aria-expanded'), 'false');

    await search.fill('Queen');
    const firstStop = page.locator('.search-results button').first();
    const stopName = (await firstStop.innerText()).split('\n')[0];
    await firstStop.tap();
    await assertHeadingVisible(stopName);
    await page.getByRole('button', { name: 'Close stop details' }).tap();

    // The menu opens on demand and carries the layer toggles with it.
    await menu().tap();
    await page.getByRole('checkbox', { name: 'Include overnight routes' }).check();
    assert.equal(
      await page.getByRole('checkbox', { name: 'Include overnight routes' }).isChecked(),
      true,
    );

    // Closing the menu hands the full screen back to the map, without overflow.
    await menuOpen().tap();
    assert.equal(await menu().getAttribute('aria-expanded'), 'false');
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    );
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight),
    );
  }

  // Shared selections open automatically, including after reload.
  await page.goto(`${origin}/#car=4400`);
  await assertHeadingVisible('Car 4400');
  await page.reload();
  await assertHeadingVisible('Car 4400');
  await page.setViewportSize({ width: 390, height: 667 });
  await assertHeadingVisible('Car 4400');
  await page.getByRole('button', { name: '4400 Unfollow', exact: true }).tap();
  assert.equal(
    await page.getByRole('button', { name: '4400 Unfollow', exact: true }).count(),
    0,
    'unfollowing removes the control until a car is selected again',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Mobile UI passed: menu overlay open/close, touch selection/reselection, visible car/stop details, layer toggles in the menu, search keyboard dismissal, shared links, 320/390/430px layouts; no browser errors.',
  );
  await context.close();
} finally {
  await browser.close();
}
