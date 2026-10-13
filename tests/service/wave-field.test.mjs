import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

// The field-on-the-track brain (wave-field.ts): gradient anchors, the
// continuous colour ramp, per-edge interpolation, plain sentences, and the
// heartbeat. Pure functions, so the painted band, the marker, and the card
// all speak with one mind — and this file holds them to it.
const {
  stopSentence,
  STATE_COLORS,
  advanceStopState,
  drynessColor,
  edgeServiceSegments,
  carTrailSegments,
  isSubwayOnlyStop,
  surfaceStatesByStop,
  dayRouteNumber,
  platformRoutes,
  platformCompass,
  platformCompassKey,
  platformDirectionLabel,
  intersectionStreets,
  routeOptions,
  directionSiblings,
  directionOptions,
  nextStopChangeMs,
  earliestDeadlineMs,
  trackFieldSignature,
  visibleStopsOf,
  visibleEdgesOf,
} = await compileModules(`export * from './web/ui/features/service/wave-field';`);
const shared = await compileModules(`
  export { serviceStatesAt } from './shared/service/wait-metrics';
  export { serviceConfig } from './shared/service/config';
  export { scenarioById } from './shared/service/fixtures';
`);

const config = shared.serviceConfig();
const oneWay = shared.scenarioById('one-way-void');
const statesByStop = new Map(
  [
    ...shared
      .serviceStatesAt(oneWay.touches, oneWay.coverage, {
        windowStart: oneWay.windowStart,
        at: oneWay.at,
        config,
      })
      .values(),
  ].map((state) => [state.stopId, state]),
);

// A straight 200 m track: two stops — fresh at 50 m, void at 150 m — and the
// field must grade green → amber → red between them, red deepening past the
// void horizon.
const edge = {
  id: 'edge:test',
  a: 'a',
  b: 'b',
  routeIds: ['506'],
  sourcePoints: [
    [0, 0],
    [100, 0],
    [200, 0],
  ],
  points: [
    [0, 0],
    [100, 0],
    [200, 0],
  ],
  sourceDistances: [0, 100, 200],
  lengthMetres: 200,
  infrastructureIds: [],
};
const featureAt = (stopId, distance, dryness, state) => ({
  id: `f:${stopId}`,
  name: stopId,
  kind: 'stop',
  point: [distance, 0],
  routeIds: ['506'],
  accessible: null,
  boardingPoints: 1,
  platformNames: [stopId],
  destinations: {},
  replacementRouteIds: [],
  stopIds: [stopId],
  edgeId: 'edge:test',
  distanceAlongMetres: distance,
  ...(dryness === null ? {} : { drynessHint: dryness, stateHint: state }),
});
const stopState = (stopId, dryness, state, extra = {}) => ({
  stopId,
  directionId: 0,
  state,
  lastTouchAt: oneWay.at - 60_000,
  minutesSince: 1,
  medianHeadwayOwnSeconds: 600,
  irregularity: 0,
  expectedWaitSeconds: 300,
  dryness,
  backToBack: 0,
  routeIds: ['506'],
  coverage: { kind: 'observable', unmonitoredSeconds: 0, since: null },
  ...extra,
});

test('the field grades the track between stop anchors', () => {
  const states = new Map([
    ['st_a', stopState('st_a', 0.1, 'fresh')],
    ['st_b', stopState('st_b', 2.6, 'void')],
  ]);
  const features = [featureAt('st_a', 50), featureAt('st_b', 150)];
  const segments = edgeServiceSegments(edge, features, states, config, 0);
  assert.equal(segments.length, 2);
  // Midpoint of piece [0,100] is 50 m → the fresh anchor: green-ish.
  assert.equal(segments[0].state, 'fresh');
  assert.ok((segments[0].dryness ?? 0) < 0.5);
  // Midpoint of [100,200] is 150 m → the void anchor: red.
  assert.equal(segments[1].state, 'void');
  assert.ok(segments[1].dryness > 2);
  // And between the two anchors the ramp passes through amber territory.
  const mid = drynessColor(1.5);
  assert.ok(mid.startsWith('rgb('), 'interpolated colours are continuous');
  assert.notEqual(mid, STATE_COLORS.fresh);
  assert.notEqual(mid, STATE_COLORS.void);
});

test('blind stretches grey out per direction and never fabricate', () => {
  // A blind stop next to a fresh one (same direction): the stretch holds the
  // visible value, and an all-blind stretch greys.
  const states = new Map([
    ['st_fresh', stopState('st_fresh', 0.1, 'fresh')],
    [
      'st_blind',
      stopState('st_blind', null, 'unmonitored', {
        coverage: { kind: 'outage', unmonitoredSeconds: 900, since: oneWay.at - 900_000 },
      }),
    ],
  ]);
  const features = [featureAt('st_fresh', 40), featureAt('st_blind', 160)];
  const segments = edgeServiceSegments(edge, features, states, config, 0);
  assert.equal(segments.length, 2);
  // Piece [100,200] midpoint 150 sits between fresh(40) and blind(160):
  // the visible side holds — never a fabricated verdict.
  assert.ok(['fresh', 'due'].includes(segments[1].state));
  // Both blind → the stretch is unmonitored, hatched, never void.
  const bothBlind = new Map([['st_blind', states.get('st_blind')]]);
  const blindSegments = edgeServiceSegments(
    edge,
    [featureAt('st_blind', 50)],
    bothBlind,
    config,
  );
  assert.ok(blindSegments.every((segment) => segment.state === 'unmonitored'));
  // A direction with no anchored stops paints nothing at all — the other
  // direction keeps its own stream, untouched.
  const singleDirection = new Map([['st_e', stopState('st_e', 0.2, 'fresh')]]);
  const oneSided = edgeServiceSegments(
    edge,
    [{ ...featureAt('st_e', 50), stopIds: ['st_e', 'st_w'] }],
    singleDirection,
    config,
  );
  assert.ok(oneSided.every((segment) => segment.directionId === 0));
  assert.equal(oneSided.filter((segment) => segment.directionId === 1).length, 0);
});

test('edges without service anchors paint nothing (no data, no opinion)', () => {
  assert.equal(
    edgeServiceSegments(edge, [featureAt('st_none', 50)], new Map(), config, 0).length,
    0,
  );
  const noAnchor = { ...featureAt('st_a', 50) };
  delete noAnchor.edgeId;
  assert.equal(
    edgeServiceSegments(
      edge,
      [noAnchor],
      new Map([['st_a', stopState('st_a', 1, 'due')]]),
      config,
      0,
    ).length,
    0,
  );
});

test('long stretches subdivide so the gradient bends along the track', () => {
  const states = new Map([
    ['st_a', stopState('st_a', 0.1, 'fresh')],
    ['st_b', stopState('st_b', 2.6, 'void')],
  ]);
  const features = [featureAt('st_a', 50), featureAt('st_b', 150)];
  // Subdivision ON (the default): the 100-unit pieces split at 24 units, so
  // each direction paints ~10 pieces whose colours step smoothly from the
  // fresh anchor to the void anchor.
  const segments = edgeServiceSegments(edge, features, states, config);
  const east = segments.filter((segment) => segment.directionId === 0);
  assert.ok(east.length > 4, `expected subdivided pieces, got ${east.length}`);
  const strokes = new Set(
    east.map((segment) => drynessColor(segment.dryness, segment.state)),
  );
  assert.ok(
    strokes.size >= 3,
    `expected a bending gradient, got ${strokes.size} colours`,
  );
  // The dash phase advances with distance so the flow has no seams: phases
  // are non-negative and below the cycle, and they vary along the stretch.
  const phases = east.map((segment) => segment.phase);
  assert.ok(phases.every((phase) => phase >= 0 && phase < 28));
  assert.ok(new Set(phases).size > 1, 'phases advance along the route');
});

test('the snail slime: a car drags fresh green from its head back to the last stop', () => {
  const states = new Map([
    ['st_a', stopState('st_a', 0.1, 'fresh')],
    ['st_b', stopState('st_b', 2.6, 'void')],
    ['st_b_w', stopState('st_b_w', 0.3, 'fresh', { directionId: 1 })],
  ]);
  const features = [
    featureAt('st_a', 50),
    { ...featureAt('st_b', 150), stopIds: ['st_b', 'st_b_w'] },
  ];
  const carAt = (direction, distanceAlongMetres, stale = false) => ({
    vehicle: { id: '4410' },
    point: [distanceAlongMetres, 0],
    angle: 0,
    stale,
    match: { edgeId: edge.id, direction, distanceAlongMetres },
  });
  // A forward car at 120 m: the last stop behind it is st_a at 50 — the
  // slime covers [50, 120] on the direction-0 stream, fresh and brisk.
  const trail = carTrailSegments(edge, carAt(1, 120), features, states);
  assert.equal(trail.length, 2); // [50,100] and [100,120]
  assert.ok(trail.every((segment) => segment.state === 'fresh' && segment.dryness === 0));
  assert.ok(trail.every((segment) => segment.flowsForward));
  assert.equal(trail[0].flowSeconds, 1.6);
  // The trail rides the direction-0 side of the rail (same offset sign as
  // the field's direction-0 stream).
  assert.ok(trail.every((segment) => segment.directionId === 0));
  // A reversed car at 120 m on direction 1: the last stop behind it is
  // st_b_w at 150 — the slime covers [120, 150], flowing backwards.
  const rev = carTrailSegments(edge, carAt(-1, 120), features, states);
  assert.equal(rev.length, 1); // [120,150]
  assert.ok(rev.every((segment) => segment.state === 'fresh'));
  assert.ok(rev.every((segment) => !segment.flowsForward));
  assert.ok(rev.every((segment) => segment.directionId === 1));
  // Before the first stop: no slime (nothing serviced behind it yet).
  assert.equal(carTrailSegments(edge, carAt(1, 30), features, states).length, 0);
  // Unmatched or stale cars leave nothing; other edges leave nothing.
  assert.equal(
    carTrailSegments(
      edge,
      { vehicle: { id: 'x' }, point: [0, 0], angle: 0, stale: false },
      features,
      states,
    ).length,
    0,
  );
  assert.equal(carTrailSegments(edge, carAt(1, 120, true), features, states).length, 0);
  const otherEdge = { ...edge, id: 'edge:other' };
  assert.equal(carTrailSegments(otherEdge, carAt(1, 120), features, states).length, 0);
});

test('the colour ramp: fresh at 0, amber at 1, full red at the void horizon, grey when blind', () => {
  assert.equal(drynessColor(0), STATE_COLORS.fresh);
  assert.equal(drynessColor(1), STATE_COLORS.due);
  assert.equal(drynessColor(2), STATE_COLORS.void);
  assert.equal(drynessColor(null), STATE_COLORS.unmonitored);
  assert.equal(drynessColor(0.4, 'collecting'), STATE_COLORS.collecting);
  // Monotonic through the middle: no banding surprises.
  const r05 = drynessColor(0.5);
  const r15 = drynessColor(1.5);
  assert.notEqual(r05, r15);
});

test('the heartbeat: a stop crosses fresh → due → void at the true moment, between ticks', () => {
  const scenario = shared.scenarioById('night-and-day');
  const night = shared
    .serviceStatesAt(scenario.touches, scenario.coverage, {
      windowStart: scenario.windowStart,
      at: scenario.at,
      config,
    })
    .get('st_night');
  assert.equal(night.state, 'due');
  const advanced = advanceStopState(night, 660_000);
  assert.equal(advanced.state, 'void');
  assert.equal(Math.round(advanced.minutesSince * 10) / 10, 21);
  assert.ok(advanced.dryness !== null && advanced.dryness > 2);
  // The estimate (R(e)) and the baseline stay from the tick — they are
  // numbers about gaps, not clocks.
  assert.equal(advanced.expectedWaitSeconds, night.expectedWaitSeconds);
  assert.equal(advanced.medianHeadwayOwnSeconds, night.medianHeadwayOwnSeconds);
  // Negative or zero advance changes nothing (identity, no thrash).
  assert.equal(advanceStopState(night, 0), night);
  assert.equal(advanceStopState(night, -5_000), night);
});

test('the heartbeat never advances a blind spot or a collecting stop into a verdict', () => {
  const scenario = shared.scenarioById('outage-live');
  const silent = shared
    .serviceStatesAt(scenario.touches, scenario.coverage, {
      windowStart: scenario.windowStart,
      at: scenario.at,
      config,
    })
    .get('st_silent');
  const advanced = advanceStopState(silent, 3_600_000);
  assert.equal(advanced.state, 'unmonitored');
  assert.equal(advanced.minutesSince, silent.minutesSince);
});

test('the sentences say the numbers — grandma reads the truth', () => {
  const voided = statesByStop.get('st_void_1');
  const sentence = stopSentence(voided, 'Bathurst');
  assert.match(sentence, /Bathurst: 18\.5 min without a car/);
  assert.match(sentence, /usually every 5\.8 min/);
  assert.match(sentence, /3\.2× the usual/);
  const fresh = shared.scenarioById('clockwork');
  const clockStates = shared.serviceStatesAt(fresh.touches, fresh.coverage, {
    windowStart: fresh.windowStart,
    at: fresh.at,
    config,
  });
  assert.match(stopSentence(clockStates.get('st_clock'), 'St Clair'), /just serviced/);
  const silentStates = shared.serviceStatesAt(
    shared.scenarioById('outage-live').touches,
    shared.scenarioById('outage-live').coverage,
    {
      windowStart: shared.scenarioById('outage-live').windowStart,
      at: shared.scenarioById('outage-live').at,
      config,
    },
  );
  assert.match(
    stopSentence(silentStates.get('st_silent'), 'Silent'),
    /can't see this stop/,
  );
});

test('subways are disabled: subway-only stops never anchor anything (E7S7)', () => {
  const subway = (stopId) => stopState(stopId, 2.6, 'void', { routeIds: ['2'] });
  const bloorYonge = stopState('st_by', 2.6, 'void', { routeIds: ['2', '506'] });
  const surface = new Map([
    ['st_a', stopState('st_a', 0.1, 'fresh')],
    ['st_sub', subway('st_sub')],
    ['st_sub2', stopState('st_sub2', 3, 'void', { routeIds: ['1', '2'] })],
  ]);
  const filtered = surfaceStatesByStop(surface);
  assert.ok(!filtered.has('st_sub'), 'a subway-only stop drops');
  assert.ok(!filtered.has('st_sub2'), 'two subway routes still drop');
  assert.ok(filtered.has('st_a'), 'a streetcar stop stays');
  // A shared stop (streetcar + subway) keeps its truth.
  const shared = new Map([
    ['st_by', bloorYonge],
    ['st_a', stopState('st_a', 0.1, 'fresh')],
  ]);
  assert.ok(surfaceStatesByStop(shared).has('st_by'));
  // And with subway anchors gone, their edges paint nothing: an edge whose
  // only stops are subway-only yields no segments in either direction.
  const states = new Map([['st_sub', subway('st_sub')]]);
  const features = [featureAt('st_sub', 100)];
  assert.equal(edgeServiceSegments(edge, features, states, config, 0).length, 0);
  // No routeIds = not classified as subway-only (unknown keeps showing —
  // the recorder serves routeIds, but a defensive default keeps honesty).
  const unknown = stopState('st_x', 2.6, 'void', { routeIds: [] });
  assert.equal(isSubwayOnlyStop(unknown), false);
});

test('the state ramp keeps fresh and void distinct beyond hue alone', () => {
  const luminance = (hex) => {
    const value = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  assert.ok(luminance(STATE_COLORS.fresh) - luminance(STATE_COLORS.void) > 0.1);
  assert.notEqual(STATE_COLORS.unmonitored, STATE_COLORS.void);
});

// ——— The two switchers: Route first, then Direction ——————————————————

test('night 3xx twins fold into their 5xx day numbers — 305 never shows at noon', () => {
  assert.equal(dayRouteNumber('305'), '505');
  assert.equal(dayRouteNumber('301'), '501');
  assert.equal(dayRouteNumber('505'), '505');
  assert.equal(dayRouteNumber('510'), '510');
  const routes = [
    { id: '301', number: '301', name: 'Queen' },
    { id: '305', number: '305', name: 'Dundas' },
    { id: '501', number: '501', name: 'Queen' },
    { id: '505', number: '505', name: 'Dundas' },
  ];
  // Day and night share the platform: one badge, day number, day name.
  const badges = platformRoutes(['301', '501', '503'], routes);
  assert.deepEqual(
    badges.map((badge) => [badge.number, badge.name]),
    [
      ['501', 'Queen'],
      ['503', ''],
    ],
  );
  // A platform serving only the night twin still reads as its day number.
  assert.equal(platformRoutes(['305'], routes)[0]?.number, '505');
});

test('intersections hash by street pair, both name orders and side suffixes', () => {
  assert.deepEqual(intersectionStreets('Queen St West at Spadina Ave'), [
    'queen st west',
    'spadina ave',
  ]);
  // The crossing corridor writes its platforms the other way around.
  assert.deepEqual(intersectionStreets('Spadina Ave at Queen St West'), [
    'queen st west',
    'spadina ave',
  ]);
  // Whitespace and the platform's side word never count.
  assert.deepEqual(intersectionStreets('King St West  at John St West Side'), [
    'john st',
    'king st west',
  ]);
  // Terminals and loops have no cross street: never grouped.
  assert.equal(intersectionStreets('Long Branch Loop'), null);
});

test('compass labels come from real bearings, never guesses', () => {
  // Two platforms 1.1 km apart along an east-west street: the later stop
  // bears ~90° (east) from the first — travel is eastbound.
  const geoFeatures = [
    {
      ...featureAt('st_e', 0),
      stopIds: ['st_e'],
      geographicPoints: [
        { stopId: 'st_e', latitude: 43.6532, longitude: -79.39, accessible: null },
      ],
    },
    {
      ...featureAt('st_w', 0),
      stopIds: ['st_w'],
      geographicPoints: [
        { stopId: 'st_w', latitude: 43.6532, longitude: -79.4, accessible: null },
      ],
    },
  ];
  const pattern = { stopIds: ['st_w', 'st_e'], directionId: 0 };
  const reverse = { stopIds: ['st_e', 'st_w'], directionId: 1 };
  const eastbound = stopState('st_w', 0.1, 'fresh');
  assert.deepEqual(platformCompass(eastbound, geoFeatures, [pattern]), {
    text: 'East',
    arrow: '→',
  });
  // The reverse pattern is westbound — the pattern's stop order is the
  // only truth.
  const westbound = stopState('st_e', 0.1, 'fresh', { directionId: 1 });
  assert.deepEqual(platformCompass(westbound, geoFeatures, [pattern, reverse]), {
    text: 'West',
    arrow: '←',
  });
  // No coordinates, no verdict: null, and the caller falls back.
  assert.equal(platformCompass(eastbound, [featureAt('st_w', 0)], [pattern]), null);
  // No pattern either: null even with coordinates.
  assert.equal(platformCompass(eastbound, geoFeatures, []), null);
});

test('route options span the intersection; shared platforms are not switchers', () => {
  const routes = [
    { id: '501', number: '501', name: 'Queen' },
    { id: '510', number: '510', name: 'Spadina' },
    { id: '310', number: '310', name: 'Spadina' },
  ];
  // Queen crosses Spadina: the 501 platform and the 510 platform name the
  // same intersection in both orders, side suffixes included.
  const queenSide = {
    ...featureAt('st_q', 50),
    name: 'Queen St West at Spadina Ave West Side',
    stopIds: ['st_q'],
  };
  const spadinaSide = {
    ...featureAt('st_s', 50),
    name: 'Spadina Ave at Queen St West South Side',
    stopIds: ['st_s'],
  };
  const selected = stopState('st_q', 0.1, 'fresh', { routeIds: ['501'] });
  const spadinaState = stopState('st_s', 0.1, 'fresh', {
    directionId: 0,
    routeIds: ['310', '510'],
  });
  const states = new Map([
    ['st_q', selected],
    ['st_s', spadinaState],
  ]);
  const options = routeOptions(selected, [queenSide, spadinaSide], states, routes);
  // Both corridors offered in day numbers; the night 310 twin folded.
  assert.deepEqual(
    options.map((option) => option.number),
    ['501', '510'],
  );
  const jump = options.find((option) => option.number === '510');
  assert.equal(jump?.stopId, 'st_s', 'the 510 button lands on the Spadina platform');
  // Direction siblings are ROUTE-scoped: the 501 rider is never offered
  // 510's platform as a "direction" — pick 510 above first, and only then
  // does the rose speak Spadina's directions.
  assert.deepEqual(
    directionSiblings(selected, [queenSide, spadinaSide], states).map(
      (sibling) => sibling.stopId,
    ),
    [],
    'crossing corridors are routes to jump to, never directions',
  );
  // The Spadina platform's own opposite-direction twin (same intersection
  // name, shared day route): the honest sibling.
  const spadinaNorth = stopState('st_sn', 0.1, 'fresh', {
    directionId: 1,
    routeIds: ['310'],
  });
  const withTwin = new Map(states);
  withTwin.set('st_sn', spadinaNorth);
  assert.deepEqual(
    directionSiblings(
      spadinaState,
      [
        queenSide,
        spadinaSide,
        {
          ...featureAt('st_sn', 50),
          name: 'Spadina Ave at Queen St West North Side',
          stopIds: ['st_sn'],
        },
      ],
      withTwin,
    ).map((sibling) => sibling.stopId),
    ['st_sn'],
    'the 510 rider gets the Spadina twin, not the Queen platform',
  );
  // Labels come from the headsign's own compass word when there are no
  // coordinates — never the raw headsign (route numbers, night twins
  // included, stay folded).
  const withHeadsigns = [
    {
      stopIds: ['st_sn'],
      headsign: 'North - 310 Spadina towards Bloor',
      directionId: 1,
    },
    {
      stopIds: ['st_s'],
      headsign: 'South - 310 Spadina towards Queen',
      directionId: 0,
    },
  ];
  const directions = directionOptions(
    spadinaState,
    [
      queenSide,
      spadinaSide,
      {
        ...featureAt('st_sn', 50),
        name: 'Spadina Ave at Queen St West North Side',
        stopIds: ['st_sn'],
      },
    ],
    withTwin,
    withHeadsigns,
  );
  assert.deepEqual(
    directions.map((option) => [option.stopId, option.label]),
    [['st_sn', '↑ North']],
  );
  // The compass KEY for the rose places it top; the selected platform's
  // key is south — the vertical pair.
  assert.equal(
    platformCompassKey(spadinaState, [queenSide, spadinaSide], withHeadsigns),
    'south',
  );
  assert.equal(
    platformCompassKey(spadinaNorth, [queenSide, spadinaSide], withHeadsigns),
    'north',
  );
  // Without any honest source at all: null key, plain directionId label —
  // the caller falls back, never guesses a position.
  assert.equal(platformCompassKey(spadinaState, [queenSide, spadinaSide], []), null);
  assert.equal(
    platformDirectionLabel(spadinaState, [queenSide, spadinaSide], []),
    'direction 0',
  );
  // Same-direction platforms never offer as directions (an eastbound
  // duplicate would be a lie of a switch).
  const sameDirection = stopState('st_s2', 0.2, 'fresh', {
    directionId: 0,
    routeIds: ['310'],
  });
  const withSameTwin = new Map(withTwin);
  withSameTwin.set('st_s2', sameDirection);
  assert.deepEqual(
    directionSiblings(
      spadinaState,
      [
        queenSide,
        spadinaSide,
        {
          ...featureAt('st_sn', 50),
          name: 'Spadina Ave at Queen St West North Side',
          stopIds: ['st_sn'],
        },
        {
          ...featureAt('st_s2', 50),
          name: 'Spadina Ave at Queen St West South Side',
          stopIds: ['st_s2'],
        },
      ],
      withSameTwin,
    ).map((sibling) => sibling.stopId),
    ['st_sn'],
  );
});

// ---------------------------------------------------------------------------
// The engine (docs/optimize-overlay.md E4S2): deadlines, not a metronome.
// Every wake must land exactly when something the renderer paints changes.
// ---------------------------------------------------------------------------

const liveStop = (overrides = {}) => ({
  stopId: 'st_engine',
  directionId: 0,
  state: 'due',
  lastTouchAt: 0,
  minutesSince: 5,
  medianHeadwayOwnSeconds: 300,
  irregularity: 0.2,
  expectedWaitSeconds: 200,
  dryness: 1,
  backToBack: 0,
  routeIds: ['506'],
  coverage: null,
  ...overrides,
});

const quantised = (dryness) => Math.round(dryness / 0.25) * 0.25;
const signatureOf = (state) => `${quantised(state.dryness)}:${state.state}`;
/** Millisecond deadlines are float products — compare within clock noise. */
const nearMs = (actual, expected) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `expected ~${expected} ms, got ${actual}`,
  );

test('E4S2: the deadline is the next quantisation midpoint the signature flips at', () => {
  // dryness 1.0, median 300 s: the signature (Math.round(d·4)/4) flips at
  // 1.125, which is (1.125 − 1)·300·1000 ms away.
  nearMs(nextStopChangeMs(liveStop(), config), 0.125 * 300 * 1000);
  // Mid-step, dryness 1.1: the same midpoint is only 7.5 s away.
  nearMs(
    nextStopChangeMs(liveStop({ minutesSince: 5.5, dryness: 1.1 }), config),
    0.025 * 300 * 1000,
  );
});

test('E4S2: the state boundary wins when it is closer than the midpoint', () => {
  // dryness 1.9: the due→void boundary (2.0) is 30 s away; the next midpoint
  // (2.125) is 67.5 s away — the boundary is the visible change.
  nearMs(
    nextStopChangeMs(liveStop({ minutesSince: 9.5, dryness: 1.9 }), config),
    0.1 * 300 * 1000,
  );
  // An off-grid boundary (a custom config) fires between midpoints and the
  // deadline engine still finds it.
  const offGrid = { ...config, voidDrynessRatio: 1.95 };
  nearMs(
    nextStopChangeMs(liveStop({ minutesSince: 9.5, dryness: 1.9 }), offGrid),
    0.05 * 300 * 1000,
  );
  // A fresh stop heads for the fresh→due boundary (0.5), but the nearer
  // midpoint (0.375) is the first visible change.
  const fresh = liveStop({ state: 'fresh', minutesSince: 1.5, dryness: 0.3 });
  nearMs(nextStopChangeMs(fresh, config), 0.075 * 300 * 1000);
});

test('E4S2: the absolute void horizon can fire before the ratio does', () => {
  // Median 20 min, waited 14.8 min: dryness 0.74 (due), but the 15-minute
  // absolute crossing is 12 s away — the state flips void at the true
  // moment, not at the ratio.
  const longHeadway = liveStop({
    state: 'due',
    medianHeadwayOwnSeconds: 1200,
    minutesSince: 14.8,
    dryness: 0.74,
  });
  nearMs(nextStopChangeMs(longHeadway, config), 0.2 * 60_000);
});

test('E4S2: blind and collecting stops never schedule', () => {
  assert.equal(
    nextStopChangeMs(
      liveStop({ state: 'unmonitored', minutesSince: null, dryness: null }),
      config,
    ),
    Infinity,
  );
  assert.equal(
    nextStopChangeMs(liveStop({ state: 'collecting', dryness: null }), config),
    Infinity,
  );
  // A stop with no baseline has no dryness growth to schedule.
  assert.equal(
    nextStopChangeMs(liveStop({ medianHeadwayOwnSeconds: null, dryness: null }), config),
    Infinity,
  );
});

test('E4S2: an open card wakes at the next 0.1-minute label crossing', () => {
  const withCard = liveStop({ minutesSince: 5.05, dryness: 1.01 });
  // The midpoint (1.125) is 34.5 s away; the label crossing (5.1 min) is 3 s.
  nearMs(nextStopChangeMs(withCard, config, true), 0.05 * 60_000);
  // Without the card the label is not a visible change.
  nearMs(nextStopChangeMs(withCard, config, false), 0.115 * 300 * 1000);
});

test('E4S2: the earliest deadline across stops, with the card pinned to its stop', () => {
  const states = new Map([
    ['st_a', liveStop({ stopId: 'st_a', minutesSince: 5.5, dryness: 1.1 })],
    ['st_b', liveStop({ stopId: 'st_b', minutesSince: 9.9, dryness: 1.98 })],
    [
      'st_blind',
      liveStop({
        stopId: 'st_blind',
        state: 'unmonitored',
        minutesSince: null,
        dryness: null,
      }),
    ],
  ]);
  // st_b's void boundary is 6 s away; st_a's midpoint is 7.5 s; blind never.
  nearMs(earliestDeadlineMs(states, { config }), 0.02 * 300 * 1000);
  // Pin the card to st_b with its label closer than everything else.
  const cardStates = new Map(states);
  cardStates.set(
    'st_b',
    liveStop({ stopId: 'st_b', minutesSince: 9.94, dryness: 1.988 }),
  );
  nearMs(
    earliestDeadlineMs(cardStates, { config, selectedStopId: 'st_b' }),
    0.06 * 60_000,
  );
});

test('E4S2: waking exactly at the deadline changes the quantised field; a moment earlier does not', () => {
  const stop = liveStop({ minutesSince: 5.1, dryness: 1.02 });
  const deadline = nextStopChangeMs(stop, config);
  assert.equal(signatureOf(advanceStopState(stop, deadline - 1)), signatureOf(stop));
  assert.notEqual(signatureOf(advanceStopState(stop, deadline)), signatureOf(stop));
  // The absolute-horizon case: the STATE flips exactly at the deadline —
  // the honest moment, not the next tick of a clock.
  const longHeadway = liveStop({
    state: 'due',
    medianHeadwayOwnSeconds: 1200,
    minutesSince: 14.8,
    dryness: 0.74,
  });
  const horizon = nextStopChangeMs(longHeadway, config);
  assert.equal(advanceStopState(longHeadway, horizon).state, 'void');
  assert.equal(advanceStopState(longHeadway, horizon - 1).state, 'due');
});

test('E4S1: the visible set is the stops inside the settled camera, plus margin', () => {
  const features = [
    { id: 'f1', point: [100, 100], stopIds: ['st_in'] },
    { id: 'f2', point: [900, 900], stopIds: ['st_far'] },
    { id: 'f3', point: [260, 100], stopIds: ['st_margin'] },
  ];
  const camera = { x: 0, y: 0, width: 200, height: 200 };
  const visible = visibleStopsOf(features, camera);
  assert.ok(visible.has('st_in'));
  assert.ok(!visible.has('st_far'));
  // A half-viewport margin keeps a fast pan painted past the screen edge.
  assert.ok(visible.has('st_margin'));
  // The margin is a fraction of the camera: a wider one keeps more world.
  const wider = visibleStopsOf(features, camera, 2);
  assert.ok(wider.has('st_in') && wider.has('st_margin'));
  assert.ok(!wider.has('st_far'));
});

test('E4S5: the numeric signature moves exactly when a quantised step or state moves', () => {
  const features = [{ id: 'f', point: [0, 0], stopIds: ['st_a', 'st_b'] }];
  const mapOf = (a, b) =>
    new Map([
      ['st_a', a],
      ['st_b', b],
    ]);
  const a = liveStop({ stopId: 'st_a', minutesSince: 5, dryness: 1 });
  const b = liveStop({ stopId: 'st_b', minutesSince: 9.9, dryness: 1.98 });
  const before = trackFieldSignature(features, mapOf(a, b));
  // Deterministic: same inputs, same number.
  assert.equal(trackFieldSignature(features, mapOf(a, b)), before);
  // A sub-quantum drift (1.0 → 1.02) is invisible — no repaint.
  assert.equal(trackFieldSignature(features, mapOf({ ...a, dryness: 1.02 }, b)), before);
  // Crossing a quantisation midpoint (1.0 → 1.2) changes it.
  assert.notEqual(
    trackFieldSignature(features, mapOf({ ...a, dryness: 1.2 }, b)),
    before,
  );
  // A state change changes it — colour beats dryness on the wire.
  assert.notEqual(
    trackFieldSignature(features, mapOf({ ...a, state: 'void' }, b)),
    before,
  );
  // Blind nulls are their own quantum: null ≠ any number.
  assert.notEqual(
    trackFieldSignature(features, mapOf({ ...a, dryness: null }, b)),
    before,
  );
});

test('E5S1: the painted field culls to edges near the camera — conservatively', () => {
  const edges = [
    {
      id: 'e_in',
      points: [
        [50, 50],
        [150, 50],
      ],
    },
    {
      id: 'e_out',
      points: [
        [900, 900],
        [950, 900],
      ],
    },
    // Both endpoints OUTSIDE the rect, but the stretch crosses it — a
    // bbox test includes it (over-inclusion, never a hole).
    {
      id: 'e_cross',
      points: [
        [-100, 100],
        [300, -100],
      ],
    },
    // Fully outside even with the half-viewport margin.
    {
      id: 'e_far',
      points: [
        [600, 600],
        [700, 600],
      ],
    },
  ];
  const camera = { x: 0, y: 0, width: 200, height: 200 };
  const visible = visibleEdgesOf(edges, camera);
  assert.ok(visible.has('e_in'));
  assert.ok(visible.has('e_cross'));
  assert.ok(!visible.has('e_far'));
  assert.ok(!visible.has('e_out'));
});
