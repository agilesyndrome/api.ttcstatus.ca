import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('streetcar-schematic.json', 'utf8'));
const compiled = await build({ stdin: { contents: `export { buildViewerData } from './web/map/model'; export { mapToGps } from './workers/shared/map-projection'; export { compareStops } from './web/ui/comparison';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm' });
const { buildViewerData, mapToGps, compareStops } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const data = buildViewerData(map);
const queen = data.routes.find(route => route.number === '501');
const king = data.routes.find(route => route.number === '504');
const pattern = data.patterns.find(pattern => pattern.routeId === queen.id && pattern.stopIds.length > 10);
const featureFor = id => data.features.find(feature => feature.boardingPoints > 0 && feature.stopIds.includes(id));
const from = pattern.stopIds.map(featureFor).find(Boolean);
const to = pattern.stopIds.slice(8).map(featureFor).find(feature => feature && feature.id !== from.id);
assert.ok(from && to && compareStops(data, from, to).connections.some(connection => connection.route.id === queen.id));
const gps = mapToGps(from.point, data.geographicTransform);
const errors = [];
let feedCalls = 0, mapCalls = 0;
let reportTime = Date.now();
let latitude = gps.latitude;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'light' });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/api/v1/map/streetcar?format=schematic-v1', route => { mapCalls++; return route.fulfill({ json: map }); });
  await context.route('**/api/v1/vehicles/streetcar', route => {
    feedCalls++;
    return route.fulfill({ headers: { 'x-live-update-seconds': '30' }, json: {
      schemaVersion: 1, source: 'exploration-fixture', attribution: 'Fixture', fetchedAt: new Date(reportTime).toISOString(), feedTimestamp: new Date(reportTime).toISOString(), invalidPositions: 0,
      vehicles: Array.from({ length: 26 }, (_, index) => ({
        id: String(4400 + index), label: index === 7 ? '=1+1' : String(4400 + index),
        latitude: index === 2 ? 43.75 : index === 0 ? latitude : gps.latitude,
        longitude: index === 2 ? -79.55 : gps.longitude,
        routeId: index === 2 ? undefined : index === 3 ? king.id : queen.id,
        speedMetresPerSecond: index === 1 ? 50 : index === 25 ? 20 : index === 0 ? 10 : index === 3 ? 0 : undefined,
        observedAt: new Date(reportTime - (index === 1 ? 600000 : 0)).toISOString(),
      })),
    } });
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('[data-vehicle="4400"]').waitFor();
  const startCalls = feedCalls;
  await page.getByRole('tab', { name: 'Fleet', exact: true }).click();
  await page.getByRole('heading', { name: 'Streetcar spotting', exact: true }).waitFor();
  assert.equal(await page.locator('.fleet-list .list-choice').count(), 20);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  assert.equal(await page.locator('.fleet-list .list-choice').count(), 6);
  await page.getByLabel('Position status', { exact: true }).selectOption('stale');
  assert.equal(await page.locator('.fleet-list .list-choice').count(), 1);
  assert.ok((await page.locator('.fleet-list').innerText()).includes('4401'));
  await page.getByLabel('Position status', { exact: true }).selectOption('off-track');
  assert.equal(await page.locator('.fleet-list .list-choice').count(), 1);
  await page.getByLabel('Route assignment', { exact: true }).selectOption('unassigned');
  assert.ok((await page.locator('.fleet-list').innerText()).includes('4402'));
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.getByLabel('Sort cars', { exact: true }).selectOption('speed');
  assert.ok((await page.locator('.fleet-list .list-choice').first().innerText()).includes('4425'), 'fresh speed wins over a stale high speed');
  await page.getByRole('searchbox', { name: 'Find in fleet', exact: true }).fill('#4400');
  assert.equal(await page.locator('.fleet-list .list-choice').count(), 1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download filtered snapshot (.csv)', exact: false }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'toronto-streetcar-snapshot.csv');
  const csv = await readFile(await download.path(), 'utf8');
  assert.equal(csv.split('\r\n').length, 3);
  assert.ok(csv.includes('"4400"') && csv.includes('"fresh"'));
  assert.ok(csv.includes('"exploration-fixture","Fixture"'), 'export preserves source attribution');
  assert.ok(csv.includes(`"${gps.longitude}"`), 'negative numeric longitude is exported intact');
  await page.getByRole('searchbox', { name: 'Find in fleet', exact: true }).fill('4407');
  const unsafeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download filtered snapshot (.csv)', exact: false }).click();
  assert.ok((await readFile(await (await unsafeDownload).path(), 'utf8')).includes('"\'=1+1"'), 'CSV neutralizes an external label formula');
  await page.getByRole('searchbox', { name: 'Find in fleet', exact: true }).fill('nonexistent');
  assert.ok(await page.getByRole('button', { name: 'Download filtered snapshot (.csv)', exact: false }).isDisabled());
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  assert.equal(feedCalls, startCalls, 'fleet filtering, paging and downloads reuse the shared snapshot');
  assert.ok(await page.getByLabel('Sort cars', { exact: true }).locator('option[value="distance"]').isDisabled());
  await context.grantPermissions(['geolocation'], { origin: new URL(origin).origin });
  await context.setGeolocation({ ...gps, accuracy: 25 });
  await page.getByRole('tab', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Find nearby stops', exact: true }).click();
  await page.locator('.location-marker').waitFor();
  await page.getByRole('tab', { name: 'Fleet', exact: true }).click();
  await page.getByLabel('Sort cars', { exact: true }).selectOption('distance');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  assert.ok((await page.locator('.fleet-list .list-choice').last().innerText()).includes('4402'), 'GPS sorting places the remote car last');
  await page.getByRole('tab', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Clear location', exact: true }).click();
  await page.getByRole('tab', { name: 'Fleet', exact: true }).click();
  assert.equal(await page.getByLabel('Sort cars', { exact: true }).inputValue(), 'number', 'clearing location displays the fallback sort');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find in fleet', exact: true }).fill('4400');
  await page.locator('.fleet-list .list-choice').click();
  await page.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Explore', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Follow this car', exact: false }).click();
  assert.equal(await page.getByRole('button', { name: 'Following this car', exact: false }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Follow this car', exact: false }).getAttribute('aria-pressed'), 'false', 'manual zoom pauses following');

  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByLabel('Start stop', { exact: true }).selectOption(from.id);
  await page.getByLabel('Destination stop', { exact: true }).selectOption(to.id);
  await page.getByRole('button', { name: 'Highlight 501 Queen', exact: true }).waitFor();
  assert.equal(await page.locator('.comparison-marker').count(), 2);
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('from'), from.id);
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('to'), to.id);
  const overnightConnection = compareStops(data, from, to, true).connections.find(connection => connection.route.overnight);
  assert.ok(overnightConnection, 'fixture includes a connecting overnight pattern');
  await page.getByRole('checkbox', { name: 'Include overnight connections', exact: true }).check();
  await page.getByRole('button', { name: `Highlight ${overnightConnection.route.number} ${overnightConnection.route.name}`, exact: true }).click();
  assert.equal(await page.locator('.route-list button[aria-pressed="true"]').count(), 1);
  await page.getByRole('checkbox', { name: 'Include overnight connections', exact: true }).uncheck();
  assert.equal(await page.locator('.route-list button[aria-pressed="true"]').count(), 0, 'disabling overnight comparisons clears an overnight route highlight');
  await page.getByRole('button', { name: 'Highlight 501 Queen', exact: true }).click();
  assert.equal(await page.locator('.route-list button[aria-pressed="true"]').count(), 1);
  await page.reload();
  await page.getByRole('heading', { name: 'Compare stops', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Start stop', { exact: true }).inputValue(), from.id);
  assert.equal(await page.getByLabel('Destination stop', { exact: true }).inputValue(), to.id);
  assert.equal(await page.locator('.comparison-marker').count(), 2, 'comparison endpoints survive a shared-link reload');
  await page.getByRole('button', { name: 'Swap stops', exact: false }).click();
  assert.equal(await page.getByLabel('Start stop', { exact: true }).inputValue(), to.id);
  await page.getByLabel('Destination stop', { exact: true }).selectOption(to.id);
  await page.getByText('You’ve chosen the same stop twice. Choose a different destination to compare.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear comparison', exact: true }).click();
  assert.equal(await page.locator('.comparison-marker').count(), 0);
  await page.getByRole('button', { name: 'Pick start stop on map', exact: true }).click();
  await page.locator(`[data-feature="${from.id}"]`).press('Enter');
  assert.equal(await page.getByLabel('Start stop', { exact: true }).inputValue(), from.id);
  await page.getByRole('button', { name: 'Pick destination stop on map', exact: true }).click();
  const headerSearch = page.getByRole('searchbox', { name: 'Search stops, stations, routes or streetcar numbers' });
  await headerSearch.fill(to.name);
  await page.locator('.search-results').getByRole('button', { name: to.name, exact: false }).first().click();
  assert.equal(await page.getByLabel('Destination stop', { exact: true }).inputValue(), to.id);
  assert.equal(await page.getByRole('tab', { name: 'Compare', exact: true }).getAttribute('aria-selected'), 'true', 'search can fill a comparison endpoint');
  await page.screenshot({ path: '/tmp/ttc-hackathon-comparison.png' });
  await page.getByRole('tab', { name: 'Fleet', exact: true }).click();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.getByRole('button', { name: 'Fit map', exact: true }).click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: '/tmp/ttc-hackathon-fleet.png' });

  // Letter keys are opt-out and never intercept typing inside tool controls.
  await page.getByRole('searchbox', { name: 'Find in fleet', exact: true }).fill('fncrs');
  assert.equal(await page.getByRole('tab', { name: 'Fleet', exact: true }).getAttribute('aria-selected'), 'true');
  await page.locator('#map').focus();
  await page.keyboard.press('e');
  await page.getByRole('tab', { name: 'Explore', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Explore', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('/');
  assert.equal(await headerSearch.evaluate(node => node === document.activeElement), true);
  await page.locator('#map').focus();
  await page.keyboard.press('?');
  await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Enable keyboard shortcuts', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count(), 0);
  await page.locator('#map').focus();
  await page.keyboard.press('f');
  assert.equal(await page.getByRole('tab', { name: 'Explore', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Enable keyboard shortcuts', exact: true }).check();
  await page.getByRole('button', { name: 'Close shortcut help', exact: true }).click();
  await page.getByRole('tab', { name: 'Explore', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Fleet', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Compare', exact: true }).getAttribute('aria-selected'), 'true');
  await page.locator('#map').focus();
  await page.keyboard.press('r');
  assert.equal(await page.locator('.comparison-marker').count(), 0);
  assert.equal(await page.getByRole('tab', { name: 'Explore', exact: true }).getAttribute('aria-selected'), 'true');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('tab', { name: 'Fleet', exact: true }).click();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `fleet fits a ${width}px screen`);
    await page.getByRole('tab', { name: 'Compare', exact: true }).click();
    await page.getByLabel('Start stop', { exact: true }).selectOption(from.id);
    await page.getByLabel('Destination stop', { exact: true }).selectOption(to.id);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `comparison fits a ${width}px screen`);
    await page.screenshot({ path: `/tmp/ttc-hackathon-tools-${width}.png` });
  }
  await page.goto(`${origin}/#view=compare&from=retired-stop&to=${encodeURIComponent(to.id)}`);
  await page.getByText('A shared comparison stop is no longer available. Choose a current boarding stop.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Destination stop', { exact: true }).inputValue(), to.id);

  // Virtual time verifies actual following across snapshot refreshes without waiting 30 seconds.
  const follower = await context.newPage();
  reportTime = Date.now();
  await follower.clock.install({ time: reportTime });
  await follower.goto(`${origin}/#car=4400`);
  await follower.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  await follower.getByRole('button', { name: 'Follow this car', exact: false }).click();
  const before = await follower.locator('#map').getAttribute('viewBox');
  latitude += .001;
  reportTime += 30000;
  await follower.clock.fastForward(30000);
  await follower.waitForFunction(previous => document.querySelector('#map').getAttribute('viewBox') !== previous, before);
  assert.equal(await follower.getByRole('button', { name: 'Following this car', exact: false }).getAttribute('aria-pressed'), 'true');
  await follower.getByRole('button', { name: 'Fit map', exact: true }).click();
  const paused = await follower.locator('#map').getAttribute('viewBox');
  latitude += .001;
  reportTime += 30000;
  await follower.clock.fastForward(30000);
  await follower.waitForTimeout(100);
  assert.equal(await follower.locator('#map').getAttribute('viewBox'), paused, 'manual camera interaction stops automatic following');
  await follower.close();
  assert.deepEqual(errors, []);
  console.log('Exploration UI passed: fleet filters/sort/pagination/CSV, comparison direction/markers/picking/sharing, live-car following/pause, keyboard help/opt-out/tab navigation, 320px/390px layouts; no browser errors.');
  await context.close();
} finally { await browser.close(); }
