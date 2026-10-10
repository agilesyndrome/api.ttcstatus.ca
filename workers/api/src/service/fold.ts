/** Fold mechanics + 36-hour retention (sla.md stories 4.1, 4.2, 4.5).
 * Foldable, testable without a DO runtime: everything here takes the window
 * store, the D1 database, and the clock — the DO shell calls `runFoldCycle`
 * once per tick.
 *
 * Timing (the leading-gap design, recorded in sla-chatter.md): a bucket
 * folds as soon as it completes, while its raw rows — and the predecessor
 * touch — are still inside the 30-minute window. Refolding an identical
 * bucket from the same surviving raw rows produces the identical row
 * (deterministic hash, INSERT OR REPLACE): idempotency by construction.
 * A failed D1 write leaves the fold marker untouched, so the next tick
 * retries with the same inputs — loudly, never silently (story 4.5). The
 * 36-hour retention means yesterday's history survives an overnight fold
 * bug (the reason the number is 36). */

import type { D1Database } from '../../../shared/cloudflare/bindings';
import type { CoverageInterval } from '../../../../shared/service/contracts';
import {
  SERVICE_BUCKET_SECONDS,
  SERVICE_WINDOW_SECONDS,
} from '../../../../shared/service/config';
import type { ServiceConfig } from '../../../../shared/service/config';
import { deriveRollupRow } from '../../../../shared/service/wait-metrics';
import { writeRollupRows } from './rollup-writes';
import type { WindowStore } from './window-store';

export interface FoldOutcome {
  /** Buckets folded (0 or 1 per tick in steady state: 5 divides 30, so
   * exactly one bucket completes every 5 minutes). */
  bucketsFolded: number;
  rowsWritten: number;
  /** The boundary through which every bucket is now folded (epoch ms). */
  foldedThrough: number;
  /** Rollup rows pruned by the rolling 36-hour retention (hourly). */
  rowsPruned: number | null;
}

export class FoldError extends Error {
  constructor(
    message: string,
    readonly bucketStart: number,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

const HOUR_MS = 3_600_000;

/** One fold cycle. Folds every completed-but-unfolded bucket whose raw rows
 * still survive (5 divides 30, so exactly one completes every 5 minutes),
 * then runs the hourly retention prune. Throws FoldError on a D1 write
 * failure — the caller records it loudly and retries next tick; the raw rows
 * age out per the 30-minute policy either way (story 4.5). The 36-hour
 * retention means yesterday's history survives an overnight fold bug. */
export async function runFoldCycle(
  store: WindowStore,
  db: D1Database,
  config: ServiceConfig,
  now: number,
  coverage: CoverageInterval[],
): Promise<FoldOutcome> {
  const bucketMs = SERVICE_BUCKET_SECONDS * 1000;
  const windowStart = now - SERVICE_WINDOW_SECONDS * 1000;
  // The newest completed bucket ends at the boundary at or before now.
  const completedEnd = Math.floor(now / bucketMs) * bucketMs;
  const previousThrough = Number(store.loadMeta('foldedThrough') ?? '0') || 0;
  // Never fold buckets whose raw rows may have aged: the marker clamps to the
  // window. A skipped bucket is an honest gap — "loudly missing", never
  // fabricated from data that is gone.
  const oldestFoldableStart = Math.ceil(windowStart / bucketMs) * bucketMs;
  const previousMarker = Math.max(previousThrough, 0);
  let foldedThrough = Math.max(
    previousMarker,
    oldestFoldableStart === 0 ? previousMarker : oldestFoldableStart - bucketMs,
  );
  if (completedEnd === 0) {
    return { bucketsFolded: 0, rowsWritten: 0, foldedThrough, rowsPruned: null };
  }
  let bucketsFolded = 0;
  let rowsWritten = 0;
  while (foldedThrough + bucketMs <= completedEnd) {
    const bucketStart = foldedThrough;
    const rows = await foldBucket(
      store,
      db,
      bucketStart,
      bucketStart + bucketMs,
      coverage,
    );
    try {
      await writeRollupRows(db, rows);
    } catch (error) {
      throw new FoldError(
        `Fold write failed for bucket ${bucketStart} (${rows.length} rows)`,
        bucketStart,
        error,
      );
    }
    rowsWritten += rows.length;
    bucketsFolded += 1;
    foldedThrough += bucketMs;
    store.saveMeta('foldedThrough', String(foldedThrough));
  }
  if (foldedThrough > previousThrough && bucketsFolded === 0) {
    store.saveMeta('foldedThrough', String(foldedThrough));
  }

  // Hourly retention: prune rollups older than the configured history hours.
  let rowsPruned: number | null = null;
  const lastRetention = Number(store.loadMeta('retentionCheckedAt') ?? '0') || 0;
  if (now - lastRetention >= HOUR_MS) {
    const cutoff = now - config.historyHours * HOUR_MS;
    const result = await db
      .prepare(`DELETE FROM service_rollups WHERE bucket_start < ?`)
      .bind(cutoff)
      .run();
    rowsPruned = result.meta?.changes ?? 0;
    store.saveMeta('retentionCheckedAt', String(now));
  }
  return { bucketsFolded, rowsWritten, foldedThrough, rowsPruned };
}

/** Derive one bucket's rollup rows from surviving raw window rows — the same
 * inputs always produce the same rows (byte-identical refold). The
 * predecessor touch may have aged out of the window; the folded history
 * itself remembers it (a stable D1 read), so the leading gap survives. */
async function foldBucket(
  store: WindowStore,
  db: D1Database,
  bucketStart: number,
  bucketEnd: number,
  coverage: CoverageInterval[],
) {
  const stopIds = store.stopIdsWithTouches(bucketStart, bucketEnd);
  const rows = [];
  for (const stopId of stopIds) {
    const touches = store.loadStopTouches(stopId, bucketStart, bucketEnd);
    let previousTouchAt = store.lastTouchAtBefore(stopId, bucketStart);
    if (previousTouchAt === null) {
      const folded = await db
        .prepare(
          `SELECT last_touch_at FROM service_rollups
           WHERE stop_id = ? AND bucket_start < ? AND last_touch_at IS NOT NULL
           ORDER BY bucket_start DESC LIMIT 1`,
        )
        .bind(stopId, bucketStart)
        .first<{ last_touch_at: number }>();
      previousTouchAt = folded?.last_touch_at ?? null;
    }
    rows.push(
      deriveRollupRow(
        stopId,
        bucketStart,
        SERVICE_BUCKET_SECONDS,
        touches,
        coverage,
        previousTouchAt,
      ),
    );
  }
  return rows;
}
