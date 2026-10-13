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
const stop = data.features.find(
  (feature) => feature.name === 'King St West at Bathurst St',
);
assert.ok(stop, 'fixture contains the King and Bathurst stop');
const gps = mapToGps(stop.point, data.geographicTransform);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await installAccountFixture(context);
  await context.route('**/api/v1/map/ttcstatus*', (route) =>
    route.fulfill({ json: map }),
  );
  await context.grantPermissions(['geolocation'], { origin: new URL(origin).origin });
  await context.setGeolocation({ ...gps, accuracy: 25 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator('#map').waitFor();
  const notice = page.getByRole('button', { name: 'Got it', exact: true });
  if (await notice.count()) await notice.click();
  const cameraWidth = async () =>
    Number((await page.locator('#map').getAttribute('viewBox')).split(' ')[2]);
  const overviewWidth = await cameraWidth();

  await page.getByRole('button', { name: 'Locate me & centre map', exact: true }).click();
  await page.locator('.location-marker').waitFor();
  await page.waitForFunction(
    (threshold) =>
      Number(document.querySelector('#map')?.getAttribute('viewBox')?.split(' ')[2]) <
      threshold,
    overviewWidth / 5,
  );
  await page.waitForTimeout(200);
  const locatedWidth = await cameraWidth();
  assert.ok(
    locatedWidth < overviewWidth / 5,
    `location frames nearby stops closely (${locatedWidth} versus ${overviewWidth / 5})`,
  );

  await page.locator(`[data-feature="${stop.id}"]`).focus();
  await page.keyboard.press('Enter');
  await page.locator('#details h1').filter({ hasText: stop.name }).waitFor();
  await page.waitForTimeout(450);
  assert.ok(
    (await cameraWidth()) <= locatedWidth * 1.001,
    'selecting a nearby stop after locating does not zoom out',
  );
  assert.deepEqual(errors, [], 'the map has no browser errors');
  console.log(
    'Map camera passed: selecting a stop after Find me preserves the close zoom.',
  );
} finally {
  await browser.close();
}
