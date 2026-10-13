import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: `
  export * from "./workers/api/src/realtime/tick-doc";`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
});
const { buildTickDocument, tickIdAt } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

// Fixture fleet snapshot (shape of shared/live/vehicles VehicleSnapshot).
const fleet = {
  schemaVersion: 1,
  fetchedAt: '2026-10-12T14:00:02.000Z',
  feedTimestamp: '2026-10-12T14:00:01.000Z',
  source: 'https://bustime.ttc.ca/gtfsrt/vehicles',
  attribution:
    'Contains information licensed under the Open Government Licence - Toronto',
  vehicles: [
    {
      id: '4401',
      label: '4401',
      latitude: 43.65,
      longitude: -79.38,
      observedAt: '2026-10-12T14:00:01.000Z',
    },
  ],
  invalidPositions: 0,
};

test('fleet snapshot publishes with tickId and no outage', () => {
  const doc = buildTickDocument(fleet, 1_728_720);
  assert.equal(doc.tickId, 1_728_720);
  assert.equal(doc.vehicles.length, 1);
  assert.equal(doc.outage, undefined);
  // Byte-compatible superset: every public response field survives.
  for (const key of Object.keys(fleet)) assert.ok(key in doc);
});

test('total upstream failure publishes an outage doc', () => {
  const doc = buildTickDocument(null, 4_000, {
    tickMs: 30_000,
    source: fleet.source,
    attribution: fleet.attribution,
  });
  assert.deepEqual(doc.vehicles, []);
  assert.equal(doc.tickId, 4_000);
  // since = the start of the tick that observed the failure (grid-derivable).
  assert.equal(doc.outage.since, new Date(4_000 * 30_000).toISOString());
  assert.equal(doc.outage.tickId, 4_000);
  assert.equal(doc.attribution, fleet.attribution);
  // Still a valid snapshot shape — cacheable broadcast data.
  assert.equal(doc.schemaVersion, 1);
});

test('empty-but-valid fleet is not an outage', () => {
  const doc = buildTickDocument({ ...fleet, vehicles: [] }, 5);
  assert.deepEqual(doc.vehicles, []);
  assert.equal(doc.outage, undefined);
  assert.equal(doc.tickId, 5);
});

test('tick derivation is the shared floor(epoch / (seconds*1000)) grid', () => {
  const tickMs = 30_000;
  assert.equal(tickIdAt(0, 30), 0);
  assert.equal(tickIdAt(tickMs - 1, 30), 0);
  assert.equal(tickIdAt(tickMs, 30), 1);
  // Skewed clocks land one tick ahead — the client's 404 → tick−1 path.
  assert.equal(tickIdAt(tickMs + 5_000, 30), 1);
});
