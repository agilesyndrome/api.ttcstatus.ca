import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { routeItineraries, demoData, revealRoutes, DEFAULT_FILTERS } =
  await compileModules(`
  export * from './web/ui/features/map/route-guide';
  export * from './web/ui/stories/fixtures';
  export * from './web/ui/commute';
`);

test('route guides use forward boarding order, collapse adjacent platforms and preserve later loop visits', () => {
  const pattern = {
    routeId: '501',
    headsign: 'Loop',
    stopIds: ['queen-e', 'queen-w', 'humber', 'queen-e'],
  };
  const data = {
    ...demoData,
    patterns: [pattern, { ...pattern }, { ...pattern, routeId: '504' }],
  };
  const before = JSON.stringify(data);
  const rows = routeItineraries(data, '501');
  assert.equal(rows.length, 1, 'identical scheduled variants are deduplicated');
  assert.deepEqual(
    rows[0].stops.map(({ feature, sequence }) => [feature.id, sequence]),
    [
      ['queen', 1],
      ['terminal', 3],
      ['queen', 4],
    ],
  );
  assert.equal(rows[0].boardingPoints, 4);
  assert.equal(rows[0].unmapped, 0);
  assert.equal(JSON.stringify(data), before);
});

test('missing and unrelated boarding IDs remain gaps; graph geometry never invents route stops', () => {
  const data = {
    ...demoData,
    patterns: [
      {
        routeId: '501',
        headsign: 'Humber',
        stopIds: ['queen-e', 'king-e', 'unmapped', 'humber'],
      },
    ],
  };
  const [route] = routeItineraries(data, '501');
  assert.equal(route.unmapped, 2);
  assert.deepEqual(
    route.stops.map(({ feature }) => feature.id),
    ['queen', 'terminal'],
  );
  assert.deepEqual(routeItineraries({ ...data, patterns: undefined }, '501'), []);
  assert.deepEqual(routeItineraries(data, '504'), []);
});

test('longest scheduled variants come first and different destinations stay distinguishable', () => {
  const data = {
    ...demoData,
    patterns: [
      { routeId: '501', headsign: 'Short turn', stopIds: ['queen-e'] },
      { routeId: '501', headsign: 'Humber', stopIds: ['queen-e', 'humber'] },
      { routeId: '501', headsign: 'Other destination', stopIds: ['queen-e', 'humber'] },
    ],
  };
  assert.deepEqual(
    routeItineraries(data, '501').map((row) => row.headsign),
    ['Humber', 'Other destination', 'Short turn'],
  );
});

test('selection restores the matching mode and overnight layer without resetting other preferences', () => {
  const routes = [
    ...demoData.routes,
    { id: 'rapid-internal', number: '1', overnight: false },
  ];
  const hidden = {
    ...DEFAULT_FILTERS,
    streetcar: false,
    subway: false,
    labels: true,
    live: false,
  };
  assert.deepEqual(revealRoutes(hidden, routes, ['rapid-internal']), {
    ...hidden,
    subway: true,
  });
  assert.deepEqual(revealRoutes(hidden, routes, ['301']), {
    ...hidden,
    streetcar: true,
    overnight: true,
  });
  assert.deepEqual(revealRoutes(hidden, routes, ['501', '301']), {
    ...hidden,
    streetcar: true,
  });
  assert.equal(revealRoutes(hidden, routes, ['unknown']), hidden);
  assert.equal(revealRoutes(DEFAULT_FILTERS, routes, ['501']), DEFAULT_FILTERS);
});
