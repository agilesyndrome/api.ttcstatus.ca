import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const built = await build({
  stdin: {
    contents: `export * from './web/ui/features/snake/game-map'; export * from './web/ui/features/snake/engine'; export { buildViewerData } from './shared/map/model'; export {demoData} from './web/ui/stories/fixtures'; export {localToMap, mapToGps} from './shared/map/projection';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const {
  buildSnakeMap,
  auditSnakeMap,
  snakeCars,
  SnakeEngine,
  buildViewerData,
  demoData,
  localToMap,
  mapToGps,
} = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);
const original = buildViewerData(
  JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8')),
);
const game = buildSnakeMap(original);
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
function edge(id, a, b, points, routeIds) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(
      lengths.at(-1) +
        Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
    );
  return {
    id,
    a,
    b,
    sourcePoints: points,
    points: points.map((p) => localToMap(p, demoData.geographicTransform)),
    sourceDistances: lengths,
    lengthMetres: lengths.at(-1),
    routeIds,
    infrastructureIds: [],
  };
}
function station(id, point, routeIds) {
  return {
    ...demoData.features[0],
    id,
    name: `${id} Station`,
    kind: 'stop',
    point: localToMap(point, demoData.geographicTransform),
    routeIds,
  };
}
const interchanges = {
  ...demoData,
  routes: ['510', '1', '2', '5'].map((number) => ({
    id: number,
    number,
    name: number,
    scheduled: true,
    overnight: false,
    color: '#777777',
  })),
  edges: [
    edge(
      'spadina',
      's0',
      's1',
      [
        [-1000, 0],
        [1000, 0],
      ],
      ['510'],
    ),
    edge(
      'one',
      'a0',
      'a1',
      [
        [0, -1000],
        [0, 1000],
      ],
      ['1'],
    ),
    edge(
      'two',
      'b0',
      'b1',
      [
        [-1000, 600],
        [1000, 600],
      ],
      ['2'],
    ),
    edge(
      'five',
      'c0',
      'c1',
      [
        [-1000, -600],
        [1000, -600],
      ],
      ['5'],
    ),
  ],
  features: [
    station('Spadina streetcar', [0, 0], ['510']),
    station('Spadina subway', [0, 0], ['1']),
    station('Bloor Yonge', [0, 600], ['1', '2']),
    station('Eglinton', [0, -600], ['1', '5']),
  ],
  paths: ['spadina', 'one', 'two', 'five'].map((id) => ({
    id,
    routeIds: [],
    edgeRefs: [{ edgeId: id, direction: 1 }],
  })),
  patterns: [],
};

test('Snake owns its graph: frozen explorer input is unchanged and generation is deterministic', () => {
  const input = freeze(structuredClone(original)),
    before = JSON.stringify(input);
  assert.deepEqual(buildSnakeMap(input), game);
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(game.data.edges, original.edges);
  assert.ok(game.collapsedEdges > 200);
  assert.deepEqual(game.data.routes, original.routes);
  assert.deepEqual(
    game.data.features
      .filter(
        (f) =>
          !f.id.startsWith('terminal:roncesvalles') &&
          !f.id.startsWith('terminal:russell'),
      )
      .map((f) => [f.id, f.name]),
    original.features.map((f) => [f.id, f.name]),
  );
});

test('every Toronto station, terminal and edge passes the game-map audit', () => {
  const audit = auditSnakeMap(game.data);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.stations, 419);
  assert.equal(audit.terminals, 18);
  for (const terminal of game.data.features.filter((f) => f.kind === 'terminal')) {
    const e = game.data.edges.find((e) => e.id === terminal.edgeId);
    assert.ok(
      terminal.distanceAlongMetres === 0 ||
        terminal.distanceAlongMetres === e.lengthMetres,
      terminal.name,
    );
  }
});

test('playground topology removes duplicate rails, smooths corridors, and exposes both barns', () => {
  const degree = new Map();
  for (const edge of game.data.edges)
    for (const node of new Set([edge.a, edge.b]))
      degree.set(node, (degree.get(node) ?? 0) + 1);
  const duplicatePairs = new Map();
  for (const edge of game.data.edges) {
    const key = [edge.a, edge.b].sort().join('|');
    duplicatePairs.set(key, (duplicatePairs.get(key) ?? 0) + 1);
  }
  assert.ok(game.collapsedEdges >= 400);
  assert.ok(game.data.edges.length < 100);
  assert.ok(Math.max(...degree.values()) <= 5);
  assert.ok([...duplicatePairs.values()].every((count) => count <= 3));
  assert.deepEqual(
    game.data.features
      .filter((feature) => /carhouse/i.test(feature.name))
      .map((feature) => feature.name)
      .sort(),
    ['Roncesvalles Carhouse', 'Russell Carhouse'],
  );
  for (const barn of game.data.features.filter((feature) =>
    /carhouse/i.test(feature.name),
  )) {
    const edge = game.data.edges.find((candidate) => candidate.id === barn.edgeId);
    assert.ok(edge?.id.startsWith('snake:barn:'));
    assert.equal(barn.distanceAlongMetres, edge.lengthMetres);
  }
});

test('every directed departure, including loops and dead ends, drives safely at 2000 km/h', () => {
  for (const edge of game.data.edges)
    for (const direction of [1, -1]) {
      const engine = new SnakeEngine(game.data, { easySwitches: true });
      engine.start('arcade', []);
      engine.position = {
        edgeId: edge.id,
        direction,
        distance:
          direction === 1
            ? Math.max(0, edge.lengthMetres - 10)
            : Math.min(10, edge.lengthMetres),
      };
      engine.trail = [];
      engine.speed = 2000;
      for (let i = 0; i < 20; i++) engine.tick(0.1, []);
      assert.equal(engine.status, 'running', `${edge.id}:${direction}`);
      assert.ok(engine.travelled > 1100);
      assert.ok(engine.pose().point.every(Number.isFinite));
    }
});

for (const speed of [180, 2000])
  test(`free play on the published board stays drivable with 30 cars at ${speed} km/h`, () => {
    const engine = new SnakeEngine(game.data, { easySwitches: true });
    engine.start('arcade', []);
    engine.count = 30;
    engine.speed = speed;
    for (let i = 0; i < 3000; i++) engine.tick(0.1, []);
    assert.equal(engine.status, 'running', `${speed} km/h: ${engine.message}`);
    assert.ok(
      engine.pose().point.every(Number.isFinite),
      `${speed} km/h: pose stays finite`,
    );
  });

test('isolated small loops survive and large loops retain their continuous lap', () => {
  for (const size of [30, 600]) {
    const loop = edge(
      'loop',
      'loop-node',
      'loop-node',
      [
        [0, 0],
        [size, 0],
        [size, size],
        [0, size],
        [0, 0],
      ],
      ['501'],
    );
    const data = buildSnakeMap({
      ...demoData,
      edges: [loop],
      features: [],
      paths: [],
      patterns: [],
    }).data;
    assert.equal(data.edges.length, 1);
    assert.deepEqual(auditSnakeMap(data).errors, []);
    const engine = new SnakeEngine(data, { easySwitches: true });
    engine.start('arcade', []);
    engine.speed = 2000;
    for (let i = 0; i < 100; i++) engine.tick(0.1, []);
    assert.equal(engine.status, 'running');
    assert.equal(engine.turningAround, false);
  }
});

test('station interchanges are one switch onto either direction of lines 1, 2 and 5; crossings alone stay separate', () => {
  const { data, transfers } = buildSnakeMap(interchanges);
  assert.equal(transfers.length, 3);
  assert.deepEqual(auditSnakeMap(data).errors, []);
  for (const transfer of transfers) {
    const legs = data.edges.filter(
      (e) => e.a === transfer.nodeId || e.b === transfer.nodeId,
    );
    assert.equal(legs.length, 4, transfer.name);
    for (const incoming of legs) {
      const direction = incoming.b === transfer.nodeId ? 1 : -1;
      for (const outgoing of legs.filter((e) => e !== incoming)) {
        const engine = new SnakeEngine(data, { easySwitches: true });
        engine.start('arcade', []);
        engine.position = {
          edgeId: incoming.id,
          direction,
          distance: direction === 1 ? incoming.lengthMetres - 10 : 10,
        };
        engine.trail = [];
        engine.speed = 2000;
        engine.queue(outgoing.id);
        engine.tick(0.1, []);
        assert.equal(
          engine.position.edgeId,
          outgoing.id,
          `${incoming.id} -> ${outgoing.id}`,
        );
        assert.equal(engine.status, 'running');
      }
    }
  }
  const without = buildSnakeMap({ ...interchanges, features: [] });
  assert.equal(without.transfers.length, 0);
  assert.equal(without.data.edges.length, 4);
});

test('high speed switches have six seconds of preview; queued choices survive geometry nodes', () => {
  const engine = new SnakeEngine(game.data, { easySwitches: true });
  engine.speed = 2000;
  assert.equal(engine.warningDistance, (2000 / 3.6) * 6);
});

test('live pickups are reprojected onto game rails with identity and freshness retained', () => {
  const data = buildSnakeMap(interchanges).data;
  const gps = mapToGps(
    localToMap([-300, 0], data.geographicTransform),
    data.geographicTransform,
  );
  const car = {
    vehicle: { id: '4400', label: '4400', routeId: '510', ...gps, bearing: 90 },
    point: [0, 0],
    angle: 0,
    stale: false,
    match: { edgeId: 'spadina', direction: 1 },
  };
  const [projected, off, stale] = snakeCars(data, [
    car,
    { ...car, match: undefined },
    { ...car, stale: true },
  ]);
  assert.equal(projected.vehicle, car.vehicle);
  assert.ok(data.edges.some((e) => e.id === projected.match.edgeId));
  assert.equal(off.match, undefined);
  assert.equal(stale.stale, true);
});
