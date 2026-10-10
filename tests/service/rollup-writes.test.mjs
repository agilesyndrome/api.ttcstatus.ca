import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createDatabase } from '../helpers/database.mjs';
import { compileModules } from '../helpers/compile.mjs';

const { writeRollupRows, chunkRows, ROWS_PER_STATEMENT } = await compileModules(
  `export * from './workers/api/src/service/rollup-writes';`,
);
const schema = await readFile('migrations/0006_service_rollups.sql', 'utf8');
const database = () => createDatabase(schema);

const T0 = 1_800_000_000_000;
const row = (index, overrides = {}) => ({
  bucketStart: T0,
  stopId: `stop_${index}`,
  n: 2,
  headwaySum: 1200,
  headwaySumSq: 720000,
  maxGapSeconds: 600,
  firstTouchAt: T0 + 1000,
  lastTouchAt: T0 + 1200000,
  backToBack: 0,
  distinctVehicles: 3,
  routeIds: ['506'],
  coverageBits: 0b1111111111,
  foldHash: index.toString(16).padStart(16, '0'),
  ...overrides,
});

test('E0S4/E4S1: fold batches write idempotently through real SQLite', async () => {
  const db = database();
  const rows = Array.from({ length: 15 }, (_, index) => row(index));
  const written = await writeRollupRows(db, rows);
  assert.equal(written, 15);
  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM service_rollups')
    .bind()
    .first();
  assert.equal(count.n, 15);

  // Re-writing the identical batch (a DO restart refold) neither duplicates
  // nor mutates: INSERT OR REPLACE over the same (stop_id, bucket_start).
  await writeRollupRows(db, rows);
  const after = await db
    .prepare('SELECT COUNT(*) AS n FROM service_rollups')
    .bind()
    .first();
  assert.equal(after.n, 15);

  // A genuinely different derivation for the same key replaces the row.
  await writeRollupRows(db, [row(0, { n: 3, foldHash: 'f'.repeat(16) })]);
  const updated = await db
    .prepare('SELECT n, fold_hash FROM service_rollups WHERE stop_id = ?')
    .bind('stop_0')
    .first();
  assert.equal(updated.n, 3);
  assert.equal(updated.fold_hash, 'f'.repeat(16));
  const total = await db
    .prepare('SELECT COUNT(*) AS n FROM service_rollups')
    .bind()
    .first();
  assert.equal(total.n, 15);

  // Values round-trip, including JSON route_ids.
  const read = await db
    .prepare(
      'SELECT route_ids, coverage_bits, headway_sum FROM service_rollups WHERE stop_id = ?',
    )
    .bind('stop_1')
    .first();
  assert.deepEqual(JSON.parse(read.route_ids), ['506']);
  assert.equal(read.coverage_bits, 0b1111111111);
  assert.equal(read.headway_sum, 1200);
});

test('E0S4: chunking keeps every statement inside D1 parameter limits', () => {
  assert.equal(ROWS_PER_STATEMENT * 13 <= 100, true);
  const chunks = chunkRows(
    Array.from({ length: 2000 }, (_, index) => row(index % 15)),
    ROWS_PER_STATEMENT,
  );
  assert.equal(chunks.length, Math.ceil(2000 / ROWS_PER_STATEMENT));
  assert.ok(chunks.every((chunk) => chunk.length <= ROWS_PER_STATEMENT));
});
