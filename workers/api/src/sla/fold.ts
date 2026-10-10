/** Tier 3: daily and weekly SLA folds (docs/sla-stories.md Epic 8, E8S3).
 *
 * The answer to "this cannot be computed in real time": an hourly cron folds
 * the 5-minute rollup tier into long-lived daily and weekly SLA rows — per
 * directional stop and per route — BEFORE the 36-hour retention can prune a
 * day away. The /sla endpoints read only these rows; nothing at request time
 * ever derives a compliance number.
 *
 * Honesty rules, inherited unchanged (sla.md §3.6):
 *  - A day is folded only while its FULL data still survives retention; a day
 *    that aged out before its fold is skipped forward WITHOUT rows — an
 *    honest absence on the page, never a fabricated zero (and never a
 *    partial day mislabeled final).
 *  - Hours with no scheduled service carry no promise and contribute neither
 *    numerator nor denominator.
 *  - Unmonitored time never counts for or against compliance: the moment
 *    denominator is Σh — the gap time actually observed.
 *  - Today's segment is folded as an explicitly partial row (`final = 0`),
 *    refreshed each run — the page shows real-time recording being absorbed
 *    honestly, never computed for the visitor.
 *
 * Idempotency: foldDay(D) is a deterministic function of the rollup rows for
 * D — same inputs, same row values (computed_at excepted), so re-running or
 * backfilling a missed hour reproduces byte-identical metrics. */

import type { D1Database } from '../../../shared/cloudflare/bindings';
import { SOURCE_KEY } from '../sync/sync-common';
import type { ServiceConfig } from '../../../../shared/service/config';
import {
  mergeSlaParts,
  slaComplianceParts,
  slaThresholdSeconds,
  torontoDayKey,
  torontoDayStartMs,
  torontoWeekKey,
  type SlaComplianceParts,
} from '../../../../shared/service/sla-metrics';

/** Toronto wall-clock offset resolver for one day window: DST transitions are
 * found by probe (a handful of Intl calls per fold — only DST days differ). */
class TorontoOffset {
  private readonly startOffsetMs: number;
  private readonly transitionAt: number | null;
  private readonly afterOffsetMs: number;

  constructor(dayStart: number, dayEnd: number) {
    this.startOffsetMs = TorontoOffset.probe(dayStart);
    const endOffsetMs = TorontoOffset.probe(dayEnd - 1);
    if (this.startOffsetMs === endOffsetMs) {
      this.transitionAt = null;
      this.afterOffsetMs = this.startOffsetMs;
      return;
    }
    let low = dayStart;
    let high = dayEnd - 1;
    while (high - low > 60_000) {
      const mid = Math.floor((low + high) / 2);
      if (TorontoOffset.probe(mid) === this.startOffsetMs) low = mid;
      else high = mid;
    }
    this.transitionAt = high;
    this.afterOffsetMs = endOffsetMs;
  }

  at(epochMs: number): number {
    return this.transitionAt !== null && epochMs >= this.transitionAt
      ? this.afterOffsetMs
      : this.startOffsetMs;
  }

  private static probe(epochMs: number): number {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      timeZoneName: 'longOffset',
    }).format(new Date(epochMs));
    const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(formatted);
    if (!match) return -5 * 3_600_000;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 3_600_000 + Number(match[3] ?? '0') * 60_000);
  }
}

export interface SlaStopTarget {
  name: string;
  directionId: 0 | 1;
  routeIds: string[];
  headways: Record<string, Array<number | null>>;
}

export interface SlaRouteTarget {
  number: string;
  name: string;
  overnight: boolean;
  headways: Record<string, Array<number | null>>;
  stopIds: string[];
}

interface LoadedTargets {
  versionId: number;
  dates: Map<string, string>;
  stops: Map<string, SlaStopTarget>;
  routes: Map<string, SlaRouteTarget>;
}

export interface SlaFoldResult {
  status: 'ok' | 'no-targets' | 'no-data';
  versionId: number | null;
  foldedDays: string[];
  skippedDays: Array<{ dayKey: string; reason: string }>;
  todayPartial: string | null;
  weeks: string[];
}

const META_FOLDED_THROUGH = 'folded_through';
const META_RAN_AT = 'ran_at';
const CHUNK_MS = 6 * 3_600_000;

function popcount(bits: number): number {
  let count = 0;
  let value = bits;
  while (value) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

/** Calendar arithmetic on 'YYYY-MM-DD' keys — pure date strings, DST-proof. */
function dayKeyPlus(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

async function loadActiveVersionId(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT active_version_id AS version_id FROM source_state
       WHERE source_key = ? LIMIT 1`,
    )
    .bind(SOURCE_KEY)
    .first<{ version_id: number | null }>();
  return row?.version_id ?? null;
}

async function loadSlaTargets(db: D1Database, versionId: number): Promise<LoadedTargets> {
  const dates = new Map<string, string>();
  for (const row of (
    await db
      .prepare(`SELECT date_key, class_key FROM sla_schedule_dates WHERE version_id = ?`)
      .bind(versionId)
      .all<{ date_key: string; class_key: string }>()
  ).results) {
    dates.set(row.date_key, row.class_key);
  }

  const stops = new Map<string, SlaStopTarget>();
  for (const row of (
    await db
      .prepare(
        `SELECT stop_id, name, direction_id, route_ids_json, headways_json
         FROM sla_schedule_targets WHERE version_id = ?`,
      )
      .bind(versionId)
      .all<{
        stop_id: string;
        name: string;
        direction_id: number;
        route_ids_json: string;
        headways_json: string;
      }>()
  ).results) {
    stops.set(row.stop_id, {
      name: row.name,
      directionId: (row.direction_id === 1 ? 1 : 0) as 0 | 1,
      routeIds: JSON.parse(row.route_ids_json) as string[],
      headways: JSON.parse(row.headways_json) as Record<string, Array<number | null>>,
    });
  }

  const routes = new Map<string, SlaRouteTarget>();
  for (const row of (
    await db
      .prepare(
        `SELECT route_id, number, name, overnight, headways_json, stops_json
         FROM sla_route_targets WHERE version_id = ?`,
      )
      .bind(versionId)
      .all<{
        route_id: string;
        number: string;
        name: string;
        overnight: number;
        headways_json: string;
        stops_json: string;
      }>()
  ).results) {
    routes.set(row.route_id, {
      number: row.number,
      name: row.name,
      overnight: row.overnight === 1,
      headways: JSON.parse(row.headways_json) as Record<string, Array<number | null>>,
      stopIds: JSON.parse(row.stops_json) as string[],
    });
  }

  return { versionId, dates, stops, routes };
}

interface HourGroup {
  n: number;
  sum: number;
  sumSq: number;
  coverageSlots: number;
}

interface StopAccumulator {
  services: number;
  headwaySum: number;
  headwaySumSq: number;
  maxGapSeconds: number;
  backToBack: number;
  coverageSlots: number;
  spanSlots: number;
  parts: SlaComplianceParts;
}

function emptyStopAccumulator(): StopAccumulator {
  return {
    services: 0,
    headwaySum: 0,
    headwaySumSq: 0,
    maxGapSeconds: 0,
    backToBack: 0,
    coverageSlots: 0,
    spanSlots: 0,
    parts: { gapSeconds: 0, compliantSeconds: 0 },
  };
}

interface DayRow extends StopAccumulator {
  scope: 'route' | 'stop';
  scopeId: string;
}

/** Fold one Toronto day (or the today-so-far partial) from the rollup tier.
 * Deterministic in every column except computed_at. */
async function foldDay(
  db: D1Database,
  targets: LoadedTargets,
  config: ServiceConfig,
  dayKey: string,
  final: boolean,
  nowMs: number,
): Promise<'no-promise' | 'aged-out' | { stopRows: number; routeRows: number }> {
  const classKey = targets.dates.get(dayKey);
  if (!classKey) return 'no-promise';

  const dayStart = torontoDayStartMs(dayKey);
  const dayEnd = final
    ? torontoDayStartMs(dayKeyPlus(dayKey, 1))
    : Math.max(dayStart + 60_000, nowMs);
  const retentionMs = config.historyHours * 3_600_000;
  // A final day is foldable only while its EARLIEST bucket still survives the
  // 36-hour retention — i.e. within 12 hours of the day's end (24 h of day +
  // 12 h of grace is exactly what SERVICE_HISTORY_HOURS = 36 buys). Past that
  // grace, the day's early buckets are pruned and folding the survivors
  // would present a partial day as final — skip it honestly instead.
  if (final && dayStart < nowMs - retentionMs) return 'aged-out';

  const offsets = new TorontoOffset(dayStart, dayEnd);
  const tolerance = config.slaToleranceRatio;

  const byStop = new Map<string, Map<number, HourGroup>>();
  const perStop = new Map<string, StopAccumulator>();

  for (let from = dayStart; from < dayEnd; from += CHUNK_MS) {
    const to = Math.min(from + CHUNK_MS, dayEnd);
    const rows = (
      await db
        .prepare(
          `SELECT stop_id, bucket_start, n, headway_sum, headway_sum_sq,
                  max_gap_seconds, back_to_back, coverage_bits
           FROM service_rollups
           WHERE bucket_start >= ? AND bucket_start < ?
           ORDER BY bucket_start, stop_id`,
        )
        .bind(from, to)
        .all<{
          stop_id: string;
          bucket_start: number;
          n: number;
          headway_sum: number;
          headway_sum_sq: number;
          max_gap_seconds: number;
          back_to_back: number;
          coverage_bits: number;
        }>()
    ).results;

    for (const row of rows) {
      const target = targets.stops.get(row.stop_id);
      if (!target) continue; // no promise for this stop (e.g. subway-only stop)
      const hourIndex = Math.floor((row.bucket_start - dayStart) / 3_600_000);
      let groups = byStop.get(row.stop_id);
      if (!groups) {
        groups = new Map();
        byStop.set(row.stop_id, groups);
      }
      const group = groups.get(hourIndex) ?? { n: 0, sum: 0, sumSq: 0, coverageSlots: 0 };
      group.n += row.n;
      group.sum += row.headway_sum;
      group.sumSq += row.headway_sum_sq;
      group.coverageSlots += popcount(row.coverage_bits);
      groups.set(hourIndex, group);

      const stop = perStop.get(row.stop_id) ?? emptyStopAccumulator();
      stop.services += row.n;
      stop.headwaySum += row.headway_sum;
      stop.headwaySumSq += row.headway_sum_sq;
      if (row.max_gap_seconds > stop.maxGapSeconds)
        stop.maxGapSeconds = row.max_gap_seconds;
      stop.backToBack += row.back_to_back;
      stop.spanSlots += 10;
      perStop.set(row.stop_id, stop);
    }
  }

  // Compliance parts per (stop, hour): θ from the schedule's own promise for
  // that wall-clock hour of that date's class; hours with no promise are
  // simply absent from the denominator. The wall hour is offset-aware so DST
  // days (23 h / 25 h) read the right band — the repeated 1 a.m. of
  // fall-back maps to the 1 a.m. promise both times.
  for (const [stopId, groups] of byStop) {
    const target = targets.stops.get(stopId)!;
    const bands = target.headways[classKey];
    if (!bands) continue; // this class publishes no service at this stop
    const stop = perStop.get(stopId) ?? emptyStopAccumulator();
    const parts: SlaComplianceParts[] = [];
    for (const [hourIndex, group] of groups) {
      const groupStart = dayStart + hourIndex * 3_600_000;
      const wallHour = Math.floor((groupStart + offsets.at(groupStart)) / 3_600_000) % 24;
      const scheduled = bands[wallHour];
      if (scheduled === null || scheduled === undefined || scheduled <= 0) continue;
      const threshold = slaThresholdSeconds(scheduled, tolerance);
      const part = slaComplianceParts(
        { n: group.n, sum: group.sum, sumSq: group.sumSq },
        threshold,
      );
      if (part) parts.push(part);
      const accumulator = perStop.get(stopId) ?? emptyStopAccumulator();
      accumulator.coverageSlots += group.coverageSlots;
      perStop.set(stopId, accumulator);
    }
    if (parts.length > 0) stop.parts = mergeSlaParts([...parts, stop.parts]);
  }

  const dayRows: DayRow[] = [];
  for (const [stopId, stop] of perStop) {
    dayRows.push({
      ...stop,
      scope: 'stop',
      scopeId: stopId,
    });
  }

  // Route rows: the exact sum of the route's scheduled member stops (a
  // corridor-shared stop contributes to each route that serves it — the
  // page's methodology note says so).
  for (const [routeId, route] of targets.routes) {
    const merged = emptyStopAccumulator();
    let present = 0;
    for (const stopId of route.stopIds) {
      const stop = perStop.get(stopId);
      if (!stop) continue;
      present += 1;
      merged.services += stop.services;
      merged.headwaySum += stop.headwaySum;
      merged.headwaySumSq += stop.headwaySumSq;
      if (stop.maxGapSeconds > merged.maxGapSeconds)
        merged.maxGapSeconds = stop.maxGapSeconds;
      merged.backToBack += stop.backToBack;
      merged.coverageSlots += stop.coverageSlots;
      merged.spanSlots += stop.spanSlots;
      merged.parts = mergeSlaParts([merged.parts, stop.parts]);
    }
    if (present > 0) {
      dayRows.push({
        ...merged,
        scope: 'route',
        scopeId: routeId,
      });
    }
  }

  const statements = dayRows.map((row) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO sla_daily (
           scope, scope_id, day_key, services, headway_sum, headway_sum_sq,
           max_gap_seconds, back_to_back, compliant_seconds, gap_seconds,
           coverage_seconds, span_seconds, final, targets_version_id, computed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.scope,
        row.scopeId,
        dayKey,
        row.services,
        row.headwaySum,
        row.headwaySumSq,
        row.maxGapSeconds,
        row.backToBack,
        row.parts.compliantSeconds,
        row.parts.gapSeconds,
        row.coverageSlots * 30,
        row.spanSlots * 30,
        final ? 1 : 0,
        targets.versionId,
        nowMs,
      ),
  );
  for (let index = 0; index < statements.length; index += 100) {
    await db.batch(statements.slice(index, index + 100));
  }

  return { stopRows: perStop.size, routeRows: dayRows.length - perStop.size };
}

/** Recompute one Toronto week (Monday key) exactly: the sum of its day rows. */
async function recomputeWeek(
  db: D1Database,
  weekKey: string,
  todayKey: string,
  versionId: number,
  nowMs: number,
): Promise<number> {
  const start = weekKey;
  const end = dayKeyPlus(weekKey, 6);
  const rows = (
    await db
      .prepare(
        `SELECT scope, scope_id,
                SUM(services) AS services, SUM(headway_sum) AS headway_sum,
                SUM(headway_sum_sq) AS headway_sum_sq,
                MAX(max_gap_seconds) AS max_gap_seconds,
                SUM(back_to_back) AS back_to_back,
                SUM(compliant_seconds) AS compliant_seconds,
                SUM(gap_seconds) AS gap_seconds,
                SUM(coverage_seconds) AS coverage_seconds,
                SUM(span_seconds) AS span_seconds,
                MAX(targets_version_id) AS targets_version_id
         FROM sla_daily
         WHERE day_key >= ? AND day_key <= ?
         GROUP BY scope, scope_id`,
      )
      .bind(start, end)
      .all<{
        scope: 'route' | 'stop';
        scope_id: string;
        services: number;
        headway_sum: number;
        headway_sum_sq: number;
        max_gap_seconds: number;
        back_to_back: number;
        compliant_seconds: number;
        gap_seconds: number;
        coverage_seconds: number;
        span_seconds: number;
        targets_version_id: number;
      }>()
  ).results;

  const final = end < todayKey ? 1 : 0;
  const statements = rows.map((row) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO sla_weekly (
           scope, scope_id, week_key, services, headway_sum, headway_sum_sq,
           max_gap_seconds, back_to_back, compliant_seconds, gap_seconds,
           coverage_seconds, span_seconds, final, targets_version_id, computed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.scope,
        row.scope_id,
        weekKey,
        row.services,
        row.headway_sum,
        row.headway_sum_sq,
        row.max_gap_seconds,
        row.back_to_back,
        row.compliant_seconds,
        row.gap_seconds,
        row.coverage_seconds,
        row.span_seconds,
        final,
        versionId,
        nowMs,
      ),
  );
  for (let index = 0; index < statements.length; index += 100) {
    await db.batch(statements.slice(index, index + 100));
  }
  return rows.length;
}

async function readMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM sla_fold_meta WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function writeMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(`INSERT OR REPLACE INTO sla_fold_meta (key, value) VALUES (?, ?)`)
    .bind(key, value)
    .run();
}

/** The hourly SLA rollup entry point. Idempotent and self-healing: any
 * completed day whose data still exists and is not yet folded gets folded;
 * days aged out of retention are skipped forward without rows; today's
 * partial row is refreshed; touched weeks are recomputed exactly. */
export async function runSlaRollup(
  db: D1Database,
  config: ServiceConfig,
  nowMs: number,
): Promise<SlaFoldResult> {
  const versionId = await loadActiveVersionId(db);
  if (versionId === null) {
    return {
      status: 'no-targets',
      versionId: null,
      foldedDays: [],
      skippedDays: [],
      todayPartial: null,
      weeks: [],
    };
  }
  const targets = await loadSlaTargets(db, versionId);

  const todayKey = torontoDayKey(nowMs);
  const yesterdayKey = dayKeyPlus(todayKey, -1);

  let startKey: string;
  const foldedThrough = await readMeta(db, META_FOLDED_THROUGH);
  if (foldedThrough) {
    startKey = dayKeyPlus(foldedThrough, 1);
  } else {
    const first = await db
      .prepare(`SELECT MIN(bucket_start) AS first_bucket FROM service_rollups`)
      .first<{ first_bucket: number | null }>();
    if (first?.first_bucket === null || first?.first_bucket === undefined) {
      return {
        status: 'no-data',
        versionId,
        foldedDays: [],
        skippedDays: [],
        todayPartial: null,
        weeks: [],
      };
    }
    startKey = torontoDayKey(first.first_bucket);
  }

  const result: SlaFoldResult = {
    status: 'ok',
    versionId,
    foldedDays: [],
    skippedDays: [],
    todayPartial: null,
    weeks: [],
  };
  const touchedWeeks = new Set<string>();

  for (let dayKey = startKey; dayKey <= yesterdayKey; dayKey = dayKeyPlus(dayKey, 1)) {
    const folded = await foldDay(db, targets, config, dayKey, true, nowMs);
    if (folded === 'aged-out' || folded === 'no-promise') {
      result.skippedDays.push({ dayKey, reason: folded });
      continue;
    }
    result.foldedDays.push(dayKey);
    touchedWeeks.add(torontoWeekKey(dayKey));
  }

  // Today-so-far: the live recording being absorbed, precomputed, partial.
  if (targets.dates.has(todayKey)) {
    const partial = await foldDay(db, targets, config, todayKey, false, nowMs);
    if (partial !== 'no-promise') {
      result.todayPartial = todayKey;
      touchedWeeks.add(torontoWeekKey(todayKey));
    }
  }

  for (const weekKey of [...touchedWeeks].sort()) {
    await recomputeWeek(db, weekKey, todayKey, versionId, nowMs);
    result.weeks.push(weekKey);
  }

  await writeMeta(db, META_FOLDED_THROUGH, yesterdayKey);
  await writeMeta(db, META_RAN_AT, String(nowMs));
  return result;
}
