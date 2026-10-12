import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const now = new Date().toISOString();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  const { journals } = await installAccountFixture(context, { signedIn: true });
  journals.set('user_a', {
    entries: [
      {
        vehicleId: '4400',
        label: '4400',
        routeId: '501',
        routeNumber: '501',
        routeName: 'Queen',
        status: 'seen',
        note: 'Offline fixture',
        recordedAt: now,
      },
    ],
    revision: 1,
  });
  // The production API is unchanged; this fixture exercises the existing stops contract.
  let stops = { stopIds: [], revision: 0 };
  await context.route('**/api/v1/me/stops', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: stops });
    const next = route.request().postDataJSON();
    assert.equal(next.revision, stops.revision);
    stops = { stopIds: next.stopIds, revision: stops.revision + 1 };
    return route.fulfill({ json: { revision: stops.revision } });
  });
  let mapCalls = 0;
  let conditional = false;
  await context.route('**/api/v1/map/ttcstatus', (route) => {
    mapCalls++;
    conditional ||= route.request().headers()['if-none-match'] === '"map-fixture"';
    return route.fulfill({
      status: conditional ? 304 : 200,
      ...(conditional ? {} : { json: map }),
      headers: { etag: '"map-fixture"' },
    });
  });
  let feedCalls = 0;
  await context.route('**/api/v1/vehicles/streetcar', (route) => {
    feedCalls++;
    return route.fulfill({
      json: {
        schemaVersion: 1,
        source: 'readiness',
        attribution: 'Fixture',
        fetchedAt: now,
        feedTimestamp: now,
        invalidPositions: 0,
        vehicles: [],
      },
      headers: { 'x-live-update-seconds': '30' },
    });
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('#map').waitFor();
  await page.getByRole('tab', { name: 'Journal', exact: true }).click();
  await page.getByText('Offline fixture', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Explore', exact: true }).click();
  const search = page.getByRole('searchbox');
  await search.fill('Queen');
  await page.locator('.search-results button').first().click();
  await page.locator('#map').evaluate((node) => {
    node.dataset.retained = 'true';
  });
  await page.getByRole('link', { name: 'Language settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser profile', exact: true }).waitFor();
  const pausedCalls = feedCalls;
  await page.waitForTimeout(300);
  assert.equal(
    feedCalls,
    pausedCalls,
    'retained map acquisition pauses on another screen',
  );
  await page.getByRole('link', { name: 'Explore', exact: true }).click();
  await page.locator('#map:visible').waitFor();
  assert.equal(
    await page.locator('#map').getAttribute('data-retained'),
    'true',
    'navigation retains the same map DOM',
  );
  await page.waitForFunction(
    () => document.querySelector('#map')?.dataset.retained === 'true',
  );
  await page.waitForTimeout(250);
  assert.ok(conditional, 'resuming revalidates with the saved map ETag');
  assert.ok(mapCalls >= 2);

  // A disconnected active session can read cached account data, but cannot queue writes.
  await context.setOffline(true);
  await page.getByRole('tab', { name: 'Journal', exact: true }).click();
  await page.getByText('Offline fixture', { exact: true }).waitFor();
  await page
    .getByRole('tabpanel', { name: 'Streetcar journal' })
    .getByText(/Offline — showing your last saved account data/)
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Add car to journal', exact: true })
      .isEnabled(),
    false,
  );
  await context.setOffline(false);
  await page
    .getByText('Your journal is saved to your account.', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForFunction(async () => {
    const keys = await new Promise((resolve) => {
      const request = indexedDB.open('ttc-ui-cache', 1);
      request.onsuccess = () => {
        const db = request.result;
        const scan = db.transaction('snapshots').objectStore('snapshots').getAllKeys();
        scan.onsuccess = () => {
          resolve(scan.result);
          db.close();
        };
      };
    });
    return !keys.some((key) => String(key).includes('account:user_a'));
  });
  // A failed legacy import must preserve guest bookmarks without a render-driven retry loop.
  await page.evaluate(() =>
    localStorage.setItem('ttc:stops:v1', JSON.stringify(['stop:1436'])),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().waitFor();
  let migrationAttempts = 0;
  await context.route('**/api/v1/me/stops', (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    migrationAttempts++;
    return route.fulfill({ status: 500, json: { error: 'fixture-unavailable' } });
  });
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await page.waitForFunction(() =>
    document.querySelector('[role="tab"]')?.textContent.includes('Explore'),
  );
  await page.waitForTimeout(500);
  assert.equal(migrationAttempts, 1, 'failed migration only tries once per sign-in');
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem('ttc:stops:v1'))),
    ['stop:1436'],
  );
  assert.deepEqual(errors, []);
  console.log(
    'App readiness passed: retained navigation, map revalidation, paused feeds, offline account reads, disabled offline writes, reconnect and private-cache removal.',
  );
  await context.close();
} finally {
  await browser.close();
}
