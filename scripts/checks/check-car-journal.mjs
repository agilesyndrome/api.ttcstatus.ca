import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

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
const route = data.routes.find((item) => item.number === '501');
const stop = data.features.find(
  (item) => item.boardingPoints && item.routeIds.includes(route.id),
);
const gps = mapToGps(stop.point, data.geographicTransform);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const { journals } = await installAccountFixture(context, { signedIn: true });
  await context.route('**/api/v1/map/ttcstatus*', (request) =>
    request.fulfill({ json: map }),
  );
  await context.route('**/live/t/*/vehicles.json', (request) =>
    request.fulfill({
      json: {
        schemaVersion: 1,
        source: 'car-journal-fixture',
        attribution: 'Fixture',
        fetchedAt: new Date().toISOString(),
        feedTimestamp: new Date().toISOString(),
        invalidPositions: 0,
        vehicles: [
          {
            id: '4400',
            label: '4400',
            ...gps,
            routeId: route.id,
            observedAt: new Date().toISOString(),
          },
        ],
      },
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator('[data-vehicle="4400"]').waitFor();
  const notice = page.getByRole('button', { name: 'Got it', exact: true });
  if (await notice.count()) await notice.click();
  await page.locator('[data-vehicle="4400"] .streetcar-body').last().click();
  await page.locator('#details h1').filter({ hasText: 'Car 4400' }).waitFor();
  const journalAction = page.locator('#details .vehicle-journal-action');
  assert.equal(await journalAction.innerText(), '+ Add to Journal');
  await page.screenshot({ path: '/tmp/ttc-car-journal-action.png' });
  await journalAction.click();
  const entry = page.getByRole('article', { name: 'Collected car 4400', exact: true });
  await entry.waitFor();
  assert.equal(await entry.evaluate((node) => node === document.activeElement), true);
  assert.equal(journals.get('user_a').entries[0].status, 'seen');

  await page.getByRole('tab', { name: 'Explore', exact: true }).click();
  assert.match(await journalAction.innerText(), /^✓ Seen on /);
  assert.ok(
    (await journalAction.innerText()).includes(
      new Date(journals.get('user_a').entries[0].recordedAt).toLocaleDateString('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    ),
  );
  await journalAction.click();
  await entry.waitFor();
  assert.equal(await entry.evaluate((node) => node === document.activeElement), true);
  await entry.getByRole('button', { name: 'Mark ridden' }).click();
  await page.waitForFunction(() =>
    document.querySelector('.journal-entry .microcopy')?.textContent?.includes('Ridden'),
  );
  await page.getByRole('tab', { name: 'Explore', exact: true }).click();
  assert.match(await journalAction.innerText(), /^✓ Ridden on /);
  await journalAction.click();
  await entry.waitFor();
  assert.equal(await entry.evaluate((node) => node === document.activeElement), true);
  assert.deepEqual(errors, []);
  console.log('Car journal passed: add, Seen and Ridden actions open the saved entry.');
} finally {
  await browser.close();
}
