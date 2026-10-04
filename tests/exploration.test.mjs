import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ stdin: { contents: `
  export * from './web/ui/fleet'; export * from './web/ui/comparison'; export * from './web/ui/commute';
  export { demoData } from './web/ui/stories/fixtures'; export { buildViewerData } from './web/map/model';`,
  resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm' });
const { DEFAULT_FLEET_FILTERS, filterFleet, csvCell, fleetCsv, compareStops, readMapLink, mapLinkHash, DEFAULT_FILTERS, demoData, buildViewerData } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const car = (id, routeId, extra = {}) => ({ vehicle: { id, label: id, routeId, latitude: 43.65, longitude: -79.4, observedAt: '2026-10-03T12:00:00Z' }, stale: false, point: [50, 150], angle: 0, match: { edgeId: 'queen-edge' }, ...extra });

const cars = [car('4402', '501'), car('4401', '504', { stale: true }), car('4403', undefined, { match: undefined }), car('4404', '501', { vehicle: { ...car('4404', '501').vehicle, speedMetresPerSecond: 0 } })];

test('fleet filters combine number/name, assignment and report status without mutating the snapshot', () => {
  assert.deepEqual(filterFleet(cars, demoData.routes, DEFAULT_FLEET_FILTERS).map(entry => entry.car.vehicle.id), ['4401', '4402', '4403', '4404']);
  assert.equal(filterFleet(cars, demoData.routes, { ...DEFAULT_FLEET_FILTERS, query: 'Queen', status: 'fresh' }).length, 2);
  assert.equal(filterFleet(cars, demoData.routes, { ...DEFAULT_FLEET_FILTERS, query: '#4401', status: 'stale', route: 'route:504' }).length, 1);
  assert.equal(filterFleet(cars, demoData.routes, { ...DEFAULT_FLEET_FILTERS, route: 'unassigned', status: 'off-track' })[0].car.vehicle.id, '4403');
  assert.equal(filterFleet(cars, demoData.routes, { ...DEFAULT_FLEET_FILTERS, status: 'off-track', route: 'route:501' }).length, 0);
  assert.deepEqual(cars.map(car => car.vehicle.id), ['4402', '4401', '4403', '4404'], 'source order is preserved');
});

test('speed sorting puts supplied fresh zero ahead of missing/stale speeds, and distance sorting measures GPS', () => {
  const fleet = [cars[0], { ...cars[1], vehicle: { ...cars[1].vehicle, speedMetresPerSecond: 50 } }, cars[3]];
  assert.equal(filterFleet(fleet, demoData.routes, { ...DEFAULT_FLEET_FILTERS, sort: 'speed' })[0].car.vehicle.id, '4404');
  const remote = { ...cars[0], vehicle: { ...cars[0].vehicle, latitude: 43.7 } };
  assert.equal(filterFleet([remote, cars[3]], demoData.routes, { ...DEFAULT_FLEET_FILTERS, sort: 'distance' }, { latitude: 43.65, longitude: -79.4 })[0].car.vehicle.id, '4404');
  assert.equal(filterFleet([remote, cars[3]], demoData.routes, { ...DEFAULT_FLEET_FILTERS, sort: 'distance' })[0].car.vehicle.id, '4402', 'missing personal location falls back to car-number order');
});

test('CSV preserves numeric coordinates and quoted fields, escapes external formulas, and records freshness and missing values', () => {
  assert.equal(csvCell(-79.4), '"-79.4"');
  assert.equal(csvCell('He said "hi", there\nagain'), '"He said ""hi"", there\nagain"');
  for (const input of ['=1+1', '+SUM(A1)', '-1+2', '@cmd', '\t =cmd']) assert.ok(csvCell(input).startsWith('"\''));
  assert.equal(csvCell(undefined), '""');
  const csv = fleetCsv([cars[1], cars[3]], demoData.routes, { fetchedAt: 'fetched', feedTimestamp: null });
  assert.ok(csv.includes('"stale"'));
  assert.ok(csv.includes('"0","fetched",""'));
  assert.ok(csv.includes('"-79.4"'));
  assert.equal(csv.split('\r\n').length, 4);
  assert.ok(!csv.includes('distance_from_me'), 'export contains only vehicle data');
});

const from = { ...demoData.features[0], stopIds: ['a1', 'a2'] };
const to = { ...demoData.features[1], stopIds: ['b1', 'b2'], routeIds: ['501', '504'] };
const data = { ...demoData, features: [from, to], patterns: [
  { routeId: '501', stopIds: ['a1', 'middle', 'b1'], headsign: 'East' },
  { routeId: '501', stopIds: ['a2', 'middle', 'another', 'b2'], headsign: 'East via loop' },
  { routeId: '504', stopIds: ['b2', 'a2'], headsign: 'Reverse only' },
  { routeId: '301', stopIds: ['a1', 'b1'], headsign: 'Overnight' },
  { routeId: '507', stopIds: ['a1', 'b1'], headsign: 'Physical rail only' },
] };

test('comparison uses ordered boarding IDs, groups route variants and excludes physical-only and overnight routes by default', () => {
  const result = compareStops(data, from, to);
  assert.equal(result.available, true);
  assert.deepEqual(result.connections.map(connection => connection.route.id), ['501']);
  assert.equal(result.connections[0].minimumStopsBetween, 1);
  assert.equal(result.connections[0].maximumStopsBetween, 2);
  assert.deepEqual(result.connections[0].headsigns, ['East', 'East via loop']);
  assert.deepEqual(compareStops(data, from, to, true).connections.map(connection => connection.route.id), ['301', '501']);
  assert.deepEqual(compareStops(data, to, from).connections.map(connection => connection.route.id), ['504']);
});

test('shared route IDs alone never invent a connection, and absent stop sequences are explicit', () => {
  assert.deepEqual(compareStops({ ...data, patterns: [{ routeId: '501', stopIds: ['a1', 'c1'], headsign: 'Other branch' }] }, from, to).connections, []);
  assert.equal(compareStops({ ...demoData, patterns: undefined }, demoData.features[0], demoData.features[1]).available, false);
  assert.equal(compareStops(data, from, from).sameStop, true);
  assert.deepEqual(compareStops(data, from, from).connections, []);
});

test('loop patterns use a later destination and shortest forward segment without reversing the trip', () => {
  const loop = { ...data, patterns: [{ routeId: '501', stopIds: ['b1', 'a1', 'other', 'a2', 'b2'], headsign: 'Loop' }] };
  assert.equal(compareStops(loop, from, to).connections[0].minimumStopsBetween, 0);
  assert.equal(compareStops({ ...loop, patterns: [{ routeId: '501', stopIds: ['b1', 'a1'], headsign: 'Wrong way' }] }, from, to).connections.length, 0);
});

test('real map viewer preserves grouped boarding IDs and canonical stop order for comparisons', async () => {
  const source = JSON.parse(await readFile('streetcar-schematic.json', 'utf8'));
  const viewer = buildViewerData(source);
  assert.deepEqual(viewer.patterns, source.patterns);
  const stop = source.stops.find(stop => viewer.features.some(feature => feature.id === stop.id));
  assert.deepEqual(viewer.features.find(feature => feature.id === stop.id).stopIds, stop.stopIds);
});

test('share links restore tool tabs and comparison endpoints, ignoring malformed extra values', () => {
  const tools = { panel: 'compare', fromId: 'A/Queen & King', toId: 'B:#北' };
  const hash = mapLinkHash(undefined, DEFAULT_FILTERS, undefined, tools);
  assert.deepEqual(readMapLink(hash), { filters: {}, ...tools });
  assert.deepEqual(readMapLink('#view=other&from=&to=' + 'a'.repeat(201)), { filters: {} });
  assert.deepEqual(readMapLink('#view=fleet'), { filters: {}, panel: 'fleet' });
  assert.equal(mapLinkHash(undefined, DEFAULT_FILTERS, undefined, { panel: 'explore' }), '');
});
