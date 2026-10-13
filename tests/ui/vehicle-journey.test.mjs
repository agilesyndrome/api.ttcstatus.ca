import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { vehicleJourney } = await compileModules(`
  export { vehicleJourney } from './web/ui/features/stops/vehicle-journey';
`);

const feature = (id, x) => ({
  id,
  name: `Stop ${id}`,
  point: [x, 0],
  routeIds: ['505'],
  stopIds: [id],
});
const data = {
  features: [feature('a', 0), feature('b', 10), feature('c', 20), feature('d', 30)],
  patterns: [
    { routeId: '505', headsign: 'Eastbound', stopIds: ['a', 'b', 'c', 'd'] },
    { routeId: '505', headsign: 'Westbound', stopIds: ['d', 'c', 'b', 'a'] },
  ],
};
const car = (x, angle) => ({
  vehicle: { id: '4607', routeId: '505', mode: 'streetcar' },
  point: [x, 0],
  angle,
  match: { edgeId: 'route-505', distanceAlongMetres: x, direction: 1 },
});

test('a moving car advances through the scheduled order in its travel direction', () => {
  const first = vehicleJourney(data, car(15, 0));
  assert.equal(first.headsign, 'Eastbound');
  assert.deepEqual(
    first.previous.map((stop) => stop.name),
    ['Stop a', 'Stop b'],
  );
  assert.deepEqual(
    first.upcoming.map((stop) => stop.name),
    ['Stop c', 'Stop d'],
  );

  const later = vehicleJourney(data, car(25, 0));
  assert.deepEqual(
    later.previous.map((stop) => stop.name),
    ['Stop a', 'Stop b', 'Stop c'],
  );
  assert.deepEqual(
    later.upcoming.map((stop) => stop.name),
    ['Stop d'],
  );

  const returning = vehicleJourney(data, car(15, 180));
  assert.equal(returning.headsign, 'Westbound');
  assert.deepEqual(
    returning.upcoming.map((stop) => stop.name),
    ['Stop b', 'Stop a'],
  );
});

test('the journey is withheld when the car cannot be placed on its route', () => {
  assert.equal(vehicleJourney(data, { ...car(15, 0), match: undefined }), null);
  assert.equal(vehicleJourney(data, car(400, 0)), null);
});
