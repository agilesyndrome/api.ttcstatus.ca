import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';
const { savedStopStatus, demoData, demoSnapshot, projectSnapshot } =
  await compileModules(`
export * from './web/ui/features/stops/saved-stop-status';
export * from './web/ui/stories/fixtures';
export * from './shared/map/live-status';`);
const now = Date.parse(demoSnapshot.fetchedAt);
const cars = projectSnapshot(demoData, demoSnapshot, now);

test('saved streetcar stops show proximity only and respect paused, missing and unavailable feeds', () => {
  const feature = demoData.features[0];
  assert.deepEqual(savedStopStatus(demoData, feature, demoSnapshot, cars, now, true), [
    'Car 4400 · 100 m away',
  ]);
  assert.deepEqual(savedStopStatus(demoData, feature, demoSnapshot, cars, now, false), [
    'Live updates off',
  ]);
  assert.deepEqual(savedStopStatus(demoData, feature, undefined, [], now, true), [
    'Waiting for live reports',
  ]);
  assert.deepEqual(
    savedStopStatus(
      demoData,
      feature,
      { ...demoSnapshot, surfaceStatus: 'unavailable' },
      cars,
      now,
      true,
    ),
    ['Streetcar positions unavailable'],
  );
  assert.deepEqual(
    savedStopStatus(
      demoData,
      feature,
      demoSnapshot,
      cars.map((car) => ({ ...car, stale: true })),
      now,
      true,
    ),
    ['No fresh streetcars within 2 km'],
  );
  assert.deepEqual(
    savedStopStatus(
      demoData,
      { ...feature, boardingPoints: 0 },
      demoSnapshot,
      cars,
      now,
      true,
    ),
    [],
  );
});

test('mixed stops summarize subway arrivals independently of surface failure and expire old reports', () => {
  const data = { ...demoData, routes: [...demoData.routes, { id: '1', number: '1' }] };
  const feature = { ...demoData.features[0], routeIds: ['1', '501'] };
  const snapshot = {
    ...demoSnapshot,
    surfaceStatus: 'unavailable',
    subwayPredictions: [
      {
        id: 'train',
        label: '15',
        routeId: '1',
        observedAt: demoSnapshot.fetchedAt,
        stops: [
          {
            stopId: 'queen-e',
            sequence: 1,
            arrivalAt: new Date(now + 300000).toISOString(),
          },
        ],
      },
    ],
  };
  assert.deepEqual(savedStopStatus(data, feature, snapshot, cars, now, true), [
    'Line 1 · 5 min',
    'Streetcar positions unavailable',
  ]);
  assert.deepEqual(savedStopStatus(data, feature, snapshot, cars, now + 121000, true), [
    'No fresh train predictions',
    'Streetcar positions unavailable',
  ]);
  assert.deepEqual(
    savedStopStatus(
      data,
      feature,
      { ...snapshot, subwayStatus: 'unavailable' },
      cars,
      now,
      true,
    ),
    ['Train predictions unavailable', 'Streetcar positions unavailable'],
  );
});
