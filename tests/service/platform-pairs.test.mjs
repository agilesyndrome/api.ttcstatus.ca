import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

// Stop-dot pairing (platform-pairs.ts, the street test): nearside platform
// twins render as ONE dot until zoom can tell them apart, and a merged dot
// never assumes a direction. Pure geometry and names — these tests hold
// the renderer and the selection semantics to one truth.
const {
  PLATFORM_SPLIT_PX,
  pairBase,
  intersectionTitle,
  pairDistinguishable,
  twinFeature,
  stopDots,
  intersectionPlatforms,
} = await compileModules(`export * from './web/ui/features/map/platform-pairs';`);
const { worstPlatform } = await compileModules(
  `export { worstPlatform } from './web/ui/features/service/wave-field';`,
);

const feature = (id, name, point, extra = {}) => ({
  id,
  name,
  kind: 'stop',
  point,
  routeIds: ['506'],
  accessible: null,
  boardingPoints: 1,
  platformNames: [name],
  destinations: {},
  replacementRouteIds: [],
  ...extra,
});

const state = (stopId, minutes, extra = {}) => ({
  stopId,
  directionId: 0,
  state: 'fresh',
  lastTouchAt: null,
  minutesSince: minutes,
  medianHeadwayOwnSeconds: 600,
  irregularity: 0,
  expectedWaitSeconds: 300,
  dryness: minutes === null ? null : minutes / 10,
  backToBack: 0,
  routeIds: ['506'],
  coverage: null,
  ...extra,
});

const kingWest = feature('stop:king-w', 'King St West at John St West Side', [100, 100], {
  stopIds: ['king_w'],
});
const kingEast = feature('stop:king-e', 'King St West at John St East Side', [103, 100], {
  stopIds: ['king_e'],
});

test('pair keys: side words fold, case and whitespace never count', () => {
  assert.equal(
    pairBase('King St West  at John St West Side'),
    pairBase('king st west at john st east side'),
  );
  assert.equal(
    intersectionTitle('King St West  at John St West Side'),
    'King St West at John St',
  );
  // A name without a side word keeps its own key — distinct stops stay distinct.
  assert.notEqual(pairBase('Queen St West at Spadina Ave'), pairBase(kingWest.name));
});

test('twins pair by name; duplicate names alone do not', () => {
  assert.equal(twinFeature(kingWest, [kingWest, kingEast])?.id, kingEast.id);
  // Same name, far away: the nearest same-name feature is offered, but the
  // distance rule keeps them apart (callers decide with the zoom).
  const dup = feature('stop:king-dup', 'King St West  at John St West Side', [200, 100], {
    stopIds: ['king_dup'],
  });
  assert.equal(twinFeature(kingWest, [kingWest, dup])?.id, dup.id);
  // Terminals never pair.
  const terminal = {
    ...feature('stop:loop', 'Long Branch Loop', [101, 100], { stopIds: ['loop'] }),
    kind: 'terminal',
  };
  assert.equal(twinFeature(terminal, [terminal, kingEast]), null);
});

test('distinguishable is a screen-space rule — zoom splits what fitted-view merges', () => {
  // 3 world units apart: one dot at fitted scale (≈0.6 px/unit)…
  assert.equal(
    pairDistinguishable(kingWest, kingEast, 0.6),
    false,
    'fitted view merges the pair',
  );
  // …two dots once each unit is 5+ screen px.
  assert.equal(
    pairDistinguishable(kingWest, kingEast, 5),
    true,
    'zoomed-in view splits the pair',
  );
  assert.ok(PLATFORM_SPLIT_PX >= 10, 'the split stays in gloved-tap territory');
});

test('stopDots: one dot per merged pair, solo otherwise, stable order', () => {
  const queen = feature('stop:queen', 'Queen St West at Spadina Ave', [100, 200], {
    stopIds: ['queen'],
  });
  // Fitted scale: King merges (leader first), Queen stays solo.
  const merged = stopDots([kingWest, kingEast, queen], 0.6);
  assert.deepEqual(
    merged.map((dot) => [dot.feature.id, dot.twin?.id ?? null, dot.title]),
    [
      ['stop:king-w', 'stop:king-e', 'King St West at John St'],
      ['stop:queen', null, 'Queen St West at Spadina Ave'],
    ],
    'the pair renders one dot titled by the intersection',
  );
  // Zoomed: both twins render, no merging.
  const split = stopDots([kingWest, kingEast, queen], 8);
  assert.deepEqual(
    split.map((dot) => [dot.feature.id, dot.twin]),
    [
      ['stop:king-w', null],
      ['stop:king-e', null],
      ['stop:queen', null],
    ],
  );
  // A feature carrying both boarding points is its own pair at any zoom —
  // a dot that never splits pairs with nobody.
  const both = feature('stop:both', 'Dundas St West at Howard Park Ave', [100, 300], {
    stopIds: ['dun_w', 'dun_e'],
  });
  for (const scale of [0.6, 8])
    assert.deepEqual(
      stopDots([both], scale).map((dot) => dot.twin),
      [null],
      'a two-platform feature never pairs with another feature',
    );
});

test('intersectionPlatforms: the rose candidates, own platform first', () => {
  const states = new Map([
    ['king_w', state('king_w', 2)],
    ['king_e', state('king_e', 3, { directionId: 1 })],
  ]);
  assert.deepEqual(
    intersectionPlatforms(kingWest, [kingWest, kingEast], states).map(
      (platform) => platform.stopId,
    ),
    ['king_w', 'king_e'],
  );
  // Only the monitored speak: an unmonitored twin never becomes a phantom option.
  const partial = new Map([['king_w', state('king_w', 2)]]);
  assert.deepEqual(
    intersectionPlatforms(kingWest, [kingWest, kingEast], partial).map(
      (platform) => platform.stopId,
    ),
    ['king_w'],
  );
});

test('worstPlatform headlines the pain — the shared-position rule', () => {
  const dry = state('king_w', 2);
  const hurting = state('king_e', 25, { directionId: 1, state: 'void' });
  assert.equal(worstPlatform(dry, hurting).stopId, 'king_e');
  assert.equal(worstPlatform(hurting, dry).stopId, 'king_e');
  // A blind spot is not a verdict: it loses to any monitored platform.
  const blind = state('king_e', null, {
    directionId: 1,
    state: 'unmonitored',
    coverage: { kind: 'outage', unmonitoredSeconds: 720, since: null },
  });
  assert.equal(worstPlatform(blind, dry).stopId, 'king_w');
  // Two blind spots: ties keep the first (deterministic).
  assert.equal(worstPlatform(blind, { ...blind, stopId: 'king_e2' }).stopId, 'king_e');
});
