import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const compiled = await build({
  stdin: {
    contents: `export { mapToGps, pointAlongEdge } from './shared/map/projection'; export { demoData } from './web/ui/stories/fixtures';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const { mapToGps, pointAlongEdge, demoData } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const fixtureEdge = (id, a, b, sourcePoints, routeIds = ['501']) => {
  const lengthMetres = Math.hypot(
    sourcePoints[1][0] - sourcePoints[0][0],
    sourcePoints[1][1] - sourcePoints[0][1],
  );
  return {
    id,
    a,
    b,
    sourcePoints,
    routeIds,
    points: sourcePoints.map(([x, y]) => [x + 50, 150 - y]),
    sourceDistances: [0, lengthMetres],
    lengthMetres,
    infrastructureIds: [],
  };
};
// A known fork makes switch/preview tests reproducible instead of depending on
// a random starting edge and whatever branches happen to be near it.
const forkMap = {
  display: { geographicTransform: demoData.geographicTransform },
  routes: [
    { id: '501', shortName: '501', longName: 'Queen' },
    { id: '504', shortName: '504', longName: 'King' },
  ],
  graph: {
    edges: [
      fixtureEdge('stem', 'a', 'b', [
        [0, 0],
        [350, 0],
      ]),
      fixtureEdge('straight', 'b', 'c', [
        [350, 0],
        [450, 0],
      ]),
      fixtureEdge('left', 'b', 'd', [
        [350, 0],
        [350, 100],
      ]),
      fixtureEdge(
        'right',
        'b',
        'e',
        [
          [350, 0],
          [350, -100],
        ],
        ['504'],
      ),
    ],
  },
  stops: [
    {
      id: 'left-stop',
      name: 'Left stop',
      x: 400,
      y: 110,
      routeIds: ['501'],
      stopIds: ['left-stop'],
      edgeId: 'left',
      distanceAlongMetres: 40,
    },
    {
      id: 'right-stop',
      name: 'Right stop',
      x: 400,
      y: 210,
      routeIds: ['504'],
      stopIds: ['right-stop'],
      edgeId: 'right',
      distanceAlongMetres: 60,
    },
  ],
  patterns: [],
  paths: [],
  infrastructure: [],
  context: { shoreline: [], labels: [], north: { angle: -90 } },
};
const errors = [],
  requests = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  let feedCalls = 0,
    mapCalls = 0;
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  await context.route('**/api/v1/auth/config', (route) =>
    route.fulfill({ json: { enabled: false, publishableKey: null } }),
  );
  await context.route('**/api/v1/map/streetcar?format=schematic-v1', (route) => {
    mapCalls++;
    return route.fulfill({ json: map });
  });
  await context.route('**/api/v1/vehicles/streetcar', (route) => {
    feedCalls++;
    const now = new Date().toISOString();
    const vehicles = map.graph.edges
      .filter((edge) => edge.routeIds.length)
      .slice(0, 40)
      .map((edge, index) => {
        const gps = mapToGps(
          pointAlongEdge(edge, edge.lengthMetres / 2).point,
          map.display.geographicTransform,
        );
        return {
          id: String(4400 + index),
          label: String(4400 + index),
          ...gps,
          routeId: edge.routeIds[0],
          observedAt: now,
          bearing: 90,
        };
      });
    return route.fulfill({
      headers: { 'x-live-update-seconds': '30' },
      json: {
        schemaVersion: 1,
        source: 'game-fixture',
        attribution: 'Fixture',
        fetchedAt: now,
        feedTimestamp: now,
        invalidPositions: 0,
        vehicles,
      },
    });
  });
  const page = await context.newPage();
  await page.goto(origin + '/xplore');
  const notice = page.getByRole('button', { name: 'Got it', exact: true });
  if (await notice.count()) await notice.click();
  const launch = page.getByRole('button', { name: 'Play Streetcar Snake', exact: true });
  await launch.waitFor();
  await page.getByRole('checkbox', { name: 'Show live vehicles' }).uncheck();
  await launch.click();
  const game = page.getByRole('dialog', { name: 'Streetcar Snake' });
  await game.waitFor();
  assert.ok(
    (await game.getByLabel('Route', { exact: true }).locator('option').count()) > 10,
  );
  assert.equal(mapCalls, 1, 'game reuses the already-loaded map');
  const viewWidth = async () =>
    Number((await page.locator('#snake-map').getAttribute('viewBox')).split(' ')[2]);
  // Wait for the opening camera glide (focusBounds) to settle, then capture
  // the zoom BEFORE departure: a pickup can happen within a few hundred
  // milliseconds, and the growth zoom would inflate the baseline.
  await page.waitForFunction(
    (limit) =>
      Number(
        document.querySelector('#snake-map')?.getAttribute('viewBox')?.split(' ')[2],
      ) < limit,
    map.display.width / 6,
    { timeout: 5000, polling: 100 },
  );
  const startWidth = await viewWidth();
  assert.ok(
    startWidth < map.display.width / 6,
    'the game starts zoomed in on the streetcar',
  );
  const before = feedCalls;
  await game.getByRole('button', { name: 'Depart', exact: true }).click();
  await page.waitForTimeout(250);
  const cameraBefore = await page.locator('#snake-map').getAttribute('viewBox');
  const initial = await game.locator('[data-snake-head]').getAttribute('transform');
  await page.waitForTimeout(250);
  assert.notEqual(
    await game.locator('[data-snake-head]').getAttribute('transform'),
    initial,
    'the streetcar moves along the map',
  );
  assert.notEqual(
    await page.locator('#snake-map').getAttribute('viewBox'),
    cameraBefore,
    'the camera follows the moving streetcar',
  );
  // Zooming never hands the camera over; only manual panning does.
  const following = () =>
    game
      .getByRole('button', { name: 'Following', exact: true })
      .getAttribute('aria-pressed');
  await game.getByRole('button', { name: 'Zoom out' }).click();
  await game.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(150);
  assert.equal(await following(), 'true', 'zooming keeps camera following');
  // Resuming re-centers on the streetcar after a manual take-over.
  await game.getByRole('button', { name: 'Following', exact: true }).click();
  await game.getByRole('button', { name: 'Pause', exact: true }).click();
  await game.getByText('Paused', { exact: true }).waitFor();
  await game.getByRole('button', { name: 'Resume driving', exact: true }).click();
  await page.waitForTimeout(150);
  assert.equal(await following(), 'true', 'resuming re-enables camera following');
  // Each collected car widens the camera one step.
  await page.waitForFunction(
    () => document.querySelector('[data-snake-count]')?.textContent !== '1',
    undefined,
    { timeout: 20000 },
  );
  assert.ok(
    (await viewWidth()) > startWidth * 1.1,
    'collecting cars zooms out as the train grows',
  );
  await page.keyboard.press('ArrowLeft');
  await game.getByRole('button', { name: 'Pause', exact: true }).click();
  await game.getByText('Paused', { exact: true }).waitFor();
  const paused = await game.locator('[data-snake-head]').getAttribute('transform');
  await page.waitForTimeout(200);
  assert.equal(await game.locator('[data-snake-head]').getAttribute('transform'), paused);
  assert.equal(
    await page.locator('.map-export-dialog').count(),
    0,
    'P does not open the xplore export flow',
  );
  await game.getByRole('button', { name: 'Resume driving', exact: true }).click();
  await game.getByRole('button', { name: 'Pause', exact: true }).focus();
  await page.keyboard.press('Space');
  await game.getByText('Paused', { exact: true }).waitFor();
  await game.getByRole('button', { name: 'Resume driving', exact: true }).click();
  await page.keyboard.press('ArrowUp');
  await page.screenshot({ path: '/tmp/ttc-snake-desktop.png' });
  assert.equal(feedCalls, before, 'game does not create a second poller');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await launch.click();
  await game.getByLabel('Driving mode', { exact: true }).selectOption('purist');
  await game.getByRole('button', { name: 'Depart', exact: true }).click();
  await page.waitForTimeout(150);
  assert.equal(await game.locator('[data-snake-count]').innerText(), '1');
  assert.equal(await game.locator('[data-snake-speed]').innerText(), '50');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(120);
  await page.keyboard.up('ArrowUp');
  assert.equal(await game.locator('[data-snake-speed]').innerText(), '50');
  await game.getByRole('button', { name: 'Close Streetcar Snake' }).click();
  assert.ok(
    await launch.evaluate((element) => element === document.activeElement),
    'closing restores launcher focus',
  );

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobileContext.addInitScript(() => {
    Math.random = () => 0.5;
  });
  await mobileContext.route('**/api/v1/auth/config', (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await mobileContext.route('**/api/v1/map/streetcar?format=schematic-v1', (route) =>
    route.fulfill({ json: forkMap }),
  );
  await mobileContext.route('**/api/v1/vehicles/streetcar', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        source: 'empty-fixture',
        attribution: 'Fixture',
        fetchedAt: new Date().toISOString(),
        feedTimestamp: null,
        invalidPositions: 0,
        vehicles: [],
      },
    }),
  );
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(origin + '/xplore');
  const mobileNotice = mobile.getByRole('button', { name: 'Got it', exact: true });
  if (await mobileNotice.count()) await mobileNotice.tap();
  await mobile.getByRole('button', { name: 'Play Streetcar Snake' }).tap();
  const cockpit = mobile.getByRole('dialog');
  await cockpit.getByRole('button', { name: 'Depart', exact: true }).tap();
  await mobile.waitForTimeout(150);
  await cockpit.getByRole('button', { name: 'Pause', exact: true }).tap();
  await cockpit.getByText('Paused', { exact: true }).waitFor({ timeout: 2000 });
  await cockpit.getByRole('button', { name: 'Resume driving', exact: true }).tap();
  assert.equal(
    await cockpit
      .getByRole('button', { name: '↑ 501', exact: true })
      .getAttribute('data-selection'),
    'automatic',
  );
  assert.ok(await cockpit.getByRole('button', { name: 'Hold to brake' }).isVisible());
  assert.ok(
    await cockpit.getByRole('button', { name: 'Hold to accelerate' }).isVisible(),
  );
  assert.ok(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  const brake = cockpit.getByRole('button', { name: 'Hold to brake' });
  await brake.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch' });
  await mobile.waitForTimeout(400);
  await brake.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
  assert.ok(Number(await cockpit.locator('[data-snake-speed]').innerText()) < 180);
  const touch = await mobileContext.newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 240, y: 460, id: 1 }],
  });
  await mobile.waitForTimeout(80);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 150, y: 460, id: 1 }],
  });
  await mobile.waitForTimeout(80);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const left = cockpit.getByRole('button', { name: '← 501', exact: true });
  assert.equal(
    await left.getAttribute('aria-pressed'),
    'true',
    'single-finger swipe steers',
  );
  assert.equal(await left.getAttribute('data-selection'), 'manual');
  await cockpit.getByText(/Next stop: Left stop/).waitFor();
  assert.equal(
    await cockpit
      .getByRole('button', { name: 'Following', exact: true })
      .getAttribute('aria-pressed'),
    'true',
    'steering does not disable camera following',
  );
  await mobile.waitForTimeout(350); // Let Chromium finish the preceding CDP swipe's touch gesture.
  await cockpit.getByRole('button', { name: 'Pause', exact: true }).tap();
  await cockpit.getByText('Paused', { exact: true }).waitFor({ timeout: 2000 });
  assert.equal(
    await cockpit.locator('[data-snake-route-preview]').count(),
    0,
    'the train has no attached route line',
  );
  const selectedArrow = await cockpit
    .locator('[data-snake-switch-arrow]')
    .getAttribute('transform');
  assert.ok(selectedArrow, 'the selected switch has a visible direction arrow');
  await mobile.keyboard.press('ArrowRight');
  assert.equal(
    await cockpit
      .getByRole('button', { name: '→ 504', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.notEqual(
    await cockpit.locator('[data-snake-switch-arrow]').getAttribute('transform'),
    selectedArrow,
    'selected track changes the switch direction arrow',
  );
  await cockpit.getByText(/Next stop: Right stop/).waitFor();
  // Space activates a focused button (standard behaviour), so steer from the body.
  await mobile.evaluate(() => document.activeElement?.blur());
  await mobile.keyboard.press('Space');
  assert.equal(
    await cockpit
      .getByRole('button', { name: '↑ 501', exact: true })
      .getAttribute('data-selection'),
    'manual',
  );
  await mobile.keyboard.press('ArrowLeft');
  assert.equal(await left.getAttribute('aria-pressed'), 'true');
  await mobile.keyboard.down('ArrowDown');
  await mobile.waitForTimeout(60);
  assert.equal(
    await brake.getAttribute('data-held'),
    'true',
    'keyboard braking highlights the same pedal',
  );
  await mobile.keyboard.up('ArrowDown');
  await mobile.waitForTimeout(60);
  assert.equal(await brake.getAttribute('data-held'), 'false');
  const accelerator = cockpit.getByRole('button', { name: 'Hold to accelerate' });
  await mobile.keyboard.down('ArrowUp');
  await mobile.waitForTimeout(60);
  assert.equal(await accelerator.getAttribute('data-held'), 'true');
  await mobile.waitForTimeout(60);
  await mobile.keyboard.up('ArrowUp');
  await mobile.waitForTimeout(60);
  assert.equal(
    await accelerator.getAttribute('data-held'),
    'false',
    'releasing the arrow releases the accelerator',
  );
  const beforePinch = (await cockpit.locator('#snake-map').getAttribute('viewBox'))
    .split(' ')
    .map(Number)[2];
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 120, y: 580, id: 1 },
      { x: 250, y: 580, id: 2 },
    ],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 90, y: 580, id: 1 },
      { x: 280, y: 580, id: 2 },
    ],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(100);
  const afterPinch = (await cockpit.locator('#snake-map').getAttribute('viewBox'))
    .split(' ')
    .map(Number)[2];
  assert.ok(afterPinch < beforePinch, 'two-finger pinch zooms the shared map');
  assert.equal(
    await left.getAttribute('aria-pressed'),
    'true',
    'pinch never changes the queued switch',
  );
  const brakeBox = await brake.boundingBox(),
    acceleratorBox = await accelerator.boundingBox(),
    hudBox = await cockpit.locator('.snake-hud').boundingBox();
  const pedalPoints = [
    { x: brakeBox.x + brakeBox.width / 2, y: brakeBox.y + brakeBox.height / 2, id: 1 },
    {
      x: acceleratorBox.x + acceleratorBox.width / 2,
      y: acceleratorBox.y + acceleratorBox.height / 2,
      id: 2,
    },
  ];
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: pedalPoints,
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: pedalPoints.map((point, index) => ({
      ...point,
      x: point.x + (index ? 20 : -20),
    })),
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(100);
  assert.ok(
    Number((await cockpit.locator('#snake-map').getAttribute('viewBox')).split(' ')[2]) <
      afterPinch,
    'pinch beginning on the pedals still zooms the map',
  );
  assert.equal(await brake.getAttribute('data-held'), 'false');
  assert.equal(
    await accelerator.getAttribute('data-held'),
    'false',
    'pinch releases both pedals',
  );
  assert.equal(
    (await cockpit.locator('.snake-hud').boundingBox()).width,
    hudBox.width,
    'zoom keeps cockpit controls at their original size',
  );
  assert.equal(
    await left.getAttribute('aria-pressed'),
    'true',
    'a pinch over controls does not throw another switch',
  );
  assert.ok(
    await cockpit.getByText('Paused', { exact: true }).isVisible(),
    'pinching over controls does not resume a paused run',
  );
  await mobile.screenshot({ path: '/tmp/ttc-snake-mobile.png' });
  await cockpit.getByRole('button', { name: 'Close Streetcar Snake' }).tap();

  page.on('requestfailed', (request) => requests.push(request.url()));
  const response = await page.goto(origin + '/snake/v1');
  assert.equal(response.status(), 200);
  await page.locator('#startBtn').waitFor();
  assert.equal(new URL(page.url()).pathname, '/snake/v1/');
  assert.ok(await page.locator('#game').isVisible());
  await page.locator('#startBtn').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/ttc-snake-legacy.png' });
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    'Snake browser checks passed: shared map/feed, selected track previews and arrow keys, pedal feedback/release, pinch over controls, arcade motion, purist governor, focus restoration, playable legacy archive.',
  );
  await context.close();
  await mobileContext.close();
} finally {
  await browser.close();
}
