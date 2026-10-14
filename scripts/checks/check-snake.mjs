import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const frameBudgetMs = 50;
const stallBudgetMs = 500;
const frameSampleMs = 4000;
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const compiled = await build({
  stdin: {
    contents: `export { mapToGps, pointAlongEdge } from './shared/map/projection'; export { buildViewerData } from './shared/map/model'; export { buildSnakeMap } from './shared/map/game-map'; export { demoData } from './web/ui/stories/fixtures';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const { mapToGps, pointAlongEdge, buildViewerData, buildSnakeMap, demoData } =
  await import(
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
  await installAccountFixture(context);
  let feedCalls = 0,
    mapCalls = 0,
    snakeBoardCalls = 0;
  // The fixture's fake publishable key cannot resolve a Clerk FJS domain, so
  // the provider always reports one failed script load per page that mounts
  // it. Tolerate that known noise; any other page error still fails the run.
  const collectErrors = (page) =>
    page.on('pageerror', (error) => {
      if (error.message.includes('failed_to_load_clerk_js')) return;
      errors.push(error.message);
    });
  context.on('page', collectErrors);
  await context.route('**/api/v1/map/ttcstatus*', (route) => {
    mapCalls++;
    return route.fulfill({ json: map });
  });
  // The game prefers the published prebuilt board; desktop exercises that
  // path with a board derived exactly like the generator publishes it.
  await context.route('**/api/v1/map/snake*', (route) => {
    snakeBoardCalls++;
    return route.fulfill({ json: buildSnakeMap(buildViewerData(map)).data });
  });
  // Live tick path (Epic 2): config-driven URL; no x-live-* headers.
  await context.route('**/live/t/*/vehicles.json', (route) => {
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
      headers: { etag: '"game-fixture"' },
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
  // The map tools collapsed into a disclosure (1fd0194): open it to reach the
  // live map mode control, then drive with the live layer off — the game must
  // still depart into a fresh snapshot of its own.
  await page.locator('.explore-settings > summary').click();
  await page
    .getByRole('group', { name: 'Live map mode' })
    .getByRole('button', { name: 'Off', exact: true })
    .click();
  // Opening the game must not touch the map network again: the board arrives
  // with one request and the explorer's already-loaded map is reused. (The
  // workspace's own map load may retry once when the config endpoint is
  // absent, so the game-time assertion pins the count at launch.)
  const mapCallsAtLaunch = mapCalls;
  await launch.click();
  const game = page.getByRole('dialog', { name: 'Streetcar Snake' });
  await game.waitFor();
  assert.equal(mapCalls, mapCallsAtLaunch, 'game reuses the already-loaded map');
  assert.equal(
    snakeBoardCalls,
    1,
    'game opens on the published prebuilt board with one request',
  );
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
  const headBody = game.locator('[data-snake-head] .streetcar-body');
  await headBody.waitFor();
  assert.equal(await headBody.getAttribute('fill'), '#d71920');
  assert.ok(
    (await game.locator('[data-snake-food]').count()) > 0,
    'generated cars appear on the board before they can be collected',
  );
  const lineTracks = await page.locator('.snake-play-tracks').evaluate((layer) => {
    const line = layer.getAttribute('data-current-line');
    return [...layer.querySelectorAll('[data-line]')]
      .filter((track) => track.getAttribute('data-line') === line)
      .map((track) => track.getAttribute('stroke'));
  });
  assert.ok(lineTracks.length > 0 && new Set(lineTracks).size === 1);
  const trackColors = await page
    .locator('.snake-play-tracks [data-snake-track]')
    .evaluateAll((tracks) => tracks.map((track) => track.getAttribute('stroke')));
  assert.ok(new Set(trackColors).size > 1, 'different lines keep distinct rail colours');
  assert.ok(
    trackColors.every((color) => color !== '#d71920' && color !== '#ed1c24'),
    'no track uses the red reserved for streetcars',
  );
  assert.equal(
    await game.locator('.snake-train > polyline').count(),
    0,
    'the train has no continuous trail extending beyond its individual cars',
  );
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
  // Count browser frames while the full board, train, traffic, HUD, and
  // following camera are all active. Elapsed time includes any long stall,
  // even if requestAnimationFrame does not run again before the sample ends.
  const perfStart = await game.locator('[data-snake-head]').getAttribute('transform');
  const frameSample = await page.evaluate(
    (durationMs) =>
      new Promise((resolve) => {
        const started = performance.now();
        let frames = 0;
        let lastFrame = started;
        let longestFrameMs = 0;
        let animationFrame;
        const sample = (now) => {
          frames++;
          longestFrameMs = Math.max(longestFrameMs, now - lastFrame);
          lastFrame = now;
          animationFrame = requestAnimationFrame(sample);
        };
        animationFrame = requestAnimationFrame(sample);
        setTimeout(() => {
          cancelAnimationFrame(animationFrame);
          const elapsedMs = performance.now() - started;
          resolve({
            frames,
            elapsedMs,
            averageMs: elapsedMs / frames,
            longestFrameMs: Math.max(longestFrameMs, elapsedMs - lastFrame),
          });
        }, durationMs);
      }),
    frameSampleMs,
  );
  assert.notEqual(
    await game.locator('[data-snake-head]').getAttribute('transform'),
    perfStart,
    'the train moves throughout the frame sample',
  );
  assert.ok(
    await game.getByRole('button', { name: 'Pause', exact: true }).isVisible(),
    'the game remains running throughout the frame sample',
  );
  assert.ok(
    frameSample.averageMs <= frameBudgetMs,
    `snake rendering averaged ${frameSample.averageMs.toFixed(1)} ms/frame over ${frameSample.frames} frames (${frameSample.elapsedMs.toFixed(0)} ms sampled, longest frame ${frameSample.longestFrameMs.toFixed(1)} ms); budget is ${frameBudgetMs} ms/frame`,
  );
  assert.ok(
    frameSample.longestFrameMs <= stallBudgetMs,
    `snake rendering stalled for ${frameSample.longestFrameMs.toFixed(1)} ms; limit is ${stallBudgetMs} ms`,
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
  assert.equal(await headBody.getAttribute('fill'), '#d71920');
  assert.ok(
    (await game.locator('[data-snake-food]').count()) > 0,
    'collectible cars stay drawn as the train grows',
  );
  await page.waitForFunction(
    () => {
      const viewport = document.querySelector('#snake-map')?.getBoundingClientRect();
      if (!viewport) return false;
      return [
        ...document.querySelectorAll(
          'dialog.snake-game [data-snake-food], dialog.snake-game .live-car',
        ),
      ].some((car) => {
        const box = car.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          box.right > viewport.left &&
          box.left < viewport.right &&
          box.bottom > viewport.top &&
          box.top < viewport.bottom
        );
      });
    },
    undefined,
    { timeout: 5000 },
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
  const trainCarBounds = await game.locator('[data-snake-car]').evaluateAll((cars) =>
    cars.map((car) => {
      const body = car.querySelector('.streetcar-body');
      const box = body.getBoundingClientRect();
      return {
        index: car.getAttribute('data-snake-car'),
        lengthPx: Math.hypot(box.width, box.height),
        transform: car.getAttribute('transform'),
        shape: body.getAttribute('d'),
      };
    }),
  );
  assert.ok(
    trainCarBounds.every((car) => car.lengthPx <= 160),
    `a train car stretches across the map: ${JSON.stringify(trainCarBounds)}`,
  );
  const foodCarBounds = await game.locator('[data-snake-food]').evaluateAll((cars) =>
    cars.map((car) => {
      const box = car.querySelector('.streetcar-body').getBoundingClientRect();
      return {
        id: car.getAttribute('data-snake-food'),
        lengthPx: Math.hypot(box.width, box.height),
      };
    }),
  );
  assert.ok(foodCarBounds.length > 0, 'collectible cars remain on the map');
  assert.ok(
    foodCarBounds.every((car) => car.lengthPx <= 160),
    `a collectible car stretches across the map: ${JSON.stringify(foodCarBounds.filter((car) => car.lengthPx > 160))}`,
  );
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

  // Deep isolation: a run plays on the world it departed into. This fixture's
  // observations are fixed 100 s in the past — fresh on entry, permanently
  // stale ~20 s later. An app-side staleness leak would erase every real
  // streetcar from a live run within half a minute; the game freezes its own
  // world at departure, so the frozen world must keep the fleet visible and
  // couplable through the whole run.
  const agedTimestamp = new Date(Date.now() - 100_000).toISOString();
  await context.route('**/live/t/*/vehicles.json', (route) =>
    route.fulfill({
      headers: { etag: '"aged-fixture"' },
      json: {
        schemaVersion: 1,
        source: 'aged-fixture',
        attribution: 'Fixture',
        fetchedAt: agedTimestamp,
        feedTimestamp: agedTimestamp,
        invalidPositions: 0,
        vehicles: map.graph.edges
          .filter((edge) => edge.routeIds.length)
          .slice(0, 40)
          .map((edge, index) => {
            const gps = mapToGps(
              pointAlongEdge(edge, edge.lengthMetres / 2).point,
              map.display.geographicTransform,
            );
            return {
              id: String(4600 + index),
              label: String(4600 + index),
              ...gps,
              routeId: edge.routeIds[0],
              observedAt: agedTimestamp,
              bearing: 90,
            };
          }),
      },
    }),
  );
  await page.goto(origin + '/xplore');
  const agedNotice = page.getByRole('button', { name: 'Got it', exact: true });
  if (await agedNotice.count()) await agedNotice.click();
  await launch.click();
  await game.waitFor();
  await game.getByLabel('Driving mode', { exact: true }).selectOption('arcade');
  await game.getByRole('button', { name: 'Depart', exact: true }).click();
  const liveCarsInGame = () =>
    page.evaluate(() => document.querySelectorAll('dialog.snake-game .live-car').length);
  await page.waitForTimeout(1500);
  const frozenBaseline = await liveCarsInGame();
  assert.ok(frozenBaseline > 0, 'the run departs into fresh live traffic');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(20_000);
  for (let sample = 0; sample < 8; sample++) {
    await page.waitForTimeout(5_000);
    const remaining = await liveCarsInGame();
    assert.ok(
      remaining > 0,
      `the frozen world keeps streetcars on the map past the staleness horizon (sample ${sample})`,
    );
  }
  const frozenCount = Number(await game.locator('[data-snake-count]').innerText());
  assert.ok(frozenCount > 1, 'pickups still couple after the app-side staleness horizon');
  await page.keyboard.up('ArrowUp');
  await game.getByRole('button', { name: 'Close Streetcar Snake' }).click();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await installAccountFixture(mobileContext);
  await mobileContext.addInitScript(() => {
    Math.random = () => 0.5;
  });
  await mobileContext.route('**/api/v1/map/ttcstatus*', (route) =>
    route.fulfill({ json: forkMap }),
  );
  // No published board here: the game must fall back to deriving the board
  // from the loaded fork map instead of failing to open.
  await mobileContext.route('**/api/v1/map/snake*', (route) =>
    route.fulfill({ status: 503, json: { error: 'map-not-ready' } }),
  );
  await mobileContext.route('**/live/t/*/vehicles.json', (route) =>
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
  collectErrors(mobile);
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
      .getByRole('button', { name: '↑ 501 Queen', exact: true })
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
  const left = cockpit.getByRole('button', { name: '← 501 Queen', exact: true });
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
  const switchLayout = await cockpit.locator('.snake-switches').evaluate((panel) => {
    const buttons = [...panel.querySelectorAll('button')];
    const originalLabels = buttons.map((button) => button.textContent);
    // Exercise the longer subway labels from the reported screenshot at a
    // narrow viewport, while preserving the real switch choices and clicks.
    const longLabels = [
      '[Space] Eglinton Line 5',
      '[Right] Yonge-University Line 1',
      '[Left] Sheppard Line 4',
    ];
    try {
      buttons.forEach((button, index) => {
        button.textContent = longLabels[index] ?? longLabels[1];
      });
      const panelBox = panel.getBoundingClientRect();
      const boxes = buttons.map((button) => button.getBoundingClientRect());
      return {
        hasChoices: buttons.length >= 2,
        inViewport: panelBox.left >= 0 && panelBox.right <= innerWidth,
        textFits: buttons.every(
          (button) =>
            button.scrollWidth <= button.clientWidth + 1 &&
            button.scrollHeight <= button.clientHeight + 1,
        ),
        buttonsDoNotOverlap: boxes.every((box, index) =>
          boxes
            .slice(index + 1)
            .every(
              (other) =>
                box.right <= other.left ||
                other.right <= box.left ||
                box.bottom <= other.top ||
                other.bottom <= box.top,
            ),
        ),
      };
    } finally {
      buttons.forEach((button, index) => {
        button.textContent = originalLabels[index];
      });
    }
  });
  assert.deepEqual(
    switchLayout,
    { hasChoices: true, inViewport: true, textFits: true, buttonsDoNotOverlap: true },
    'long switch labels stay readable without overlapping on a narrow screen',
  );
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
      .getByRole('button', { name: '→ 504 King', exact: true })
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
      .getByRole('button', { name: '↑ 501 Queen', exact: true })
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
    `Snake browser checks passed: ${frameSample.averageMs.toFixed(1)} ms/frame over ${frameSample.frames} active frames (budget ${frameBudgetMs} ms, longest ${frameSample.longestFrameMs.toFixed(1)} ms), shared map/feed, selected track previews and arrow keys, pedal feedback/release, pinch over controls, arcade motion, purist governor, focus restoration, frozen-world isolation from feed staleness, playable legacy archive.`,
  );
  await context.close();
  await mobileContext.close();
} finally {
  await browser.close();
}
