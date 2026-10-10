import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';
const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const compiled = await build({
  stdin: {
    contents: `export { buildViewerData } from './shared/map/model'; export { mapToGps, pointAlongEdge } from './shared/map/projection';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const { buildViewerData, mapToGps, pointAlongEdge } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const data = buildViewerData(map);
const stop = data.features.find(
  (stop) => stop.boardingPoints && stop.accessible === true,
);
const gps = mapToGps(stop.point, data.geographicTransform);
const day = data.routes.find((route) => route.number === '501');
const night = data.routes.find((route) => route.overnight && route.scheduled);
/** Fresh positions spread along a route, one car per slot. A fixture that
 * pins every car to one point stacks them on the map, and the browser then
 * retargets taps on any lower car to whichever car is painted on top. */
function spreadAlong(routeId, slots) {
  const edges = data.edges
    .filter((edge) => edge.routeIds.includes(routeId))
    .sort((a, b) => b.lengthMetres - a.lengthMetres);
  const total = edges.reduce((sum, edge) => sum + edge.lengthMetres, 0);
  return Array.from({ length: slots }, (_, slot) => {
    let remaining = ((slot + 0.5) / slots) * total;
    for (const edge of edges) {
      if (remaining <= edge.lengthMetres) {
        const point = pointAlongEdge(edge, remaining).point;
        return mapToGps(point, data.geographicTransform);
      }
      remaining -= edge.lengthMetres;
    }
    return gps;
  });
}
const daySlots = spreadAlong(day.id, 22);
const nightSlots = spreadAlong(night.id, 4);
/** Positions within the stop-detail zoom window, along the stop's own track.
 * The collected cars (4400/4401/4405) must stay near the focused stop to be
 * tappable after the stop search zooms the camera in. */
const stopEdge =
  data.edges.find((edge) => edge.id === stop.edgeId) ??
  data.edges
    .filter((edge) => edge.routeIds.includes(day.id))
    .sort((a, b) => b.lengthMetres - a.lengthMetres)[0];
const stopDistance = stop.distanceAlongMetres ?? stopEdge.lengthMetres / 2;
const alongStop = (offset) => {
  const distance = Math.max(0, Math.min(stopEdge.lengthMetres, stopDistance + offset));
  return mapToGps(pointAlongEdge(stopEdge, distance).point, data.geographicTransform);
};
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
// The first-visit affiliation banner overlays the bottom of the map and the
// mobile panel; dismiss it so the checks can reach the tools underneath.
async function dismissNotice(page) {
  const gotIt = page.getByRole('button', { name: 'Got it', exact: true });
  if (await gotIt.count()) await gotIt.click();
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    colorScheme: 'light',
    permissions: ['geolocation'],
    geolocation: { ...gps, accuracy: 20 },
  });
  const accounts = await installAccountFixture(context, { signedIn: true });
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  await context.route('**/api/v1/map/ttcstatus', (route) => route.fulfill({ json: map }));
  await context.route('**/api/v1/vehicles/streetcar', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        source: 'collection-fixture',
        attribution: 'Offline collection fixture',
        fetchedAt: new Date().toISOString(),
        feedTimestamp: new Date().toISOString(),
        invalidPositions: 0,
        vehicles: Array.from({ length: 26 }, (_, index) => {
          // The three collected cars sit on the stop's own track just east of
          // it, inside the tight "locate me" camera frame and spaced far
          // enough apart to be tapped individually; the rest spread along
          // their routes so no car is ever stacked under another.
          const near = { 0: 0, 1: 90, 5: 40 }[index];
          const slot =
            near !== undefined
              ? alongStop(near)
              : index === 5
                ? nightSlots[index % nightSlots.length]
                : daySlots[index % daySlots.length];
          return {
            id: String(4400 + index),
            label: String(4400 + index),
            ...slot,
            routeId: index === 5 ? night.id : day.id,
            observedAt: new Date(Date.now() - (index === 1 ? 600000 : 0)).toISOString(),
          };
        }),
      },
    }),
  );
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('[data-vehicle="4400"]').waitFor();
  await dismissNotice(page);
  // Saving a stop happens from the explore panel's stop details.
  const headerSearch = page.getByRole('searchbox', {
    name: 'Search stops, stations, routes or vehicle numbers',
  });
  await headerSearch.fill(stop.name);
  await page
    .locator('.search-results')
    .getByRole('button', { name: stop.name, exact: false })
    .first()
    .click();
  await page.getByRole('heading', { name: stop.name, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save stop', exact: false }).click();
  await page.getByRole('button', { name: 'Locate me & centre map', exact: true }).click();
  await page.locator('.location-marker').waitFor();
  await page.getByRole('button', { name: 'Clear location', exact: true }).click();
  await page.screenshot({ path: '/tmp/ttc-hackathon-explore.png' });

  async function collect(id) {
    // Journal actions live in the journal tab only now: the explore panel
    // no longer carries collect buttons.
    await page.getByRole('tab', { name: 'Journal', exact: true }).click();
    await page.getByLabel('Streetcar number', { exact: true }).fill(id);
    await page.getByRole('button', { name: 'Add car to journal', exact: true }).click();
    await page
      .getByRole('article', { name: `Collected car ${id}`, exact: true })
      .waitFor();
  }
  await collect('4400');
  await collect('4401');
  // The night car's route is captured from the live feed even though it is
  // only drawn once the overnight layer is switched on.
  await collect('4405');
  assert.equal(await page.locator('.journal-entry').count(), 3);
  assert.ok(
    (await page.locator('.journal-badge.earned').allTextContents()).some((text) =>
      text.includes('Blue Night collector'),
    ),
  );
  const car = page.getByRole('article', { name: 'Collected car 4400', exact: true });
  await car.getByRole('button', { name: 'Edit note' }).click();
  const note = 'Queen ride ☕\n<script>window.journalInjected=true</script>';
  await page.getByLabel('Note for car 4400', { exact: true }).fill(note);
  await page.keyboard.press('f');
  assert.equal(
    await page
      .getByRole('tab', { name: 'Journal', exact: true })
      .getAttribute('aria-selected'),
    'true',
    'shortcuts do not intercept textarea editing',
  );
  await page.getByLabel('Note for car 4400', { exact: true }).fill(note);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  assert.equal(await car.locator('.journal-note').innerText(), note);
  assert.equal(await page.evaluate(() => window.journalInjected), undefined);
  await page.reload();
  await page.getByRole('heading', { name: 'Streetcar journal.', exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('article', { name: 'Collected car 4400', exact: true })
      .locator('.journal-note')
      .innerText(),
    note,
  );
  assert.ok(
    !page.url().includes('Queen') && !page.url().includes('4400'),
    'sharing the journal tab does not share its contents',
  );
  assert.equal(await page.locator('.journal-entry').count(), 3);
  await page.screenshot({ path: '/tmp/ttc-hackathon-journal.png' });

  // Capture a map containing location and bookmark markers, then verify neither is exported.
  await page.getByRole('tab', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Locate me & centre map', exact: true }).click();
  await page.locator('.location-marker').waitFor();
  await page.getByRole('button', { name: 'Switch to night theme' }).click();
  // Save map lives in the sidebar's explore tools now, not a map overlay.
  await page.getByRole('button', { name: 'Save map', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Take this map with you.',
    exact: true,
  });
  await dialog.waitFor();
  await page.getByRole('button', { name: 'Download map (.svg)', exact: true }).waitFor();
  const svgDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download map (.svg)', exact: true }).click();
  const svg = await readFile(await (await svgDownload).path(), 'utf8');
  const info = await page.evaluate((svg) => {
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = xml.documentElement;
    return {
      errors: xml.querySelectorAll('parsererror').length,
      cars: xml.querySelectorAll('.live-car').length,
      privateMarkers: xml.querySelectorAll('.location-marker,.saved-marker').length,
      tracks: xml.querySelectorAll('.track').length,
      interactive: xml.querySelectorAll(
        '[tabindex],[data-feature],[data-vehicle],script,foreignObject,image,a',
      ).length,
      body: root.textContent,
      viewBox: xml.querySelector('svg svg').getAttribute('viewBox'),
    };
  }, svg);
  assert.equal(info.errors, 0);
  assert.equal(info.privateMarkers, 0);
  assert.equal(info.interactive, 0);
  assert.ok(info.tracks > 0 && info.cars > 0);
  assert.ok(
    info.body.includes('Offline collection fixture') &&
      info.body.includes('OpenStreetMap'),
  );
  await page.evaluate(() =>
    document.querySelector('#map').setAttribute('viewBox', '0 0 100 100'),
  );
  const firstImage = await dialog.locator('img').getAttribute('src');
  await page.getByLabel('Include visible streetcar positions', { exact: true }).uncheck();
  await page.waitForFunction(
    (old) => document.querySelector('.map-print-sheet').getAttribute('src') !== old,
    firstImage,
  );
  const noCarsDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download map (.svg)', exact: true }).click();
  const withoutCars = await readFile(await (await noCarsDownload).path(), 'utf8');
  assert.ok(
    withoutCars.includes('viewBox="' + info.viewBox + '"'),
    'the export stays frozen after the underlying camera changes',
  );
  assert.ok(
    !withoutCars.includes('class="live-car') &&
      !withoutCars.includes('Vehicle snapshot:'),
  );
  await page.evaluate(() => {
    window.print = () => {
      window.printRequested = true;
    };
  });
  await page.getByRole('button', { name: 'Print / save PDF', exact: true }).click();
  assert.ok(await page.evaluate(() => window.printRequested));
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.workspace').isVisible(), false);
  assert.equal(await dialog.locator('.export-options').first().isVisible(), false);
  assert.equal(await dialog.locator('.map-print-sheet').isVisible(), false);
  assert.equal(
    await page.locator('.map-print-output .map-print-sheet').isVisible(),
    true,
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
    'rgb(255, 255, 255)',
  );
  await page.pdf({
    path: '/tmp/ttc-hackathon-map.pdf',
    preferCSSPageSize: true,
    printBackground: true,
  });
  await page.emulateMedia({ media: 'screen' });
  await page.screenshot({ path: '/tmp/ttc-hackathon-map-export.png' });
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false);

  // Phone layouts include all three tabs and the complete print dialog.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    // On phones the tabs and tools live in the nav overlay behind the brand
    // symbol; start each pass from a closed menu.
    const closeMenu = page.getByRole('button', { name: 'Close menu', exact: true });
    if (await closeMenu.count()) await closeMenu.click();
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    for (const name of ['Journal', 'Badges']) {
      await page.getByRole('tab', { name, exact: true }).click();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        'no horizontal overflow at ' + width,
      );
      assert.ok(
        await page.evaluate(() =>
          [...document.querySelectorAll('.main-nav button')].every(
            (button) => button.scrollWidth <= button.clientWidth,
          ),
        ),
        'all tab labels fit at ' + width,
      );
    }
    // Save map lives in the explore tools inside the same menu.
    await page.getByRole('tab', { name: 'Explore', exact: true }).click();
    await page.getByRole('button', { name: 'Save map', exact: true }).click();
    await dialog.locator('img').waitFor();
    assert.ok(
      await page.evaluate(
        () =>
          document.querySelector('.map-export').getBoundingClientRect().right <=
          innerWidth,
      ),
    );
    await page.keyboard.press('Escape');
    await page.screenshot({ path: '/tmp/ttc-hackathon-collection-' + width + '.png' });
  }
  // Tab keyboard navigation continues from the desktop layout.
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('tab', { name: 'Explore', exact: true }).click();
  await page.getByRole('tab', { name: 'Journal', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page
      .getByRole('tab', { name: 'Badges', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page
      .getByRole('tab', { name: 'Explore', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );

  const full = await context.newPage();
  accounts.journals.set('user_full', {
    entries: Array.from({ length: 500 }, (_, index) => ({
      vehicleId: 'saved-' + index,
      label: 'Saved ' + index,
      recordedAt: '2026-10-03T12:00:00.000Z',
      note: '',
    })),
    revision: 1,
  });
  await full.addInitScript(() => {
    window.__testUser = 'user_full';
  });
  await full.goto(origin + '/#car=4400');
  await full.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  await dismissNotice(full);
  // The journal is full: the journal tab's add form refuses another car.
  await full.getByRole('tab', { name: 'Journal', exact: true }).click();
  await full.getByLabel('Streetcar number', { exact: true }).fill('4599');
  await full.getByRole('button', { name: 'Add car to journal', exact: true }).click();
  await full
    .getByText('Your journal is full. Remove a car before adding another.', {
      exact: true,
    })
    .waitFor();
  assert.equal(await full.locator('.journal-entry').count(), 10);
  assert.ok(
    (await full.locator('#panel-journal .fleet-pagination').innerText()).includes(
      'Page 1 of 50',
    ),
  );
  await full.close();
  const privateTab = await context.newPage();
  await privateTab.addInitScript(() => {
    window.__testUser = 'user_private';
  });
  await privateTab.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await privateTab.goto(origin + '/#car=4400');
  await privateTab.getByRole('heading', { name: 'Car 4400', exact: true }).waitFor();
  await dismissNotice(privateTab);
  // Collecting happens in the journal tab; blocked browser storage never
  // touches the server-owned journal.
  await privateTab.getByRole('tab', { name: 'Journal', exact: true }).click();
  await privateTab.getByLabel('Streetcar number', { exact: true }).fill('4400');
  await privateTab
    .getByRole('button', { name: 'Add car to journal', exact: true })
    .click();
  await privateTab
    .getByText('Your journal is saved to your account.', { exact: true })
    .waitFor();
  assert.equal(await privateTab.locator('.journal-entry').count(), 1);
  await privateTab.close();
  assert.deepEqual(errors, []);
  console.log(
    'Collection UI passed: explore stop saving/location, server journal/notes/badges/removal, private-marker-free offline SVG and print/PDF, 320px/390px layouts and three-tab keyboard navigation; no browser errors.',
  );
  await context.close();
} finally {
  await browser.close();
}
