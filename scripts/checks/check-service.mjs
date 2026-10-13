import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

// Run against `npm run dev:viewer`. TTC responses are intercepted with local
// data — including the live stops tick document keyed by the REAL stop ids
// of the map the
// page actually loads, so the field paints the tracks exactly as production
// would. This is the polish-epic UX (E7S4): no panel, no always-on markers —
// the dryness field on the tracks, one marker + story card on selection.
const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';

// ——— The page's own map, fetched the same way the page fetches it. ———
const bundle = await build({
  stdin: {
    contents: `
  export { buildViewerData } from './shared/map/model';
  export { edgeServiceSegments, drynessColor } from './web/ui/features/service/wave-field';
  export { twinFeature } from './web/ui/features/map/platform-pairs';
  export { serviceConfig } from './shared/service/config';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});
const dir = await mkdtemp(join(tmpdir(), 'ttc-check-service-'));
await writeFile(join(dir, 'model.mjs'), bundle.outputFiles[0].text);
const { buildViewerData, edgeServiceSegments, drynessColor, twinFeature, serviceConfig } =
  await import(pathToFileURL(join(dir, 'model.mjs')).href);
await rm(dir, { recursive: true, force: true });
const mapPayload = await (await fetch(`${origin}/api/v1/map/ttcstatus`)).json();
const viewer = 'graph' in mapPayload ? buildViewerData(mapPayload) : mapPayload;

// ——— Craft delivered-service states keyed by the map's own stop ids. ———
// Pick the edge whose stops give the longest corridor, then script it:
// fresh → due → a growing void wave (dryness rising stop by stop), plus one
// blind (unmonitored) stop on another edge.
const anchorsByEdge = new Map();
for (const feature of viewer.features) {
  if (!feature.edgeId || feature.distanceAlongMetres === undefined) continue;
  const bucket = anchorsByEdge.get(feature.edgeId) ?? [];
  bucket.push(feature);
  anchorsByEdge.set(feature.edgeId, bucket);
}
// The corridor to script: enough stop anchors to paint, enough vertices to
// grade. (All features anchor — nearside pairs included: the field takes the
// worse direction at a shared position, so pairs paint too.)
let corridorEdge = null;
for (const [edgeId, features] of anchorsByEdge) {
  if (features.length < 5) continue;
  const vertices = viewer.edges.find((edge) => edge.id === edgeId)?.points.length ?? 0;
  const current = corridorEdge
    ? {
        anchors: anchorsByEdge.get(corridorEdge).length,
        vertices:
          viewer.edges.find((edge) => edge.id === corridorEdge)?.points.length ?? 0,
      }
    : null;
  if (!current || features.length + vertices > current.anchors + current.vertices) {
    corridorEdge = edgeId;
  }
}
const corridor = [...anchorsByEdge.get(corridorEdge)].sort(
  (a, b) => (a.distanceAlongMetres ?? 0) - (b.distanceAlongMetres ?? 0),
);
assert.ok(corridor.length >= 5, 'the fixture map needs a corridor of stops to script');

const now = Date.now();
const states = [];
const stateFor = (stopId, state, minutes, extra = {}) => ({
  stopId,
  directionId: 0,
  state,
  // Consistent with the server: dryness IS minutesSince against the stop's
  // own median — the heartbeat recomputes exactly this, so the fixture must
  // not disagree with its own math.
  lastTouchAt: now - minutes * 60_000,
  minutesSince: minutes,
  medianHeadwayOwnSeconds: 600,
  irregularity: state === 'unmonitored' ? null : 0.3,
  expectedWaitSeconds: state === 'void' ? 420 : 300,
  dryness:
    state === 'unmonitored' || state === 'collecting' ? null : (minutes * 60) / 600,
  backToBack: 0,
  routeIds: ['506'],
  coverage: { kind: 'observable', unmonitoredSeconds: 0, since: null },
  ...extra,
});
const VOID_COUNT = 3;
corridor.forEach((feature, index) => {
  const fromEnd = corridor.length - 1 - index;
  const stopId = feature.stopIds[0];
  if (fromEnd < VOID_COUNT) {
    // A rising wave at the corridor's leading edge: 25, 31, 37 minutes dry —
    // dryness 2.5 → 3.7, deeper red stop by stop.
    states.push(stateFor(stopId, 'void', 25 + (VOID_COUNT - 1 - fromEnd) * 6));
  } else if (fromEnd < VOID_COUNT + 2) {
    states.push(stateFor(stopId, 'due', 9 + (fromEnd % 2)));
  } else {
    states.push(stateFor(stopId, 'fresh', 2));
  }
  // The twin direction rides the same track healthy: green, brisk — a
  // one-way wave must paint one stream, never both.
  if (feature.stopIds[1]) {
    states.push(stateFor(feature.stopIds[1], 'fresh', 3, { directionId: 1 }));
  }
});
// A blind stop somewhere else: grey, hatched, never a void.
const otherEdgeFeature =
  [...anchorsByEdge.entries()].find(([edgeId]) => edgeId !== corridorEdge)?.[1][0] ??
  corridor[0];
states.push(
  stateFor(otherEdgeFeature.stopIds[0], 'unmonitored', 12, {
    coverage: { kind: 'outage', unmonitoredSeconds: 720, since: null },
  }),
);
// A subway stop in full void on a subway-route edge (E7S7): subways are
// disabled — it must not paint a single piece anywhere.
const subwayEdge = viewer.edges.find(
  (edge) =>
    edge.routeIds.length > 0 &&
    edge.routeIds.every((routeId) =>
      /^(1|2|4|5|6)$/.test(
        viewer.routes.find((route) => route.id === routeId)?.number ?? '',
      ),
    ),
);
const subwayFeature = subwayEdge
  ? viewer.features.find(
      (feature) =>
        feature.edgeId === subwayEdge.id && feature.distanceAlongMetres !== undefined,
    )
  : undefined;
if (subwayFeature) {
  const subwayNumber =
    viewer.routes.find((route) => route.id === subwayEdge.routeIds[0])?.number ?? '2';
  states.push(
    stateFor(subwayFeature.stopIds[0], 'void', 30, {
      routeIds: [subwayNumber],
    }),
  );
}
const stopsPayload = { schemaVersion: 1, at: now, states };
const statesByStop = new Map(states.map((state) => [state.stopId, state]));
const voidStopId = states.find((state) => state.state === 'void').stopId;
const voidFeature = corridor.find((feature) => feature.stopIds.includes(voidStopId));

// ——— The cross-street sibling (the direction-switch fixture): this map's
// corridor stops ride alone (one boarding point per feature), so script the
// void stop's opposite-side platform fresh — the popup must offer it as a
// one-tap direction switch (the gloved-tap fix).
const SIDE_WORD = /\s*(east|west|north|south)\s+side$/i;
const normName = (name) => name.replace(/\s+/g, ' ').trim();
const voidBase = normName(voidFeature.name).replace(SIDE_WORD, '');
const siblingFeature = viewer.features.find(
  (entry) =>
    entry !== voidFeature &&
    (entry.stopIds?.length ?? 0) > 0 &&
    normName(entry.name).replace(SIDE_WORD, '') === voidBase,
);
if (siblingFeature) {
  const siblingState = stateFor(siblingFeature.stopIds[0], 'fresh', 3, {
    directionId: statesByStop.get(voidStopId).directionId === 0 ? 1 : 0,
  });
  states.push(siblingState);
  // stopsPayload and the expected band both read the live array/map, so the
  // in-page field and the expectation stay one and the same truth.
  statesByStop.set(siblingState.stopId, siblingState);
}

// ——— The multi-route platform (the route-row fixture): a CORRIDOR stop
// (in the camera's view, so the check can drive it) whose state carries
// night twins and several day corridors (raw routeIds 301/304/501/503/
// 504). The popup must read day numbers only ("501 Queen, 503 Kingston
// Rd, 504 King" — 301 and 304 are the same data in night costumes) as
// TEXT, not a switcher: every route here shares the platform, so
// switching would be a button that changes nothing.
const multiRouteFeature = corridor.find(
  (feature) => feature !== voidFeature && feature !== siblingFeature,
);
let multiRouteStopId = null;
if (multiRouteFeature) {
  multiRouteStopId = multiRouteFeature.stopIds[0];
  const multiState = statesByStop.get(multiRouteStopId);
  multiState.routeIds = ['301', '304', '501', '503', '504'];
}

// The expected painted band, from the same pure brain the page uses: every
// piece in edge order with its colour and state. The DOM must match exactly.
const expectedBand = [];
for (const edge of viewer.edges) {
  const segments = edgeServiceSegments(
    edge,
    viewer.features,
    statesByStop,
    serviceConfig(),
  );
  for (const segment of segments) {
    expectedBand.push({
      stroke: drynessColor(segment.dryness, segment.state),
      state: segment.state,
      direction: segment.directionId,
      flow: segment.flowsForward ? 'fwd' : 'rev',
      speed: segment.flowSeconds,
      dryness: segment.dryness,
      edge: edge.id,
    });
  }
}
for (let index = 0; index < expectedBand.length; index += 1) {
  if (String(expectedBand[index].stroke).includes('NaN')) {
    console.error('NaN PIECE at', index, JSON.stringify(expectedBand[index]));
  }
}
assert.ok(
  expectedBand.length >= 10,
  'the scripted corridor must paint at least ten pieces',
);
// Both directions must paint on the shared corridor: a one-way wave rides
// beside a healthy twin stream.
assert.ok(expectedBand.some((piece) => piece.direction === 0 && piece.state === 'void'));
assert.ok(expectedBand.some((piece) => piece.direction === 1 && piece.state === 'fresh'));
// The subway stop in full void paints NOTHING (E7S7) — the band is proof.
if (subwayFeature) {
  assert.ok(
    expectedBand.every((piece) => piece.edge !== subwayFeature.edgeId),
    'a subway-only edge must not appear in the painted band',
  );
}

const historyBuckets = Array.from({ length: 18 }, (_, index) => ({
  bucketStart: now - (18 - index) * 300_000,
  n: 3,
  maxGapSeconds: 640,
  backToBack: index % 6 === 0 ? 1 : 0,
}));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
try {
  // ——— 1. Rollout switch OFF: nothing renders, nothing is even fetched. ———
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await installAccountFixture(context, { signedIn: true });
    let serviceRequests = 0;
    // The overlay's switch is the auth-config `overlay` block now
    // (docs/optimize-overlay.md E2S2) — a later route wins over the
    // fixture's, so this context sees the OFF state.
    await context.route('**/api/v1/auth/config', (route) =>
      route.fulfill({
        json: {
          enabled: true,
          publishableKey: 'pk_test_fixture',
          live: {
            base: '',
            pathTemplate: '/live/t/{tick}/vehicles.json',
            updateSeconds: 30,
          },
          overlay: {
            enabled: false,
            pathTemplate: '/live/t/{tick}/service-stops.json',
            pollSeconds: 30,
          },
        },
      }),
    );
    await context.route('**/api/v1/service/**', (route) => {
      serviceRequests += 1;
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    assert.equal(serviceRequests, 0, 'overlay off must mean zero /service/* requests');
    assert.equal(await page.locator('.service-track').count(), 0);
    assert.equal(await page.locator('.void-marker').count(), 0);
    assert.equal(await page.locator('.service-card').count(), 0);
    await context.close();
  }

  // ——— 2. Switch ON: the field paints the tracks; no chrome until asked. ———
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await installAccountFixture(context, { signedIn: true });
    let serviceStopRequests = 0;
    await context.route('**/live/t/*/service-stops.json', (route) => {
      serviceStopRequests++;
      return route.fulfill({
        json: {
          schemaVersion: 1,
          at: stopsPayload.at,
          tickId: Math.floor(stopsPayload.at / 30_000),
          states: stopsPayload.states,
        },
      });
    });
    await context.route('**/api/v1/service/history**', (route) => {
      const historyStop =
        new URL(route.request().url()).searchParams.get('stop') ?? 'unknown';
      return route.fulfill({
        json: {
          schemaVersion: 1,
          from: now - 36 * 3_600_000,
          to: now,
          summaries: [
            {
              stopId: historyStop,
              n: 54,
              meanHeadwaySeconds: 600,
              irregularity: 0.3,
              maxGapSeconds: 640,
              backToBack: 3,
              distinctVehicles: 21,
              routeIds: ['506'],
              coverageRatio: 1,
              medianApproxSeconds: 590,
              p90ApproxSeconds: 1100,
            },
          ],
          bucketSeries: [{ stopId: historyStop, buckets: historyBuckets }],
        },
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page
      .getByRole('group', { name: 'Live map mode' })
      .getByRole('button', { name: 'Service Overlay' })
      .click();
    await page
      .locator('.service-track')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
    const liveMode = page.getByRole('group', { name: 'Live map mode' });
    await liveMode.getByRole('button', { name: 'Vehicles Only' }).click();
    await page.locator('.service-track').first().waitFor({ state: 'detached' });
    const pausedServiceRequests = serviceStopRequests;
    await page.waitForTimeout(500);
    assert.equal(serviceStopRequests, pausedServiceRequests);
    await liveMode.getByRole('button', { name: 'Service Overlay' }).click();
    await page.locator('.service-track').first().waitFor({ state: 'visible' });

    // The band: graded pieces, the scripted void run painted red with its
    // drifting flow, blind spot greyed — and NO whole-map circles. The DOM
    // must match the brain piece-for-piece: same count, same colours, same
    // states, in the same edge order.
    const domBand = await page.$$eval('.service-track-seg', (elements) =>
      elements.map((element) => ({
        stroke: element.getAttribute('stroke'),
        state: element.getAttribute('data-state'),
        direction: element.getAttribute('data-direction'),
      })),
    );
    // Same piece count and states, in the same order; strokes within a small
    // tolerance — the heartbeat advances the field between the page's render
    // and this snapshot, so a shade may drift a channel or two.
    assert.equal(
      domBand.length,
      expectedBand.length,
      'the painted band equals the field',
    );
    const channel = (stroke) =>
      stroke === null ? [] : (stroke.match(/\d+/g) ?? []).map(Number);
    for (let index = 0; index < expectedBand.length; index += 1) {
      assert.equal(
        domBand[index].state,
        expectedBand[index].state,
        `piece ${index} state`,
      );
      const [r1, g1, b1] = channel(domBand[index].stroke);
      const [r2, g2, b2] = channel(expectedBand[index].stroke);
      assert.ok(
        Math.abs(r1 - r2) <= 4 && Math.abs(g1 - g2) <= 4 && Math.abs(b1 - b2) <= 4,
        `piece ${index} colour: ${domBand[index].stroke} ~= ${expectedBand[index].stroke}`,
      );
    }
    assert.ok(expectedBand.some((piece) => piece.state === 'void'));
    assert.ok(expectedBand.some((piece) => piece.state === 'fresh'));
    assert.ok(expectedBand.some((piece) => piece.state === 'due'));
    assert.ok(expectedBand.some((piece) => piece.state === 'unmonitored'));
    // E5S2 (docs/optimize-overlay.md): at city-wide zoom NO flow dashes
    // render — every piece is shorter on screen than one dash cycle, so the
    // static colour field carries the information (and the battery). The
    // deep flow assertions move below, where selecting a stop zooms the
    // camera to street level and the flows earn their keep.
    assert.equal(
      await page.locator('.service-track-flow').count(),
      0,
      'city-wide zoom: no flow paint — the static field carries the information',
    );
    // The gradient really grades: fresh and void paint different colours.
    assert.notEqual(
      expectedBand.find((piece) => piece.state === 'void').stroke,
      expectedBand.find((piece) => piece.state === 'fresh').stroke,
    );
    // Nothing selected yet: no circles, no card — the map is the UI.
    assert.equal(await page.locator('.void-marker').count(), 0);
    assert.equal(await page.locator('.service-popover').count(), 0);

    // ——— 3. Select a stop (the street test): at the fitted zoom the
    // corridor's platform pair renders as ONE merged dot, and the tap
    // must NOT assume a direction — the story opens directionless (no
    // ring), the rose offers both platforms unpressed, and picking one
    // rings it. A live streetcar can be parked exactly on the platform
    // (the preview stack serves real cars), and the camera's hit-test
    // rightly gives it the tap — so the check drives the feature's own
    // keyboard path (tabindex + Enter) for determinism. The pointer-up
    // hit-test itself is verified by the marker toggle below.
    // Merged pairs render under whichever feature the map's own order
    // picks as the representative (platform-pairs stopDots): drive
    // whichever of the pair the DOM actually renders — the directionless
    // story is the same intersection either way, and the merged card
    // headlines the worst (void) platform.
    let voidDot = null;
    for (const feature of [voidFeature, siblingFeature]) {
      if (!feature) continue;
      const locator = page.locator(`[data-feature="${feature.id}"]`);
      if ((await locator.count()) > 0) {
        voidDot = locator;
        break;
      }
    }
    assert.ok(voidDot, 'the void intersection renders a dot');
    await voidDot.focus();
    await page.keyboard.press('Enter');
    await page.locator('.service-popover').waitFor({ state: 'visible', timeout: 5_000 });
    // The selection zooms the camera to street level (~level 5); wait out
    // the animation and the 150 ms settle debounce, then the flows reappear
    // for every piece long enough on screen — the E5S2 gate in reverse.
    await page.waitForTimeout(1_000);
    const domFlow = await page.$$eval('.service-track-flow', (elements) =>
      elements.map((element) => ({
        fwd: element.classList.contains('service-flow--fwd'),
        rev: element.classList.contains('service-flow--rev'),
        seconds: element.style.animationDuration,
        phase: element.style.getPropertyValue('--dash-start'),
      })),
    );
    assert.ok(domFlow.length > 0, 'street-level zoom: the flows run');
    assert.ok(
      domFlow.every((piece) => piece.phase !== ''),
      'every flow line carries its dash phase',
    );
    const flowPieces = expectedBand.filter((piece) => piece.state !== 'unmonitored');
    assert.ok(
      domFlow.length <= flowPieces.length,
      'flow lines are a subset of the painted band',
    );
    assert.ok(
      domFlow.some((piece) => piece.fwd) && domFlow.some((piece) => piece.rev),
      'both directions flow, each its own way',
    );
    // Speed is the service: the void drifts, the fresh runs brisk.
    const voidSeconds = expectedBand.find(
      (piece) => piece.direction === 0 && piece.state === 'void',
    ).speed;
    const freshSeconds = expectedBand.find(
      (piece) => piece.direction === 1 && piece.state === 'fresh',
    ).speed;
    assert.ok(voidSeconds > freshSeconds, 'void drifts slower than fresh');
    assert.ok(
      domFlow.some((piece) => piece.seconds === `${voidSeconds}s`),
      'a void piece animates at its drift speed',
    );
    assert.ok(
      domFlow.some((piece) => piece.seconds === `${freshSeconds}s`),
      'a fresh piece animates at its brisk speed',
    );
    // Directionless: no ring until the rider picks, and both platforms
    // offered with NONE pressed (the tap made no assumption).
    assert.equal(
      await page.locator('.void-marker').count(),
      0,
      'a merged pair taps into no direction — no ring yet',
    );
    const roseButtons = page.locator('.service-popover .direction-rose button');
    const roseCount = await roseButtons.count();
    assert.ok(roseCount === 0 || roseCount === 2, 'one rose, up to two directions');
    if (roseCount === 2) {
      assert.equal(
        await roseButtons.first().getAttribute('aria-pressed'),
        'false',
        'a directionless tap presses nothing',
      );
      assert.equal(
        await roseButtons.nth(1).getAttribute('aria-pressed'),
        'false',
        'a directionless tap presses nothing',
      );
      // Pick the void platform (West sits left in the pair) so the story
      // below speaks the void's truth.
      await roseButtons.first().click();
    }
    await page
      .locator('.void-marker')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(
      await page.locator('.void-marker').count(),
      1,
      'only the picked direction gets a circle',
    );
    assert.equal(
      await page.locator('.void-marker').getAttribute('data-stop-id'),
      voidStopId,
    );
    const sentence = await page.locator('.service-card__sentence').textContent();
    assert.match(sentence ?? '', /min without a car/);
    assert.match(sentence ?? '', /× the usual/);
    // The fast read (the street test): scan lines for the two numbers a
    // rider needs first, whole minutes, and no dryness jargon on this screen.
    const facts = await page.locator('.service-card__facts').textContent();
    assert.match(facts ?? '', /next car/);
    assert.match(facts ?? '', /last service/);
    assert.match(facts ?? '', /min ago/);
    assert.doesNotMatch(facts ?? '', /dryness/);
    const popup = await page.locator('.service-popover').boundingBox();
    const map = await page.locator('.map-viewport').boundingBox();
    assert.ok(popup && map, 'selected stop popup and map should be visible');
    assert.ok(popup.width <= 281, `popup should stay compact, got ${popup.width}px`);
    assert.ok(
      popup.height <= 245,
      `collapsed popup should stay compact, got ${popup.height}px`,
    );
    assert.ok(popup.x >= map.x && popup.x + popup.width <= map.x + map.width);
    assert.ok(popup.y >= map.y && popup.y + popup.height <= map.y + map.height);
    assert.equal(await page.locator('.service-sparkline:visible').count(), 0);

    // ——— 3a. The route row (the 305-at-noon rule): one corridor serves
    // this platform, so it reads as TEXT in day numbers ("Route 506
    // Carlton" — never the 306 night twin, which is the same data).
    const routeLine =
      (await page.locator('.service-card__route-line').textContent()) ?? '';
    assert.match(
      routeLine,
      /^Route \d{3}/,
      `the route row reads as text: "${routeLine}"`,
    );
    assert.doesNotMatch(
      await page.locator('.service-popover').textContent(),
      /\b306\b/,
      'night twins never appear on the fast-read screen',
    );

    // ——— 3b. The rose never reorders: every direction sits at its own
    // compass position (West left, East right), the pressed one stays
    // where it was, and the sibling is one tap away.
    if (roseCount === 2) {
      const texts = await roseButtons.allTextContents();
      assert.match(texts[0] ?? '', /West/, 'west sits left');
      assert.match(texts[1] ?? '', /East/, 'east sits right');
      const pressedIndex =
        (await roseButtons.first().getAttribute('aria-pressed')) === 'true' ? 0 : 1;
      const before = await page.locator('.service-card').getAttribute('data-stop-id');
      await roseButtons.nth(1 - pressedIndex).click();
      const after = await page.locator('.service-card').getAttribute('data-stop-id');
      assert.notEqual(after, before, 'the rose selects the sibling boarding point');
      await page.locator('.void-marker').first().waitFor({ state: 'visible' });
      assert.equal(
        await page.locator('.void-marker').getAttribute('data-stop-id'),
        after,
        'the ring follows the switched direction',
      );
      // Positions never move: same order, the newly selected one highlighted.
      assert.deepEqual(
        await roseButtons.allTextContents(),
        texts,
        'selection is a highlight, never a reorder',
      );
      assert.equal(
        await roseButtons.nth(1 - pressedIndex).getAttribute('aria-pressed'),
        'true',
        'the pressed button stays where it was',
      );
    }
    await page.locator('.service-card__details summary').click();
    // The day view and legend are available on demand.
    await page
      .locator('.service-sparkline')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });
    const bars = await page.locator('.service-sparkline rect').count();
    assert.ok(bars >= 10, `expected sparkline buckets, got ${bars}`);
    assert.match(
      (await page.locator('.service-popover__legend').textContent()) ?? '',
      /dry/,
    );

    // ——— 3c. The multi-route platform: night twins and several day
    // corridors share one corridor platform, so the route row reads as
    // TEXT with day numbers only — a switcher that changes nothing is a
    // lie. Driven by the keyboard path (focus + Enter) like 3, since the
    // camera may hand a live car the tap.
    if (multiRouteFeature) {
      await page.locator('.void-marker').click();
      await page.waitForTimeout(200);
      // The same merged-pair rule as 3: drive whichever of the platform's
      // pair the DOM renders as the representative dot.
      const multiTwin = twinFeature(multiRouteFeature, viewer.features);
      let multiDot = null;
      for (const feature of [multiRouteFeature, multiTwin]) {
        if (!feature) continue;
        const locator = page.locator(`[data-feature="${feature.id}"]`);
        if ((await locator.count()) > 0) {
          multiDot = locator;
          break;
        }
      }
      assert.ok(multiDot, 'the multi-route platform renders a dot');
      await multiDot.focus();
      await page.keyboard.press('Enter');
      await page
        .locator('.service-popover')
        .waitFor({ state: 'visible', timeout: 5_000 });
      const multiPopup = (await page.locator('.service-popover').textContent()) ?? '';
      // Day numbers only, however they render (text when every route shares
      // the platform, a switcher when one lands across the intersection).
      assert.match(multiPopup, /50[134]/, 'day routes listed');
      assert.doesNotMatch(multiPopup, /\b30[145]\b/, 'night twins fold into day numbers');
      // Both platforms of the corridor pair are monitored, so at this zoom
      // the merged dot opens directionless: nothing pressed, no ring.
      assert.equal(
        await page.locator('.void-marker').count(),
        0,
        'a merged pair taps into no direction',
      );
      const multiRose = page.locator('.service-popover .direction-rose button');
      const multiRoseCount = await multiRose.count();
      assert.ok(
        multiRoseCount === 0 || multiRoseCount === 2,
        'one rose, up to two directions',
      );
      if (multiRoseCount === 2) {
        assert.equal(
          await multiRose.first().getAttribute('aria-pressed'),
          'false',
          'the directionless rose presses nothing',
        );
      }
    }
    // Narrow-viewport layout (the phone street test): the open card must
    // stay inside the map on a phone — so the card closes only AFTER these
    // assertions, not before (the chip IS the close button).
    await page.setViewportSize({ width: 390, height: 620 });
    const narrowPopup = await page.locator('.service-popover').boundingBox();
    const narrowMap = await page.locator('.map-viewport').boundingBox();
    assert.ok(narrowPopup && narrowMap, 'popup and map should remain visible on phones');
    assert.ok(narrowPopup.x >= narrowMap.x);
    assert.ok(narrowPopup.x + narrowPopup.width <= narrowMap.x + narrowMap.width);
    assert.ok(narrowPopup.y + narrowPopup.height <= narrowMap.y + narrowMap.height);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('.service-card__bar .chip').click();

    // ——— 4. Tap the ring: deselect — back to a clean map. ———
    // 3c ends with the card closed and nothing picked — a directionless
    // merged pair carries no ring — so re-open the intersection, press a
    // platform to ring it, and only then toggle the ring off.
    await voidDot.focus();
    await page.keyboard.press('Enter');
    await page.locator('.service-popover').waitFor({ state: 'visible', timeout: 5_000 });
    const roseButtons4 = page.locator('.service-popover .direction-rose button');
    if ((await roseButtons4.count()) > 0) {
      await roseButtons4.first().click();
      await page.locator('.void-marker').waitFor({ state: 'visible', timeout: 5_000 });
    }
    await page.locator('.void-marker').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.void-marker').count(), 0);
    assert.equal(await page.locator('.service-popover').count(), 0);

    // ——— 5. Select a different stop: the story follows. The merged dot
    // opens directionless and headlines the WORST platform of the pair
    // (the field's shared-position rule) — here the due one — before any
    // direction is picked; picking one rings it.
    const dueFeature = corridor.find(
      (feature) =>
        feature.stopIds[0] === states.find((state) => state.state === 'due')?.stopId,
    );
    await page.locator(`[data-feature="${dueFeature.id}"]`).click();
    await page.locator('.service-popover').waitFor({ state: 'visible', timeout: 5_000 });
    assert.match(
      (await page.locator('.service-card__sentence').textContent()) ?? '',
      /you've waited/,
    );
    const dueRose = page.locator('.service-popover .direction-rose button');
    if ((await dueRose.count()) === 2) {
      await dueRose.first().click();
      await page
        .locator('.void-marker')
        .first()
        .waitFor({ state: 'visible', timeout: 5_000 });
    }

    // ——— 6. The snail slime, when a live car cooperates: any trail that
    // renders must be fresh green behind the car (the preview serves real
    // vehicles, so a car on a scripted edge is not guaranteed — the trail
    // math itself is unit-tested; here we verify what renders is honest).
    const trails = await page.$$eval('.service-trail-seg', (elements) =>
      elements.map((element) => element.getAttribute('stroke')),
    );
    for (const stroke of trails) assert.equal(stroke, '#2f9e6e');

    // ——— 6b. Subways are disabled (E7S7): selecting the subway stop in
    // full void opens NO card and paints no marker — not even a blind one.
    if (subwayFeature) {
      await page
        .locator('.void-marker')
        .click()
        .catch(() => {});
      await page.locator(`[data-feature="${subwayFeature.id}"]`).focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      assert.equal(
        await page.locator('.void-marker').count(),
        0,
        'a subway stop never gets a service marker',
      );
      assert.equal(
        await page.locator('.service-popover').count(),
        0,
        'a subway stop never opens a story card',
      );
    }

    // ——— 6c. The snake game never shows the overlay (E7S7): the game
    // renders its own map with no service props, and the base layer is
    // hard-suspended while it is open — no field, no marker, no card, and
    // not one extra /service/* request while playing.
    let requestsWhileSnake = 0;
    const snakeListener = (request) => {
      if (request.url().includes('/api/v1/service/')) requestsWhileSnake += 1;
    };
    page.on('request', snakeListener);
    // The independent-site notice can cover the map tools — dismiss it.
    const notice = page.locator('.affiliation-notice .action-button');
    if (await notice.count()) await notice.click();
    await page.locator('.snake-launch').click();
    await page.waitForTimeout(1_500);
    assert.equal(await page.locator('.service-track').count(), 0, 'no field in the game');
    assert.equal(await page.locator('.void-marker').count(), 0, 'no marker in the game');
    assert.equal(
      await page.locator('.service-popover').count(),
      0,
      'no card in the game',
    );
    // Stop counting BEFORE closing: after the game, the layer legitimately
    // wakes and refetches — while the game was open, zero is the rule.
    page.off('request', snakeListener);
    const duringSnake = requestsWhileSnake;
    await page
      .getByRole('button', { name: 'Close Streetcar Snake' })
      .click({ timeout: 10_000 });
    await page.waitForTimeout(800);
    assert.equal(duringSnake, 0, 'zero /service/* requests while the game was open');
    // Back on the map, the service returns.
    await page
      .locator('.service-track')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });

    // ——— 7. The map still behaves: zoom works with the field painted. ———
    await page.locator('#map').hover();
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(250);
    // Since E5S1 the painted field culls to the viewport: after a zoom-in
    // the count can fall BELOW the whole-corridor band — the honest
    // assertion is that the field still paints (and the band equality at
    // the fitted zoom is already asserted in section 2).
    assert.ok(
      (await page.locator('.service-track-seg').count()) > 0,
      'the field still paints after the zoom',
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('check-service: PASS — track field, gating, selection story, honesty');
} finally {
  await browser.close();
}
