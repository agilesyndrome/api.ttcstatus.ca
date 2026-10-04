import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { stationArrivals, arrivalCountdown, nearbyCars, demoData, demoSnapshot } =
  await compileModules(`
    export * from './web/ui/features/stops/arrivals';
    export * from './web/ui/commute';
    export * from './web/ui/stories/fixtures';
  `);
const now = Date.parse(demoSnapshot.fetchedAt);
const at = (seconds) => new Date(now + seconds * 1000).toISOString();
const feature = { ...demoData.features[0], routeIds: ['1'], stopIds: ['a', 'b'] };
const data = {
  ...demoData,
  routes: [...demoData.routes, { id: '1', number: '1' }],
  features: [feature, { ...demoData.features[1], routeIds: ['1'], stopIds: ['next'] }],
};
const train = (id, seconds = 90, extra = {}) => ({
  id,
  label: id,
  tripId: id,
  routeId: '1',
  observedAt: at(0),
  stops: [
    { stopId: 'earlier', sequence: 1, arrivalAt: at(30) },
    { stopId: 'a', sequence: 2, arrivalAt: at(seconds) },
    { stopId: 'next', sequence: 3, arrivalAt: at(seconds + 60) },
  ],
  ...extra,
});
const snapshot = (trains, extra = {}) => ({
  ...demoSnapshot,
  subwayStatus: 'available',
  subwayPredictions: trains,
  ...extra,
});

test('arrivals match downstream boarding IDs and routes, sort by time and name the next reported station', () => {
  const result = stationArrivals(
    data,
    feature,
    snapshot([
      train('later', 180),
      train('first', 60),
      train('other-line', 30, { routeId: '2' }),
      train('other-stop', 30, {
        stops: [{ stopId: 'elsewhere', sequence: 1, arrivalAt: at(30) }],
      }),
    ]),
    now,
  );
  assert.deepEqual(
    result.map((row) => row.train.id),
    ['first', 'later'],
  );
  assert.equal(result[0].onward, data.features[1].name);
  assert.equal(result[0].arrivalAt, at(60));
  assert.deepEqual(
    stationArrivals(
      data,
      { ...feature, stopIds: undefined },
      snapshot([train('a')]),
      now,
    ),
    [],
  );
});

test('expired, invalid, stale, missing-time and future-dated reports never become arrivals', () => {
  const reports = snapshot([
    train('departed', -1),
    train('invalid', 90, { stops: [{ stopId: 'a', sequence: 1, arrivalAt: 'bad' }] }),
    train('stale', 90, { observedAt: at(-121) }),
    train('missing', 90, { observedAt: null }),
    train('future', 90, { observedAt: at(61) }),
    train('due', 0),
  ]);
  assert.deepEqual(
    stationArrivals(data, feature, reports, now).map((row) => row.train.id),
    ['due'],
  );
  assert.deepEqual(stationArrivals(data, feature, reports, now + 121000), []);
  assert.deepEqual(
    stationArrivals(
      data,
      feature,
      snapshot([train('a')], { subwayStatus: 'unavailable' }),
      now,
    ),
    [],
  );
});

test('one arrival per train even with multiple matching platforms; at most six upcoming trains', () => {
  const duplicate = train('duplicate', 90);
  duplicate.stops.push({ stopId: 'b', sequence: 4, arrivalAt: at(150) });
  assert.equal(stationArrivals(data, feature, snapshot([duplicate]), now).length, 1);
  const rows = stationArrivals(
    data,
    feature,
    snapshot(Array.from({ length: 10 }, (_, i) => train(String(i), 60 + i * 10))),
    now,
  );
  assert.deepEqual(
    rows.map((row) => row.train.id),
    ['0', '1', '2', '3', '4', '5'],
  );
  assert.equal(arrivalCountdown(at(59), now), 'Due');
  assert.equal(arrivalCountdown(at(60), now), '1 min');
  assert.equal(arrivalCountdown(at(61), now), '2 min');
});

test('predicted stations and subway GPS fixes never appear as nearby streetcars', () => {
  const car = {
    vehicle: demoSnapshot.vehicles[0],
    stale: false,
    point: [0, 0],
    angle: 0,
  };
  const cars = [
    car,
    {
      ...car,
      vehicle: { ...car.vehicle, id: 'prediction', positionKind: 'next-station' },
    },
    { ...car, vehicle: { ...car.vehicle, id: 'subway', mode: 'subway' } },
    { ...car, vehicle: { ...car.vehicle, id: 'line-1', routeId: '1' } },
  ];
  assert.deepEqual(
    nearbyCars(data, { ...feature, routeIds: ['1', '501'] }, cars).map(
      (row) => row.car.vehicle.id,
    ),
    ['4400'],
  );
});
