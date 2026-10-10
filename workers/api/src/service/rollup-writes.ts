/** D1 writes for fold batches (E4S1) — the insert shape chosen by the Stage 0
 * fold-write spike (E0S4). Rows are written idempotently: identical content
 * derives an identical foldHash and `INSERT OR REPLACE` keyed on
 * (stop_id, bucket_start), so a DO restart that refolds a bucket from
 * surviving raw rows writes the identical row and changes nothing.
 *
 * Shape (measured, see scripts/operations/fold-write-spike.mjs): chunked
 * multi-row INSERT statements — 7 rows per statement (13 columns × 7 = 91
 * bound parameters, under D1's 100-per-query limit) — wrapped in atomic
 * D1 batches of ≤100 statements (~700 rows per batch call). */

import type { D1Database } from '../../../shared/cloudflare/bindings';
import type { RollupRow } from '../../../../shared/service/contracts';

export const ROLLUP_COLUMNS = [
  'stop_id',
  'bucket_start',
  'n',
  'headway_sum',
  'headway_sum_sq',
  'max_gap_seconds',
  'first_touch_at',
  'last_touch_at',
  'back_to_back',
  'distinct_vehicles',
  'route_ids',
  'coverage_bits',
  'fold_hash',
] as const;

/** 7 rows × 13 columns = 91 parameters ≤ D1's 100-per-query limit. */
export const ROWS_PER_STATEMENT = 7;
/** Keep each D1 batch() call bounded (~700 rows per transaction). */
export const STATEMENTS_PER_BATCH = 100;

export function chunkRows<T>(rows: T[], perChunk: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += perChunk) {
    chunks.push(rows.slice(index, index + perChunk));
  }
  return chunks;
}

function rowValues(row: RollupRow): Array<string | number | null> {
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
    row.foldHash ?? '',
  ];
}

/** Write a fold batch idempotently (INSERT OR REPLACE, deterministic hash). */
export async function writeRollupRows(
  db: D1Database,
  rows: RollupRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const chunks = chunkRows(rows, ROWS_PER_STATEMENT);
  const statements: Array<{ sql: string; params: Array<string | number | null> }> = [];
  for (const chunk of chunks) {
    const valueRows = chunk.map(() => `(${ROLLUP_COLUMNS.map(() => '?').join(', ')})`);
    const sql = `INSERT OR REPLACE INTO service_rollups (${ROLLUP_COLUMNS.join(', ')})
      VALUES ${valueRows.join(', ')}`;
    const params = chunk.flatMap(rowValues);
    statements.push({ sql, params });
  }
  for (let offset = 0; offset < statements.length; offset += STATEMENTS_PER_BATCH) {
    const slice = statements.slice(offset, offset + STATEMENTS_PER_BATCH);
    await db.batch(
      slice.map((statement) => db.prepare(statement.sql).bind(...statement.params)),
    );
  }
  return rows.length;
}
