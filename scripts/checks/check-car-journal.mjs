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
async function setup(context, options) {
  const fixture = await installAccountFixture(context, options);
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
  return fixture;
}

async function selectCar(page) {
  await page.goto(origin);
  await page.locator('[data-vehicle="4400"]').waitFor();
  const notice = page.getByRole('button', { name: 'Got it', exact: true });
  if (await notice.count()) await notice.click();
  await page.locator('[data-vehicle="4400"] .streetcar-body').last().click();
  await page.locator('#details h1').filter({ hasText: 'Car 4400' }).waitFor();
  const journalAction = page.locator('#details .vehicle-journal-action');
  assert.equal(await journalAction.innerText(), '+ Add to Journal');
  return journalAction;
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const { journals } = await setup(context, { signedIn: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const journalAction = await selectCar(page);
  await page.screenshot({ path: '/tmp/ttc-car-journal-action.png' });
  await journalAction.click();
  const number = page.getByLabel('Streetcar number', { exact: true });
  await number.waitFor();
  assert.equal(await number.inputValue(), '4400');
  assert.equal(
    await page.locator('.journal-entry').count(),
    0,
    'opening the form does not save',
  );
  await page.getByLabel('Private note (optional)').fill('Spotted on Queen');
  await page.getByRole('button', { name: 'Add car to journal', exact: true }).click();
  const entry = page.getByRole('article', { name: 'Collected car 4400', exact: true });
  await entry.waitFor();
  assert.equal(await entry.evaluate((node) => node === document.activeElement), true);
  assert.equal(journals.get('user_a').entries[0].status, 'seen');
  assert.equal(journals.get('user_a').entries[0].note, 'Spotted on Queen');

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

  for (const signInRedirect of [false, true]) {
    const guestContext = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    });
    const { journals: guestJournals } = await setup(guestContext, {
      signedIn: false,
      signInRedirect,
    });
    const guestPage = await guestContext.newPage();
    const guestErrors = [];
    guestPage.on('pageerror', (error) => guestErrors.push(error.message));
    const add = await selectCar(guestPage);
    await add.click();
    const number = guestPage.getByLabel('Streetcar number', { exact: true });
    await number.waitFor();
    assert.equal(await number.inputValue(), '4400');
    assert.equal(
      await guestPage
        .getByRole('tab', { name: 'Journal', exact: true })
        .getAttribute('aria-selected'),
      'true',
    );
    assert.equal(guestJournals.get('user_a')?.entries.length ?? 0, 0);
    assert.deepEqual(guestErrors, []);
    await guestContext.close();
  }
  console.log(
    'Car journal passed: add form, Seen/Ridden links, and sign-in return with or without redirect.',
  );
} finally {
  await browser.close();
}
