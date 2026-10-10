/** The window store (sla.md story 1.5): the rolling 30 minutes of touch
 * events and coverage intervals, persisted to the Durable Object's SQL so an
 * isolate eviction or redeploy cannot hole the window — SQL storage, not
 * memory. The same store feeds folds (E4S1: buckets derive deterministically
 * from surviving raw rows) and the live states.
 *
 * The SQL surface is a single `exec(query, ...bindings) → { toArray() }`
 * shape, satisfied both by the DO runtime's `state.storage.sql` and by
 * node:sqlite in the test harness — one implementation, no DO runtime
 * needed for tests (story 1.6). */

import type { CoverageInterval, TouchEvent } from '../../../../shared/service/contracts';

export interface SqlCursorLike {
  toArray(): unknown[];
}

export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS touches (
     t INTEGER NOT NULL,
     stop_id TEXT NOT NULL,
     direction_id INTEGER NOT NULL,
     mode TEXT NOT NULL,
     vehicle_id TEXT NOT NULL,
     route_id TEXT NOT NULL,
     ambiguous INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_touches_t ON touches (t)`,
  `CREATE INDEX IF NOT EXISTS idx_touches_stop_t ON touches (stop_id, t)`,
  `CREATE TABLE IF NOT EXISTS coverage (
     from_t INTEGER NOT NULL,
     to_t INTEGER NOT NULL,
     mode TEXT NOT NULL,
     kind TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS recorder_state (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
];

export class WindowStore {
  constructor(private readonly sql: SqlLike) {}

  initialize(): void {
    for (const statement of SCHEMA) this.sql.exec(statement);
  }

  insertTouches(touches: TouchEvent[]): void {
    for (const touch of touches) {
      this.sql.exec(
        `INSERT INTO touches (t, stop_id, direction_id, mode, vehicle_id, route_id, ambiguous)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        touch.t,
        touch.stopId,
        touch.directionId,
        touch.mode,
        touch.vehicleId,
        touch.routeId,
        touch.ambiguous ? 1 : 0,
      );
    }
  }

  insertCoverage(intervals: CoverageInterval[]): void {
    for (const interval of intervals) {
      this.sql.exec(
        `INSERT INTO coverage (from_t, to_t, mode, kind) VALUES (?, ?, ?, ?)`,
        interval.from,
        interval.to,
        interval.mode,
        interval.kind,
      );
    }
  }

  /** Prune raw rows older than the window. An interval ending exactly at the
   * window start contributes nothing and goes; a touch exactly at the window
   * start stays (it anchors the first gap's censoring). Returns rows removed. */
  prune(olderThan: number): number {
    const coverage = this.sql
      .exec(`DELETE FROM coverage WHERE to_t <= ? RETURNING from_t`, olderThan)
      .toArray();
    const touches = this.sql
      .exec(`DELETE FROM touches WHERE t < ? RETURNING t`, olderThan)
      .toArray();
    return coverage.length + touches.length;
  }

  loadTouches(from: number, to?: number): TouchEvent[] {
    const rows = to
      ? this.sql
          .exec(
            `SELECT * FROM touches WHERE t >= ? AND t <= ? ORDER BY t, stop_id`,
            from,
            to,
          )
          .toArray()
      : this.sql
          .exec(`SELECT * FROM touches WHERE t >= ? ORDER BY t, stop_id`, from)
          .toArray();
    return (rows as Array<Record<string, unknown>>).map(rowToTouch);
  }

  loadCoverage(): CoverageInterval[] {
    const rows = this.sql.exec(`SELECT * FROM coverage ORDER BY from_t`).toArray();
    return (rows as Array<Record<string, unknown>>).map(rowToCoverage);
  }

  /** The last observed touch strictly before `t` — fold predecessors (E4S1). */
  lastTouchAtBefore(stopId: string, t: number): number | null {
    const rows = this.sql
      .exec(`SELECT MAX(t) AS t FROM touches WHERE stop_id = ? AND t < ?`, stopId, t)
      .toArray() as Array<{ t: number | null }>;
    return rows[0]?.t ?? null;
  }

  /** Touches for one stop inside a bucket span, in order (fold input). */
  loadStopTouches(stopId: string, from: number, to: number): TouchEvent[] {
    const rows = this.sql
      .exec(
        `SELECT * FROM touches WHERE stop_id = ? AND t >= ? AND t < ? ORDER BY t`,
        stopId,
        from,
        to,
      )
      .toArray();
    return (rows as Array<Record<string, unknown>>).map(rowToTouch);
  }

  /** Distinct stop ids with touches in a span (which stops a bucket fold
   * must cover). */
  stopIdsWithTouches(from: number, to: number): string[] {
    const rows = this.sql
      .exec(
        `SELECT DISTINCT stop_id FROM touches WHERE t >= ? AND t < ? ORDER BY stop_id`,
        from,
        to,
      )
      .toArray() as Array<{ stop_id: string }>;
    return rows.map((row) => row.stop_id);
  }

  saveMeta(key: string, value: string): void {
    this.sql.exec(
      `INSERT INTO recorder_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      'meta:' + key,
      value,
    );
  }

  loadMeta(key: string): string | null {
    const rows = this.sql
      .exec(`SELECT value FROM recorder_state WHERE key = ?`, 'meta:' + key)
      .toArray() as Array<{ value: string }>;
    return rows[0]?.value ?? null;
  }

  saveState(state: string): void {
    this.sql.exec(
      `INSERT INTO recorder_state (key, value) VALUES ('state', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      state,
    );
  }

  loadState(): string | null {
    const rows = this.sql
      .exec(`SELECT value FROM recorder_state WHERE key = 'state'`)
      .toArray() as Array<{ value: string }>;
    return rows[0]?.value ?? null;
  }

  touchCount(): number {
    const rows = this.sql.exec(`SELECT COUNT(*) AS n FROM touches`).toArray() as Array<{
      n: number;
    }>;
    return rows[0]?.n ?? 0;
  }
}

type TouchRow = {
  t: number;
  stop_id: string;
  direction_id: number;
  mode: string;
  vehicle_id: string;
  route_id: string;
  ambiguous: number;
};

function rowToTouch(row: Record<string, unknown>): TouchEvent {
  const typed = row as unknown as TouchRow;
  const touch: TouchEvent = {
    t: typed.t,
    stopId: typed.stop_id,
    directionId: typed.direction_id === 1 ? 1 : 0,
    mode: typed.mode === 'subway' ? 'subway' : 'streetcar',
    vehicleId: typed.vehicle_id,
    routeId: typed.route_id,
  };
  if (typed.ambiguous) touch.ambiguous = true;
  return touch;
}

type CoverageRow = { from_t: number; to_t: number; mode: string; kind: string };

function rowToCoverage(row: Record<string, unknown>): CoverageInterval {
  const typed = row as unknown as CoverageRow;
  return {
    from: typed.from_t,
    to: typed.to_t,
    mode: typed.mode === 'subway' ? 'subway' : 'streetcar',
    kind:
      typed.kind === 'outage'
        ? 'outage'
        : typed.kind === 'no-reports'
          ? 'no-reports'
          : 'observable',
  };
}
