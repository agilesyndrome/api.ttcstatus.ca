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
  let liveCalls = 0;
  const blockLive = (route) => {
    liveCalls++;
    return route.abort('failed');
  };
  await context.route('**/live/t/*/vehicles.json', blockLive);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  const liveMode = page.getByRole('group', { name: 'Live map mode' });
  await page.waitForFunction(() =>
    document.querySelector(
      '.explore-layers [title="Live vehicle status currently unavailable"]',
    ),
  );
  assert.equal(
    await liveMode.locator('..').getAttribute('title'),
    'Live vehicle status currently unavailable',
  );
  await liveMode.getByRole('button', { name: 'Off', exact: true }).click();
  const callsBeforeReload = liveCalls;
  await page.reload();
  await liveMode.getByRole('button', { name: 'Off', exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(
    liveCalls,
    callsBeforeReload,
    'Off does not fetch the live host on reload',
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
  await liveMode.getByRole('button', { name: 'Vehicles Only' }).click();
  await successfulFeed;
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '.explore-layers [title="Live vehicle status currently unavailable"]',
      ),
  );
  assert.equal(await liveMode.locator('..').getAttribute('title'), null);
  assert.deepEqual(errors, []);
  console.log(
    'Live mode passed: failure is labelled, Off prevents live requests, and Vehicles Only resumes.',
  );
} finally {
  await browser.close();
}
