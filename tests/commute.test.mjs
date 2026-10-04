import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ stdin: { contents: `
  export * from './web/ui/commute';
  export { demoData, demoSnapshot } from './web/ui/stories/fixtures';
  export { mapToGps, gpsToMap, fitGeographicTransform } from './workers/shared/map-projection';`,
  resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm' });
const { distanceMetres, formatDistance, nearbyStops, nearbyCars, routeActivity, readMapLink, mapLinkHash, validFilters, validSavedStops, DEFAULT_FILTERS, demoData, mapToGps, gpsToMap, fitGeographicTransform } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

const origin = { latitude: 43.65, longitude: -79.4 };
const vehicle = (id, routeId, metres, stale = false, speed) => ({
  vehicle: { id, label: id, routeId, ...origin, longitude: origin.longitude + metres / 80540, speedMetresPerSecond: speed },
  point: [0, 0], angle: 0, stale,
});

test('distances use geography, including longitude wrapping, and format both metres and kilometres', () => {
  assert.equal(distanceMetres(origin, origin), 0);
  assert.ok(Math.abs(distanceMetres(origin, { ...origin, latitude: origin.latitude + .01 }) - 1112) < 1);
  assert.ok(distanceMetres({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }) < 225);
  assert.equal(formatDistance(426), '430 m');
  assert.equal(formatDistance(1426), '1.4 km');
});

test('near me sorts geographically across compressed regions, excludes physical terminals and enforces the radius', () => {
  const geographicTransform = fitGeographicTransform([[-15000, -7000], [9000, 8000]], 1600, 1100, 16);
  const centre = { latitude: 43.59, longitude: -79.54 };
  const stops = [0, .005, .012, .04].map((offset, index) => ({ ...demoData.features[0], id: String(index),
    accessible: index === 1, point: gpsToMap(centre.latitude + offset, centre.longitude, geographicTransform) }));
  const data = { ...demoData, geographicTransform, features: [stops[2], { ...stops[0], id: 'rail-only', boardingPoints: 0 }, stops[1], stops[0], stops[3]] };
  assert.deepEqual(nearbyStops(data, centre).map(stop => stop.feature.id), ['0', '1', '2']);
  assert.deepEqual(nearbyStops(data, centre, true).map(stop => stop.feature.id), ['1']);
  assert.deepEqual(nearbyStops(data, { latitude: 0, longitude: 0 }), []);
});

test('nearby cars require fresh matching route reports within 2 km; results are capped and sorted', () => {
  const cars = [vehicle('4402', '501', 400), vehicle('4401', '501', 100), vehicle('4403', '504', 10),
    vehicle('4404', '501', 10, true), vehicle('4405', undefined, 10), vehicle('4406', '501', 3000),
    vehicle('4407', '501', 700), vehicle('4408', '501', 900)];
  assert.deepEqual(nearbyCars(demoData, demoData.features[0], cars).map(entry => entry.car.vehicle.id), ['4401', '4402', '4407']);
  assert.deepEqual(nearbyCars(demoData, { ...demoData.features[0], routeIds: [] }, cars), []);
});

test('route pulse separates stale cars and calculates median speed from supplied fresh observations, including zero', () => {
  const route = demoData.routes[0];
  const cars = [vehicle('a', '501', 0, false, 0), vehicle('b', '501', 0, false, 10), vehicle('c', '501', 0, true, 100), vehicle('d', '501', 0), vehicle('e', '504', 0, false, 50)];
  assert.deepEqual(routeActivity(route, cars), { reported: 4, fresh: 3, stale: 1, medianSpeed: 18 });
  assert.equal(routeActivity(route, [...cars, vehicle('f', '501', 0, false, 5)]).medianSpeed, 18);
  assert.equal(routeActivity(route, []).medianSpeed, undefined);
});

test('map links safely round-trip stops, routes and streetcars with reserved characters and layer state', () => {
  const filters = { live: false, labels: true, overnight: true };
  for (const kind of ['stop', 'route', 'car']) {
    const selection = { kind, id: 'terminal:Queen & King/#北' };
    assert.deepEqual(readMapLink(mapLinkHash(selection, filters)), { selection, filters });
  }
  assert.equal(mapLinkHash(undefined, DEFAULT_FILTERS), '');
  assert.deepEqual(readMapLink('#stop=&live=yes&labels=1&overnight=0'), { filters: { labels: true, overnight: false } });
  assert.deepEqual(readMapLink(`#car=${'a'.repeat(201)}`), { filters: {} });
  assert.equal(readMapLink('#stop=one&route=two').selection.kind, 'stop');
  assert.deepEqual(readMapLink(mapLinkHash({ kind: 'stop', id: 'queen' }, DEFAULT_FILTERS, '501')), { selection: { kind: 'stop', id: 'queen' }, contextRoute: '501', filters: {} });
  assert.equal(readMapLink('#car=4400&route=501').selection.kind, 'car');
});

test('preferences reject corrupt or oversized stored data', () => {
  assert.equal(validSavedStops(['queen', 'king']), true);
  for (const value of [null, 'queen', [123], [''], ['queen', 'queen'], ['a'.repeat(201)], Array(101).fill('a')]) assert.equal(validSavedStops(value), false);
  assert.equal(validFilters(DEFAULT_FILTERS), true);
  for (const value of [null, [], { live: 'true', labels: false, overnight: false }, { live: true }]) assert.equal(validFilters(value), false);
});
