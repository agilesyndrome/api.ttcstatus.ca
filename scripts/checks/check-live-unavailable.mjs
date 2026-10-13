import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await installAccountFixture(context);
  await context.route('**/api/v1/map/ttcstatus*', (route) =>
    route.fulfill({ json: map }),
  );
  const blockLive = (route) => route.abort('failed');
  await context.route('**/live/t/*/vehicles.json', blockLive);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  const liveToggle = page.getByRole('button', { name: /Show live vehicles/ });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.explore-layers button')].some(
      (button) => button.textContent.includes('Show live vehicles') && button.disabled,
    ),
  );
  assert.equal(await liveToggle.isDisabled(), true);
  assert.equal(
    await liveToggle.locator('..').getAttribute('title'),
    'Live vehicle status currently unavailable',
  );
  assert.equal(
    await liveToggle.getAttribute('aria-description'),
    'Live vehicle status currently unavailable',
  );

  await context.unroute('**/live/t/*/vehicles.json', blockLive);
  await context.route('**/live/t/*/vehicles.json', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        fetchedAt: new Date().toISOString(),
        feedTimestamp: new Date().toISOString(),
        source: 'browser-test',
        attribution: 'Fixture',
        invalidPositions: 0,
        vehicles: [],
      },
    }),
  );
  const successfulFeed = page.waitForResponse(
    (response) => response.url().includes('/live/t/') && response.ok(),
  );
  await page.reload();
  await successfulFeed;
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.explore-layers button')].some(
      (button) => button.textContent.includes('Show live vehicles') && !button.disabled,
    ),
  );
  assert.equal(await liveToggle.locator('..').getAttribute('title'), null);
  assert.deepEqual(errors, []);
  console.log(
    'Live vehicle toggle passed: failed fetch disables the button and shows its hover text.',
  );
} finally {
  await browser.close();
}
