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
