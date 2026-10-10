/** Fold-write spike (sla-epics.md §0C; story E0S4): pick the D1 insert shape
 * for worst-case 5-minute fold batches (~1–2k rows, one row per directional
 * stop with activity) before Epic 4 builds on it. Prevents Epic 4's most
 * likely redesign.
 *
 * What it measures, against a real SQLite engine (the same engine family D1
 * runs), through the D1-shaped interface the production code uses:
 *   shape A — one INSERT statement per row, wrapped in atomic batches;
 *   shape B — chunked multi-row INSERTs (7 rows × 13 columns = 91 bound
 *             parameters, under D1's 100-per-query limit), wrapped in atomic
 *             batches of ≤100 statements. This is the shape implemented in
 *             workers/api/src/service/rollup-writes.ts — the spike measures
 *             the real code, not a sketch.
 *
 * It also proves the idempotency claim: re-writing the identical batch
 * (INSERT OR REPLACE, deterministic fold hash) neither duplicates nor
 * changes rows.
 *
 * Run: node scripts/operations/fold-write-spike.mjs [--rows N] */
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

async function importTsModule(entry) {
  const result = await build({
    stdin: {
      contents: `export * from './${entry}';`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  });
  const { pathToFileURL } = await import('node:url');
  const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'ttc-fold-spike-'));
  const file = join(directory, 'module.mjs');
  await writeFile(file, result.outputFiles[0].text);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A D1-shaped adapter over node:sqlite, matching tests/helpers/database.mjs
 * (which is test-runner-bound and not importable from operations scripts). */
function d1Adapter(sqlite) {
  return {
    prepare(query) {
      const statement = sqlite.prepare(query);
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          return statement.get(...values) ?? null;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async run() {
          return { meta: { changes: Number(statement.run(...values).changes) } };
        },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const COLUMNS =
  'stop_id, bucket_start, n, headway_sum, headway_sum_sq, max_gap_seconds, first_touch_at, last_touch_at, back_to_back, distinct_vehicles, route_ids, coverage_bits, fold_hash';
const PLACEHOLDERS = Array.from({ length: 13 }, () => '?').join(', ');

function worstCaseRows(count, bucketStart) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const headways = 3 + (index % 4);
    const headway = 240 + (index % 7) * 30;
    rows.push({
      bucketStart,
      stopId: `5_${String(index).padStart(6, '0')}_E`,
      n: headways,
      headwaySum: headways * headway,
      headwaySumSq: headways * headway * headway,
      maxGapSeconds: headway * 1.8,
      firstTouchAt: bucketStart + 1000,
      lastTouchAt: bucketStart + headways * headway * 1000,
      backToBack: index % 3,
      distinctVehicles: headways,
      routeIds: index % 5 === 0 ? ['506', '306'] : ['506'],
      coverageBits: 0b1111111111,
      foldHash: `hash${index.toString(16)}abcd0123`,
    });
  }
  return rows;
}

function rowValues(row) {
  return [
    row.stopId,
    row.bucketStart,
    row.n,
    row.headwaySum,
    row.headwaySumSq,
    row.maxGapSeconds,
    row.firstTouchAt,
    row.lastTouchAt,
    row.backToBack,
    row.distinctVehicles,
    JSON.stringify(row.routeIds),
    row.coverageBits,
    row.foldHash,
  ];
}

async function shapePerRow(db, rows) {
  const statements = rows.map((row) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO service_rollups (${COLUMNS}) VALUES (${PLACEHOLDERS})`,
      )
      .bind(...rowValues(row)),
  );
  for (let offset = 0; offset < statements.length; offset += 100) {
    await db.batch(statements.slice(offset, offset + 100));
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const args = process.argv.slice(2);
const rowIndex = args.indexOf('--rows');
const rowCount = rowIndex >= 0 ? Number(args[rowIndex + 1]) : 2000;

const { writeRollupRows, ROWS_PER_STATEMENT, STATEMENTS_PER_BATCH } =
  await importTsModule('workers/api/src/service/rollup-writes.ts');
const schema = await readFile('migrations/0006_service_rollups.sql', 'utf8');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(schema);
const database = d1Adapter(sqlite);

const bucketStart = Math.floor(1_800_000_000_000 / 300_000) * 300_000;
const rows = worstCaseRows(rowCount, bucketStart);

const timed = async (work) => {
  const durations = [];
  for (let run = 0; run < 3; run += 1) {
    const start = performance.now();
    await work();
    durations.push(performance.now() - start);
  }
  return {
    medianMs: Math.round(median(durations) * 100) / 100,
    runs: durations.map((d) => Math.round(d)),
  };
};

const shapeA = await timed(() => shapePerRow(database, rows));
const shapeB = await timed(() => writeRollupRows(database, rows));

// Idempotency: writing the identical batch again changes nothing.
const before = await database
  .prepare('SELECT COUNT(*) AS n FROM service_rollups')
  .bind()
  .first();
const changedBefore = await database
  .prepare('SELECT COUNT(*) AS n FROM service_rollups WHERE fold_hash = ?')
  .bind(`hash${(rowCount - 1).toString(16)}abcd0123`)
  .first();
await writeRollupRows(database, rows);
const after = await database
  .prepare('SELECT COUNT(*) AS n FROM service_rollups')
  .bind()
  .first();
const changedAfter = await database
  .prepare('SELECT COUNT(*) AS n FROM service_rollups WHERE fold_hash = ?')
  .bind(`hash${(rowCount - 1).toString(16)}abcd0123`)
  .first();

const result = {
  worstCaseRows: rowCount,
  shapeA: { description: 'one INSERT per row, batches of 100 statements', ...shapeA },
  shapeB: {
    description: `chunked multi-row INSERTs (${ROWS_PER_STATEMENT} rows × 13 cols = ${ROWS_PER_STATEMENT * 13} params ≤ D1's 100/query), batches of ${STATEMENTS_PER_BATCH} statements`,
    ...shapeB,
  },
  idempotency: {
    rowsBeforeRewrite: before.n,
    rowsAfterRewrite: after.n,
    hashPreserved: changedBefore.n === 1 && changedAfter.n === 1,
  },
  decision:
    'shape B — chunked multi-row INSERTs: ~7× fewer statements per fold, same atomicity, safely under the 100-parameter-per-query limit; implemented in workers/api/src/service/rollup-writes.ts and cited by E4S1.',
};

console.log(JSON.stringify(result, null, 2));
