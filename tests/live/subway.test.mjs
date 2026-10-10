import assert from 'node:assert/strict';
import test from 'node:test';
import GtfsBindings from 'gtfs-realtime-bindings';
import { compileModules } from '../helpers/compile.mjs';
const {
  decodeSubwayPredictions,
  fetchRailSnapshot,
  projectSnapshot,
  layoutStreetcarMap,
  buildViewerData,
  parseStreetcarGtfs,
  streetcarBody,
} = await compileModules(`
export * from './workers/api/src/realtime/realtime';
export * from './shared/map/live-status';
export * from './shared/map/model';
export * from './workers/map-generator/src/topology/schematic';
export * from './workers/shared/gtfs/parser';`);
const timestamp = 1791132356;
const encode = (entity, header = {}) =>
  GtfsBindings.transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '2.0', timestamp, ...header },
    entity,
  }).finish();
const train = (routeId = '1', extra = {}) => ({
  id: 'train',
  tripUpdate: {
    trip: { routeId, tripId: 'trip' },
    vehicle: { id: '15', label: '15' },
    stopTimeUpdate: [
      { stopId: 'a', stopSequence: 1, arrival: { time: timestamp + 60 } },
      { stopId: 'b', stopSequence: 2, arrival: { time: timestamp + 180 } },
    ],
    ...extra,
  },
});
test('subway updates retain train numbers, exclude Line 3, buses, cancelled and skipped services', () => {
  const rows = decodeSubwayPredictions(
    encode([
      train(),
      train('3'),
      train('7'),
      train('2', { trip: { routeId: '2', scheduleRelationship: 3 } }),
    ]),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, '15');
  assert.equal(rows[0].id, 'subway:1:15');
  assert.equal(rows[0].stops.length, 2);
  assert.equal(
    decodeSubwayPredictions(
      encode([
        train('1', {
          stopTimeUpdate: [
            { stopId: 'a', arrival: { time: timestamp }, scheduleRelationship: 1 },
          ],
        }),
      ]),
    ).length,
    0,
  );
  assert.throws(
    () => decodeSubwayPredictions(encode([], { incrementality: 1 })),
    /differential/,
  );
});
test('surface vehicles survive subway outage and successful empty feed removes predictions', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) =>
      url === 'surface' ? new Response(encode([])) : new Response('', { status: 503 });
    assert.equal(
      (await fetchRailSnapshot('surface', '', 'subway')).subwayStatus,
      'unavailable',
    );
    globalThis.fetch = async () => new Response(encode([]));
    const value = await fetchRailSnapshot('surface', '', 'subway');
    assert.equal(value.subwayStatus, 'available');
    assert.deepEqual(value.subwayPredictions, []);
  } finally {
    globalThis.fetch = original;
  }
});
test('rail import includes all requested subway/LRT types, excludes buses and Line 3', async () => {
  const files = {
    'routes.txt':
      'route_id,route_short_name,route_type\n1,1,1\n2,2,1\n3,3,1\n4,4,1\n5,5,0\n6,6,0\n501,501,0\n7,7,3\n',
    'trips.txt': 'route_id,trip_id,shape_id\n1,t,s\n',
    'shapes.txt':
      'shape_id,shape_pt_sequence,shape_pt_lat,shape_pt_lon\ns,1,43.65,-79.38\ns,2,43.66,-79.38\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\na,A,43.65,-79.38\n',
    'stop_times.txt': 'trip_id,stop_id,stop_sequence\nt,a,1\n',
  };
  const parsed = await parseStreetcarGtfs({
    // Unknown members (calendar files the fixture doesn't model) stream as
    // empty — the parser treats an empty calendar as "no schedule dates",
    // never an error.
    stream: (name) => new Response(files[name] ?? '').body,
  });
  assert.deepEqual(
    parsed.routes.map((r) => r.shortName),
    ['1', '2', '4', '5', '6', '501'],
  );
});
test('subway and surface tracks never form junctions at coincident vertices; predictions show stations with directed six-car bodies', () => {
  const map = layoutStreetcarMap({
    display: { width: 1200, height: 900 },
    routes: [
      { id: '1', shortName: '1' },
      { id: '501', shortName: '501' },
    ],
    paths: [
      {
        id: 'subway',
        routeIds: ['1'],
        points: [
          [0, 0],
          [0, 500],
          [0, 1000],
        ],
      },
      {
        id: 'surface',
        routeIds: ['501'],
        points: [
          [-500, 500],
          [0, 500],
          [500, 500],
        ],
      },
    ],
    infrastructure: [],
    stops: [
      { id: 'a', name: 'A', x: 0, y: 0, routeIds: ['1'], stopIds: ['a'] },
      { id: 'b', name: 'B', x: 0, y: 1000, routeIds: ['1'], stopIds: ['b'] },
    ],
    patterns: [
      { id: 'p', routeId: '1', pathId: 'subway', headsign: 'B', stopIds: ['a', 'b'] },
    ],
  });
  const rail = map.graph.edges.filter((e) => e.routeIds.includes('1'));
  const surface = map.graph.edges.filter((e) => e.routeIds.includes('501'));
  assert.ok(
    rail.every((e) =>
      surface.every((s) => ![s.a, s.b].includes(e.a) && ![s.a, s.b].includes(e.b)),
    ),
  );
  const data = buildViewerData({
    ...map,
    context: { shoreline: [], labels: [], north: { angle: 0 } },
  });
  const snapshot = {
    schemaVersion: 1,
    vehicles: [],
    source: 'fixture',
    attribution: '',
    fetchedAt: new Date(timestamp * 1000).toISOString(),
    feedTimestamp: new Date(timestamp * 1000).toISOString(),
    subwayPredictions: decodeSubwayPredictions(encode([train()])),
  };
  const [car] = projectSnapshot(data, snapshot, timestamp * 1000);
  assert.equal(car.vehicle.mode, 'subway');
  assert.equal(car.vehicle.positionKind, 'next-station');
  assert.equal(car.vehicle.nextStopName, 'A');
  assert.equal(car.stale, false);
  assert.ok(car.match);
  assert.equal(streetcarBody(car, data.edges, 1).length, 6);
  assert.equal(projectSnapshot(data, snapshot, (timestamp + 300) * 1000)[0].stale, true);
});
