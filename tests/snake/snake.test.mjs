import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: `export * from './web/ui/features/snake/engine'; export { demoData } from './web/ui/stories/fixtures'; export { buildViewerData } from './shared/map/model';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const { SnakeEngine, gameMissions, demoData, buildViewerData } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const edge = (id, a, b, sourcePoints, routeIds = ['501']) => ({
  id,
  a,
  b,
  sourcePoints,
  points: sourcePoints.map(([x, y]) => [x + 50, 150 - y]),
  routeIds,
  infrastructureIds: [],
  lengthMetres: Math.hypot(
    sourcePoints[1][0] - sourcePoints[0][0],
    sourcePoints[1][1] - sourcePoints[0][1],
  ),
  sourceDistances: [
    0,
    Math.hypot(
      sourcePoints[1][0] - sourcePoints[0][0],
      sourcePoints[1][1] - sourcePoints[0][1],
    ),
  ],
});
const network = {
  ...demoData,
  edges: [
    edge('in', 'a', 'b', [
      [0, 0],
      [100, 0],
    ]),
    edge('straight', 'b', 'c', [
      [100, 0],
      [300, 0],
    ]),
    edge('left', 'b', 'd', [
      [100, 0],
      [100, 200],
    ]),
    edge('right', 'b', 'e', [
      [100, 0],
      [100, -200],
    ]),
  ],
};
const car = (id, edgeId = 'queen-edge', distance = 180, extra = {}) => ({
  vehicle: { id, label: id },
  match: { edgeId, distanceAlongMetres: distance, direction: 1 },
  stale: false,
  ...extra,
});
function started(data = demoData, mode = 'arcade', options = {}) {
  const engine = new SnakeEngine(data, options);
  engine.start(mode, [], undefined, () => 0.4);
  engine.position = { edgeId: data.edges[0].id, direction: 1, distance: 100 };
  engine.trail = [];
  engine.travelled = 0;
  return engine;
}
function drive(engine, seconds, cars = []) {
  for (let i = 0; i < seconds * 10; i++) engine.tick(0.1, cars);
}

test('arcade eats an actual fresh on-track car once, and retains its identity across snapshot updates', () => {
  const engine = started();
  const cars = [
    car('4400'),
    car('stale', 'queen-edge', 110, { stale: true }),
    car('off', 'queen-edge', 110, { match: undefined }),
  ];
  drive(engine, 1.2, cars);
  assert.equal(engine.count, 2);
  assert.deepEqual([...engine.collected], ['4400']);
  assert.equal(engine.status, 'running');
  drive(engine, 1, [car('4400', 'queen-edge', 200)]);
  assert.equal(engine.count, 2);
});

test('purist collision ends the game without growing; stale/off-track and opposite virtual rails cannot kill the player', () => {
  const engine = started(demoData, 'purist');
  drive(engine, 4, [car('4400')]);
  assert.equal(engine.status, 'over');
  assert.equal(engine.count, 1);
  assert.match(engine.message, /4400/);
  const safe = started(demoData, 'purist');
  drive(safe, 4, [
    car('stale', 'queen-edge', 110, { stale: true }),
    car('off', 'queen-edge', 110, { match: undefined }),
    {
      ...car('opposite', 'queen-edge', 120),
      match: { ...car('opposite').match, distanceAlongMetres: 120, direction: -1 },
    },
  ]);
  assert.equal(safe.status, 'running');
  assert.equal(safe.count, 1);
});

test('arcade swept movement cannot tunnel through food at 2000 km/h, and motion uses metres rather than compressed pixels', () => {
  const compressed = {
    ...demoData,
    geographicTransform: { ...demoData.geographicTransform, scaleX: 0.1, scaleY: 0.1 },
    edges: demoData.edges.map((edge) => ({
      ...edge,
      points: edge.points.map(([x, y]) => [x * 0.1, y * 0.1]),
    })),
  };
  const engine = started(compressed);
  engine.speed = 2000;
  engine.tick(0.1, [car('fast', 'queen-edge', 145)]);
  assert.equal(engine.count, 2);
  assert.ok(Math.abs(engine.position.distance - (100 + (2000 / 3.6) * 0.1)) < 0.001);
});

test('game traffic seeds random streetcars and keeps a catchable target ahead', () => {
  const engine = started(demoData, 'arcade', { gameTraffic: true });
  assert.ok(engine.gameCars.length > 0 && engine.gameCars.length <= 10);
  assert.equal(
    new Set(engine.gameCars.map((car) => car.vehicle.id)).size,
    engine.gameCars.length,
  );
  assert.ok(engine.gameCars.every((car) => car.match && !car.stale));
  assert.ok(engine.gameCars.some((car) => car.vehicle.id.startsWith('snake-v2-')));

  const initialTargetIds = new Set(engine.gameCars.map((car) => car.vehicle.id));
  for (let i = 0; i < 70 && engine.count === 1; i++) engine.tick(0.1, []);
  assert.ok(
    engine.count > 1,
    'a generated streetcar arrives within the seven-second window',
  );
  assert.ok(
    engine.gameCars.length > 0 && engine.gameCars.length <= 10,
    'the game keeps a bounded streetcar population',
  );
  const idsAtCatch = new Set(engine.gameCars.map((car) => car.vehicle.id));
  for (let i = 0; i < 5; i++) engine.tick(0.1, []);
  assert.ok(
    engine.gameCars.every((car) => idsAtCatch.has(car.vehicle.id)),
    'the respawn cooldown prevents an immediate new streetcar',
  );
  assert.ok(
    engine.gameCars.some((car) => !initialTargetIds.has(car.vehicle.id)),
    'a collected target is replaced with a new generated streetcar',
  );
});

test('game traffic grows at most one car after the opening fleet', () => {
  const engine = new SnakeEngine(demoData, { gameTraffic: true });
  engine.start('arcade', [], undefined, () => 0.4);
  const initialIds = new Set(engine.gameCars.map((car) => car.vehicle.id));
  for (let i = 0; i < 10; i++) engine.tick(0.1, []);
  assert.deepEqual(
    engine.gameCars.map((car) => car.vehicle.id).filter((id) => !initialIds.has(id)),
    [],
    'no automatic growth occurs during the first second',
  );
  for (let i = 0; i < 30; i++) engine.tick(0.1, []);
  assert.ok(
    engine.gameCars.filter((car) => !initialIds.has(car.vehicle.id)).length <= 1,
    'traffic grows one car at a time after the cooldown',
  );
});

test('pause freezes movement, speed limits apply by mode and brakes can stop the train', () => {
  const engine = started(demoData, 'purist');
  engine.pause();
  engine.tick(0.1, [], 1);
  assert.equal(engine.position.distance, 100);
  engine.pause();
  engine.tick(0.1, [], 1);
  assert.equal(engine.speed, 50);
  for (let i = 0; i < 10; i++) engine.tick(0.1, [], -1);
  assert.equal(engine.speed, 0);
  const atRest = engine.position.distance;
  drive(engine, 1);
  assert.equal(engine.position.distance, atRest);
});

test('manual turnout choices and keyboard turn intents override automatic corridor continuity', () => {
  const engine = started(network);
  engine.position.distance = 80;
  assert.deepEqual(
    engine.choices().map((choice) => choice.turn),
    ['left', 'straight', 'right'],
  );
  engine.queue('left');
  drive(engine, 0.6);
  assert.equal(engine.position.edgeId, 'left');
  const direct = started(network);
  direct.position.distance = 80;
  direct.queue('right');
  drive(direct, 0.6);
  assert.equal(direct.position.edgeId, 'right');
  const automatic = started(network);
  automatic.position.distance = 80;
  drive(automatic, 0.6);
  assert.equal(automatic.position.edgeId, 'straight');
});

test('switch warning looks past degree-two geometry nodes and queued steering survives them', () => {
  const data = {
    ...network,
    edges: [
      edge('before', 'z', 'a', [
        [-100, 0],
        [0, 0],
      ]),
      ...network.edges,
    ],
  };
  const engine = started(data);
  engine.position.distance = 80;
  assert.equal(engine.upcoming().distance, 120);
  engine.queue('left');
  drive(engine, 2.5);
  assert.equal(engine.position.edgeId, 'left');
});

test('disconnected crossings stay disconnected; terminal turnbacks do not collide with an outbound tail', () => {
  const data = {
    ...demoData,
    edges: [
      edge('first', 'a', 'b', [
        [0, 0],
        [200, 0],
      ]),
      edge('cross', 'c', 'd', [
        [100, -100],
        [100, 100],
      ]),
    ],
  };
  const engine = started(data);
  engine.count = 3;
  engine.position.distance = 120;
  drive(engine, 5);
  assert.equal(engine.position.edgeId, 'first');
  assert.equal(engine.status, 'running');
  assert.equal(engine.position.direction, -1);
});

test('old tail samples kill an arcade run but never grow or kill a purist run', () => {
  const arcade = started();
  arcade.count = 4;
  arcade.travelled = 100;
  arcade.trail = [{ ...arcade.pose(), travelled: 10 }];
  arcade.tick(0.01, []);
  assert.equal(arcade.status, 'over');
  assert.match(arcade.message, /monster/);
  const purist = started(demoData, 'purist');
  purist.travelled = 100;
  purist.trail = [{ ...purist.pose(), travelled: 10 }];
  purist.tick(0.01, []);
  assert.equal(purist.status, 'running');
  assert.equal(purist.count, 1);
});

test('missions follow ordered directed paths, award a terminal bonus and reverse on the same rails', () => {
  const refs = [
    { edgeId: 'in', direction: 1 },
    { edgeId: 'left', direction: 1 },
  ];
  const mission = {
    id: 'mission',
    routeId: '501',
    label: '501 test',
    headsign: 'Left terminal',
    refs,
  };
  const engine = started(network);
  engine.start('arcade', [], mission, () => 0);
  engine.position = { edgeId: 'in', direction: 1, distance: 80 };
  engine.missionIndex = 0;
  drive(engine, 4.5);
  assert.equal(engine.position.edgeId, 'left');
  assert.equal(engine.position.direction, -1);
  assert.equal(engine.trips, 1);
  assert.equal(engine.count, 2);
  assert.deepEqual(engine.missionRefs, [
    { edgeId: 'left', direction: -1 },
    { edgeId: 'in', direction: -1 },
  ]);
  const purist = started(network);
  purist.start('purist', [], mission, () => 0);
  purist.position = { edgeId: 'left', direction: 1, distance: 190 };
  purist.missionIndex = 1;
  drive(purist, 1);
  assert.equal(purist.trips, 1);
  assert.equal(purist.count, 1);
});

test('production viewer retains route paths and offers only connected actual service missions', async () => {
  const source = JSON.parse(
    await readFile('data/fixtures/streetcar-schematic.json', 'utf8'),
  );
  const data = buildViewerData(source);
  assert.deepEqual(data.paths[0].edgeRefs, source.paths[0].edgeRefs);
  const missions = gameMissions(data);
  assert.ok(missions.length > 10);
  assert.ok(missions.some((mission) => mission.routeId === '501'));
  const disconnected = {
    ...network,
    patterns: [{ routeId: '501', pathId: 'bad', headsign: 'Bad', stopIds: [] }],
    paths: [
      {
        id: 'bad',
        routeIds: ['501'],
        edgeRefs: [
          { edgeId: 'in', direction: 1 },
          { edgeId: 'left', direction: -1 },
        ],
      },
    ],
  };
  assert.deepEqual(gameMissions(disconnected), []);
});

test('legacy archive keeps the original simulation and art intact, with scoped links and PWA start URL', async () => {
  const html = await readFile('public/snake/v1/index.html', 'utf8');
  const manifest = JSON.parse(await readFile('public/snake/v1/site.webmanifest', 'utf8'));
  assert.match(html, /src="\/snake\/v1\/game.js"/);
  assert.match(html, /href="\/snake\/v1\/styles.css"/);
  assert.equal(manifest.start_url, '/snake/v1/');
  assert.equal(manifest.scope, '/snake/v1/');
  assert.ok(manifest.icons.every((icon) => icon.src.startsWith('/snake/v1/')));
  const js = await readFile('public/snake/v1/game.js', 'utf8');
  assert.match(js, /MISSION_DEFS/);
  assert.match(js, /ttcSnakeResume/);
  for (const brokenApi of [
    'getContextr',
    'getBoundingClientRectr',
    'preventDefaultr',
    'Math.hypotr',
  ]) {
    assert.doesNotMatch(js, new RegExp(brokenApi.replace('.', '\\.'), 'g'));
  }
  assert.match(js, /startBtn\.addEventListener/);
});

test('next-stop guidance follows the chosen switch over real graph nodes and never invents a connector', () => {
  const data = {
    ...network,
    features: [
      {
        ...demoData.features[0],
        id: 'forward',
        name: 'Forward stop',
        edgeId: 'straight',
        distanceAlongMetres: 50,
      },
      {
        ...demoData.features[1],
        id: 'turning',
        name: 'Left stop',
        edgeId: 'left',
        distanceAlongMetres: 80,
      },
    ],
  };
  const engine = started(data);
  engine.position.distance = 70;
  assert.deepEqual(engine.nextStop(), { name: 'Forward stop', metres: 80 });
  engine.queue('left');
  assert.deepEqual(engine.nextStop(), { name: 'Left stop', metres: 110 });
  engine.queue('right');
  assert.equal(engine.nextStop(), undefined);
});

test('original pedal rates, simultaneous inputs, coasting and mode governors remain distinct', () => {
  for (const [mode, acceleration, braking, cap] of [
    ['purist', 34, 58, 50],
    ['arcade', 600, 900, 3000],
  ]) {
    const engine = started(demoData, mode);
    engine.speed = 10;
    engine.tick(0.1, [], { accelerator: true, brake: false });
    assert.ok(Math.abs(engine.speed - (10 + acceleration * 0.1)) < 1e-9);
    engine.tick(0.1, [], { accelerator: false, brake: true });
    assert.ok(
      Math.abs(engine.speed - Math.max(0, 10 + (acceleration - braking) * 0.1)) < 1e-9,
    );
    engine.speed = 20;
    engine.tick(0.1, [], { accelerator: true, brake: true });
    assert.ok(
      Math.abs(engine.speed - Math.max(0, 20 + (acceleration - braking) * 0.1)) < 1e-9,
    );
    const speed = engine.speed;
    engine.tick(0.1, []);
    assert.equal(engine.speed, speed, 'releasing both pedals retains speed');
    engine.speed = 0;
    const position = engine.position.distance;
    engine.tick(0.1, [], -1);
    assert.equal(engine.speed, 0);
    assert.equal(engine.position.distance, position);
    engine.tick(0.1, [], 1);
    assert.ok(engine.speed > 0, 'the accelerator restarts a stopped car');
    engine.speed = cap;
    engine.tick(0.1, [], 1);
    assert.equal(engine.speed, cap);
  }
});

test('switch warnings preserve the original speed-aware bounds', () => {
  const engine = started();
  for (const [speed, warning] of [
    [0, 230],
    [50, 230],
    [180, 230],
    [400, 500],
    [2000, 1400],
  ]) {
    engine.speed = speed;
    assert.equal(engine.warningDistance, warning);
  }
});

test('left and right choose the outermost branches, and straight chooses the closest heading even without a straight track', () => {
  const data = {
    ...network,
    edges: [
      network.edges[0],
      edge('near', 'b', 'c', [
        [100, 0],
        [250, 100],
      ]),
      edge('far', 'b', 'd', [
        [100, 0],
        [150, 200],
      ]),
    ],
  };
  for (const [intent, expected] of [
    ['left', 'far'],
    ['right', 'near'],
    ['straight', 'near'],
  ]) {
    const engine = started(data);
    engine.position.distance = 80;
    assert.ok(engine.upcoming().choices.every((choice) => choice.turn === 'left'));
    engine.queue(intent);
    assert.equal(engine.upcoming().selected.edgeId, expected);
    assert.equal(engine.upcoming().manual, true);
    drive(engine, 0.6);
    assert.equal(engine.position.edgeId, expected);
    assert.equal(engine.queued, undefined, 'a command is consumed once at the real fork');
  }
});

test('automatic route continuity beats a straighter different route or yard, with suffix and overnight continuity', () => {
  const cases = [
    ['501', '501'],
    ['501A', '501B'],
    ['301', '501'],
  ];
  for (const [from, to] of cases) {
    const data = {
      ...network,
      routes: [
        ...demoData.routes,
        { ...demoData.routes[0], id: '501A', number: '501A' },
        { ...demoData.routes[0], id: '501B', number: '501B' },
      ],
      edges: [
        edge(
          'in',
          'a',
          'b',
          [
            [0, 0],
            [100, 0],
          ],
          [from],
        ),
        edge(
          'straight',
          'b',
          'c',
          [
            [100, 0],
            [300, 0],
          ],
          ['504'],
        ),
        edge(
          'left',
          'b',
          'd',
          [
            [100, 0],
            [100, 200],
          ],
          [to],
        ),
        {
          ...edge(
            'yard',
            'b',
            'e',
            [
              [100, 0],
              [300, 0],
            ],
            [to],
          ),
          infrastructureIds: ['yard'],
        },
      ],
      infrastructure: [{ id: 'yard', name: 'Roncesvalles Carhouse Yard' }],
    };
    const engine = started(data);
    engine.position.distance = 80;
    assert.equal(engine.upcoming().selected.edgeId, 'left');
    assert.equal(engine.upcoming().manual, false);
    const automatic = engine.routePreview(105);
    assert.ok(automatic.at(-1)[1] < 100, 'green preview takes the selected north branch');
    engine.queue('yard');
    assert.equal(engine.upcoming().selected.edgeId, 'yard');
    drive(engine, 0.6);
    assert.equal(
      engine.position.edgeId,
      'yard',
      'explicit driving into a yard remains possible',
    );
    const auto = started(data);
    auto.position.distance = 80;
    drive(auto, 0.6);
    assert.equal(auto.position.edgeId, 'left');
  }
});

test('preview, switch warning and driving use the same route through intervening geometry nodes', () => {
  const data = {
    ...network,
    edges: [
      edge('before', 'z', 'a', [
        [-100, 0],
        [0, 0],
      ]),
      network.edges[0],
      { ...network.edges[1], routeIds: ['504'] },
      network.edges[2],
      { ...network.edges[3], routeIds: ['504'] },
    ],
  };
  const engine = started(data);
  engine.position.distance = 80;
  assert.equal(engine.upcoming().distance, 120);
  assert.equal(engine.upcoming().selected.edgeId, 'left');
  engine.queue('right');
  assert.equal(engine.upcoming().selected.edgeId, 'right');
  assert.ok(engine.routePreview(205).at(-1)[1] > 200);
  drive(engine, 2.5);
  assert.equal(engine.position.edgeId, 'right');
});

test('terminal connectors consume measured distance, keep the head smooth and leave the tail on its actual path', () => {
  const data = {
    ...demoData,
    edges: [
      edge('terminal', 'a', 'b', [
        [0, 0],
        [200, 0],
      ]),
    ],
    features: [],
  };
  const engine = started(data, 'purist');
  engine.position.distance = 199;
  engine.speed = 36;
  engine.trail = [{ ...engine.pose(), travelled: 0 }];
  let previous = engine.pose().source;
  engine.tick(0.1, []);
  for (let i = 0; i < 34; i++) {
    engine.tick(0.1, []);
    const source = engine.pose().source;
    assert.ok(
      Math.hypot(source[0] - previous[0], source[1] - previous[1]) <= 2.01,
      'no instantaneous jump between parallel rails',
    );
    previous = source;
  }
  assert.equal(engine.position.direction, -1);
  assert.equal(engine.turningAround, false);
  assert.ok(engine.position.distance > 190, 'the turnback itself takes travel time');
  assert.equal(engine.travelled, 35);
  assert.ok(engine.trail.some((sample) => sample.turnbackId));
  const growing = started(data);
  growing.count = 4;
  growing.speed = 36;
  growing.trail = [{ ...growing.pose(), travelled: 0 }];
  assert.equal(
    growing.carCentres().length,
    1,
    'cars with no travelled history are not drawn',
  );
  drive(growing, 7);
  const centres = growing.carCentres();
  assert.equal(centres.length, 3);
  assert.ok(Math.abs(centres[0].source[0] - centres[1].source[0] - 31.7) < 1e-9);
  assert.ok(
    Math.abs(centres[1].source[0] - centres[2].source[0] - 31.7) < 1e-9,
    'centres interpolate at original 30.2 m length plus 1.5 m coupler spacing',
  );
});

test('signed return departures take precedence over spurs at multi-branch terminals in preview, guidance and motion', () => {
  const data = {
    ...network,
    features: [
      {
        ...demoData.features[0],
        id: 'back',
        name: 'Return stop',
        edgeId: 'in',
        distanceAlongMetres: 70,
      },
    ],
  };
  const mission = {
    id: 'terminal',
    routeId: '501',
    label: '501 terminal',
    headsign: 'Terminal',
    refs: [{ edgeId: 'in', direction: 1 }],
  };
  const engine = started(data);
  engine.start('arcade', [], mission, () => 0);
  engine.position = { edgeId: 'in', direction: 1, distance: 99 };
  engine.missionIndex = 0;
  engine.queue('left');
  assert.equal(
    engine.upcoming(),
    undefined,
    'the signed terminal departure suppresses spur choices',
  );
  assert.ok(
    engine.routePreview(85).at(-1)[0] < 149,
    'preview returns along the same edge',
  );
  const nextStop = engine.nextStop();
  assert.equal(nextStop.name, 'Return stop');
  assert.ok(nextStop.metres > 50, 'guidance includes the turnback length');
  engine.speed = 36;
  drive(engine, 4);
  assert.equal(engine.trips, 1);
  assert.equal(engine.position.edgeId, 'in');
  assert.equal(engine.position.direction, -1);
  assert.equal(engine.queued, undefined);
  assert.ok(
    Math.abs(engine.nextStop().metres - (nextStop.metres - 40)) < 1e-6,
    `guidance follows the distance actually travelled through the terminal: ${engine.nextStop().metres} vs ${nextStop.metres - 40}`,
  );
});

test('closed graph edges continue as laps on the same directed rail instead of reversing', () => {
  const loop = {
    ...edge('loop', 'a', 'a', [
      [0, 0],
      [100, 0],
    ]),
    sourcePoints: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ],
    points: [
      [50, 150],
      [150, 150],
      [150, 50],
      [50, 50],
      [50, 150],
    ],
    sourceDistances: [0, 100, 200, 300, 400],
    lengthMetres: 400,
  };
  for (const direction of [1, -1]) {
    const engine = started({ ...demoData, edges: [loop], features: [] });
    engine.position = { edgeId: 'loop', direction, distance: direction === 1 ? 399 : 1 };
    engine.speed = 36;
    drive(engine, 0.5);
    assert.equal(engine.position.direction, direction);
    assert.equal(engine.turningAround, false);
    assert.equal(engine.position.distance, direction === 1 ? 4 : 396);
  }
});

test('preview and guidance resume the ordered mission path when a diversion rejoins it', () => {
  const data = {
    ...demoData,
    edges: [
      edge('off', 'z', 'c', [
        [0, 0],
        [100, 0],
      ]),
      edge('in', 'a', 'b', [
        [-200, 0],
        [-100, 0],
      ]),
      edge('detour', 'b', 'd', [
        [-100, 0],
        [-100, 100],
      ]),
      edge(
        'connector',
        'd',
        'c',
        [
          [-100, 100],
          [100, 0],
        ],
        ['504'],
      ),
      edge('join', 'c', 'e', [
        [100, 0],
        [200, 0],
      ]),
      edge(
        'return',
        'e',
        'f',
        [
          [200, 0],
          [200, 100],
        ],
        ['504'],
      ),
      edge('straight', 'e', 'g', [
        [200, 0],
        [300, 0],
      ]),
    ],
    features: [
      {
        ...demoData.features[0],
        id: 'return',
        name: 'Mission stop',
        edgeId: 'return',
        distanceAlongMetres: 40,
      },
    ],
  };
  const mission = {
    id: 'mission',
    routeId: '501',
    label: '501 test',
    headsign: 'Mission stop',
    refs: ['in', 'detour', 'connector', 'join', 'return'].map((edgeId) => ({
      edgeId,
      direction: 1,
    })),
  };
  const engine = started(data);
  engine.start('arcade', [], mission, () => 0);
  engine.position = { edgeId: 'off', direction: 1, distance: 80 };
  engine.missionIndex = -1;
  engine.queue('join');
  assert.deepEqual(engine.nextStop(), { name: 'Mission stop', metres: 160 });
  assert.ok(
    engine.routePreview(205).at(-1)[1] < 80,
    'preview follows the signed left turn after rejoining, despite a straighter same-route branch',
  );
  drive(engine, 2.5);
  assert.equal(engine.position.edgeId, 'return');
  assert.equal(engine.missionIndex, 4);
});

test('terminal sizes preserve Union, named station, general station, loop and carhouse distinctions', () => {
  for (const [name, radius] of [
    ['Union Station', 18],
    ['Spadina Station', 15],
    ['Broadview Station', 15],
    ['Dundas West Station', 14],
    ['Humber Loop', 12],
    ['Russell Carhouse', 10],
  ]) {
    const data = {
      ...demoData,
      edges: [demoData.edges[0]],
      features: [{ ...demoData.features[2], name, point: [450, 150] }],
    };
    assert.equal(new SnakeEngine(data).terminals.get('b').radius, radius, name);
  }
});

test('opposite rails on a tight bend stay separate even when a straight body tangent would cross the return rail', () => {
  const bend = {
    ...edge('bend', 'a', 'b', [
      [0, 0],
      [100, 0],
    ]),
    sourcePoints: [
      [0, 0],
      [100, 0],
      [100, -100],
    ],
    points: [
      [50, 150],
      [150, 150],
      [150, 250],
    ],
    sourceDistances: [0, 100, 200],
    lengthMetres: 200,
  };
  const data = { ...demoData, edges: [bend] };
  const arcade = started(data);
  arcade.position = { edgeId: 'bend', direction: 1, distance: 99 };
  arcade.count = 4;
  arcade.travelled = 100;
  const inbound = arcade.pose({ edgeId: 'bend', direction: -1, distance: 102 });
  arcade.trail = [{ ...inbound, travelled: 10 }];
  arcade.tick(0.01, []);
  assert.equal(
    arcade.status,
    'running',
    'the inbound tail occupies the other rail through the bend',
  );
  const purist = started(data, 'purist');
  purist.position = { edgeId: 'bend', direction: 1, distance: 99 };
  purist.tick(0.01, [
    {
      ...car('opposite', 'bend', 102),
      match: { edgeId: 'bend', direction: -1, distanceAlongMetres: 102 },
    },
  ]);
  assert.equal(
    purist.status,
    'running',
    'a live car around the bend on the opposite rail is safe too',
  );
});

test('same-rail collisions follow a bend rather than treating the two body sections as straight lines', () => {
  const bend = {
    ...edge('bend', 'a', 'b', [
      [0, 0],
      [100, 0],
    ]),
    sourcePoints: [
      [0, 0],
      [100, 0],
      [100, 100],
    ],
    points: [
      [50, 150],
      [150, 150],
      [150, 50],
    ],
    sourceDistances: [0, 100, 200],
    lengthMetres: 200,
  };
  const data = { ...demoData, edges: [bend] };
  const purist = started(data, 'purist');
  purist.position = { edgeId: 'bend', direction: 1, distance: 86 };
  purist.tick(0.01, [car('around-corner', 'bend', 114)]);
  assert.equal(
    purist.status,
    'over',
    '30.2 m streetcar bodies overlap along their rail around the corner',
  );
  const arcade = started(data);
  arcade.position = { edgeId: 'bend', direction: 1, distance: 99 };
  arcade.count = 4;
  arcade.travelled = 100;
  arcade.trail = [
    { ...arcade.pose({ edgeId: 'bend', direction: 1, distance: 106 }), travelled: 10 },
  ];
  arcade.tick(0.01, []);
  assert.equal(
    arcade.status,
    'over',
    'entering an occupied section of the same directional rail still ends a run',
  );
});

test('body occupancy continues through graph joints and follows the switch actually taken behind the lead car', () => {
  const data = {
    ...demoData,
    edges: [
      edge('stem', 'a', 'b', [
        [0, 0],
        [100, 0],
      ]),
      edge('east', 'b', 'c', [
        [100, 0],
        [200, 0],
      ]),
      edge('north', 'b', 'd', [
        [100, 0],
        [100, 100],
      ]),
    ],
  };
  const approaching = started(data, 'purist');
  approaching.position = { edgeId: 'stem', direction: 1, distance: 95 };
  approaching.queue('left');
  approaching.tick(0.01, [car('switch-car', 'north', 15)]);
  assert.equal(
    approaching.status,
    'over',
    'the front occupies the selected outgoing rail',
  );
  const leaving = started(data, 'purist');
  leaving.position = { edgeId: 'north', direction: 1, distance: 5 };
  leaving.travelled = 25;
  leaving.trail = [
    { ...leaving.pose({ edgeId: 'east', direction: -1, distance: 5 }), travelled: 15 },
  ];
  leaving.tick(0.01, [
    {
      ...car('rear-car', 'east', 25),
      match: { edgeId: 'east', direction: -1, distanceAlongMetres: 25 },
    },
  ]);
  assert.equal(
    leaving.status,
    'over',
    'the rear follows its actual incoming branch through the switch',
  );
});

const terminalCases = [
  ['501', 'towards Humber'],
  ['504', 'towards Distillery'],
  ['504', 'towards Dundas West Station'],
  ['506', 'towards High Park'],
  ['506', 'towards Main Street Station'],
  ['509', 'towards Union Station'],
  ['510', 'towards Spadina Station'],
  ['511', 'towards Exhibition'],
  ['512', 'towards St Clair Station'],
];
for (const [routeId, destination] of terminalCases)
  test(`long trains clear both ${routeId} ${destination} terminal turnbacks on the production graph`, async () => {
    const data = buildViewerData(
      JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8')),
    );
    const mission = gameMissions(data).find(
      (mission) => mission.routeId === routeId && mission.headsign.includes(destination),
    );
    assert.ok(mission, `${routeId} ${destination} mission exists`);
    for (const speed of [180, 2000]) {
      const engine = new SnakeEngine(data);
      engine.start('arcade', [], mission, () => 0);
      engine.count = 30;
      engine.speed = speed;
      for (let i = 0; i < 18000 && engine.status === 'running' && engine.trips < 2; i++)
        engine.tick(0.1, []);
      assert.equal(
        engine.status,
        'running',
        `${speed} km/h: ${engine.message} on ${engine.position.edgeId}`,
      );
      assert.equal(engine.trips, 2, 'both terminals are reached');
      for (let i = 0; i < Math.ceil(250 / ((speed / 3.6) * 0.1)); i++)
        engine.tick(0.1, []);
      assert.equal(
        engine.status,
        'running',
        `${speed} km/h: continue beyond the short turnback grace with the inbound train still present`,
      );
    }
  });

test('Transit Control chaos caps speed with slow orders and stays silent without chaos enabled', () => {
  // A deterministic random stream makes the first disruption a slow order.
  const engine = new SnakeEngine(demoData, { chaos: true });
  engine.start('arcade', [], undefined, () => 0);
  assert.equal(engine.hazard, undefined, 'the network starts clear');
  // Nineteen seconds of accelerator: the overdrive climbs past the cap that
  // the coming slow order will impose.
  for (let i = 0; i < 190; i++) engine.tick(0.1, [], { accelerator: true, brake: false });
  assert.ok(
    engine.speed > 600,
    `the accelerator climbs past the coming slow-order cap: ${engine.speed}`,
  );
  // Twenty seconds in, Transit Control issues the slow order.
  for (let i = 0; i < 10; i++) engine.tick(0.1, [], { accelerator: true, brake: false });
  assert.equal(engine.hazard?.kind, 'slow');
  assert.ok(engine.banner.length > 0, 'the slow order posts a banner');
  assert.ok(engine.speed <= 600, `the slow order caps the speedometer: ${engine.speed}`);
  // The order expires twelve seconds later and the accelerator opens again.
  for (let i = 0; i < 130; i++) engine.tick(0.1, [], { accelerator: true, brake: false });
  assert.equal(engine.hazard, undefined, 'the slow order expires');
  assert.equal(engine.banner, '');
  for (let i = 0; i < 10; i++) engine.tick(0.1, [], { accelerator: true, brake: false });
  assert.ok(engine.speed > 600, `speed climbs again once lifted: ${engine.speed}`);
  // Without the chaos option nothing ever happens.
  const quiet = new SnakeEngine(demoData);
  quiet.start('arcade', [], undefined, () => 0);
  for (let i = 0; i < 400; i++) quiet.tick(0.1, [], { accelerator: true, brake: false });
  assert.equal(quiet.hazard, undefined);
  assert.equal(quiet.banner, '');
  assert.ok(quiet.speed > 600, `no chaos, no cap: ${quiet.speed}`);
});
