/** `GET /api/v1/sla/report` (docs/sla-stories.md Epic 8, E8S4): the one
 * endpoint the /sla page calls. It reads ONLY precomputed rows — the Tier 3
 * daily/weekly folds and the schedule targets the nightly import derives —
 * and never derives a compliance number, never touches the recorder, never
 * scans the 5-minute rollup tier. The page's cost profile is a bounded table
 * read; the data's freshness is the fold cadence, not the visitor.
 *
 * Conventions match the /service/* family: CORS, ETag/304, minutes-scale edge
 * cache. The strip contains exactly the segments with data — "as many tick
 * marks as you have data segments for" — with no fabricated pre-history. */

import type { Env } from '../env';
import type {
  D1Database,
  ExecutionContextLike,
} from '../../../shared/cloudflare/bindings';
import { json } from '../http/responses';
import { ifNoneMatchMatches } from '../../../../shared/http/etag';
import { sha256Hex } from '../../../shared/gtfs/hash';
import { serviceConfig } from '../../../../shared/service/config';
import type {
  SlaEntitySummary,
  SlaPublishedSchedule,
  SlaReportResponse,
  SlaRouteReport,
  SlaStopReport,
  SlaTick,
} from '../../../../shared/service/contracts';
import type { ScheduledBand } from '../../../../shared/service/sla-metrics';
import {
  advertisedHeadwaySeconds,
  scheduledBands,
  slaBandFor,
} from '../../../../shared/service/sla-metrics';
import { SOURCE_KEY } from '../sync/sync-common';

const REPORT_CACHE_SECONDS = 300;

const conditional = (request: Request, response: Response): Response =>
  ifNoneMatchMatches(request.headers.get('if-none-match'), response.headers.get('etag'))
    ? new Response(null, { status: 304, headers: response.headers })
    : response;

interface RawRow {
  scope_id: string;
  /** day_key or week_key. */
  key: string;
  services: number;
  compliant_seconds: number;
  gap_seconds: number;
  max_gap_seconds: number;
  coverage_seconds: number;
  span_seconds: number;
  final: number;
  computed_at: number;
}

function tickFromRow(row: RawRow, metRatio: number, degradedRatio: number): SlaTick {
  const ratio =
    row.gap_seconds > 0
      ? Math.min(Math.max(row.compliant_seconds / row.gap_seconds, 0), 1)
      : null;
  return {
    key: row.key,
    compliance: ratio === null ? null : Number(ratio.toFixed(4)),
    band: slaBandFor(ratio, metRatio, degradedRatio),
    services: row.services,
    monitoredMinutes: Number((row.gap_seconds / 60).toFixed(1)),
    maxGapSeconds: row.max_gap_seconds > 0 ? Math.round(row.max_gap_seconds) : null,
    coverageRatio:
      row.span_seconds > 0
        ? Number((row.coverage_seconds / row.span_seconds).toFixed(3))
        : 0,
    final: row.final === 1,
  };
}

/** Overall from the RAW stored numbers (moments of compliance are additive —
 * no reconstruction from rounded wire ticks). */
function summaryFromRows(
  rows: RawRow[],
  metRatio: number,
  degradedRatio: number,
): SlaEntitySummary {
  let compliantSeconds = 0;
  let gapSeconds = 0;
  let services = 0;
  let latestDayKey: string | null = null;
  for (const row of rows) {
    compliantSeconds += row.compliant_seconds;
    gapSeconds += row.gap_seconds;
    services += row.services;
    latestDayKey = row.key;
  }
  const ratio =
    gapSeconds > 0 ? Math.min(Math.max(compliantSeconds / gapSeconds, 0), 1) : null;
  const latestTick = latestDayKey
    ? (rows.find((row) => row.key === latestDayKey) ?? null)
    : null;
  return {
    compliance: ratio === null ? null : Number(ratio.toFixed(4)),
    band: slaBandFor(ratio, metRatio, degradedRatio),
    monitoredMinutes: Number((gapSeconds / 60).toFixed(1)),
    services,
    latestDayKey,
    latestBand: latestTick
      ? slaBandFor(
          latestTick.gap_seconds > 0
            ? Math.min(
                Math.max(latestTick.compliant_seconds / latestTick.gap_seconds, 0),
                1,
              )
            : null,
          metRatio,
          degradedRatio,
        )
      : null,
  };
}

function groupRows(rows: RawRow[]): Map<string, RawRow[]> {
  const byEntity = new Map<string, RawRow[]>();
  for (const row of rows) {
    const list = byEntity.get(row.scope_id) ?? [];
    list.push(row);
    byEntity.set(row.scope_id, list);
  }
  return byEntity;
}

async function activeVersionId(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT active_version_id AS version_id FROM source_state
       WHERE source_key = ? LIMIT 1`,
    )
    .bind(SOURCE_KEY)
    .first<{ version_id: number | null }>();
  return row?.version_id ?? null;
}

const COLUMNS = `scope_id, %KEY% AS key, services, compliant_seconds, gap_seconds,
                max_gap_seconds, coverage_seconds, span_seconds, final, computed_at`;

function latestComputedAt(rows: RawRow[]): number {
  let latest = 0;
  for (const row of rows) if (row.computed_at > latest) latest = row.computed_at;
  return latest;
}

async function loadRows(
  db: D1Database,
  table: 'sla_daily' | 'sla_weekly',
  scope: 'route' | 'stop',
  ids?: string[],
): Promise<RawRow[]> {
  const keyColumn = table === 'sla_daily' ? 'day_key' : 'week_key';
  const base = `SELECT ${COLUMNS.replace('%KEY%', keyColumn)} FROM ${table} WHERE scope = ?`;
  if (!ids || ids.length === 0) {
    const rows = await db.prepare(`${base} ORDER BY key`).bind(scope).all<RawRow>();
    return rows.results ?? [];
  }
  const all: RawRow[] = [];
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await db
      .prepare(`${base} AND scope_id IN (${placeholders}) ORDER BY key`)
      .bind(scope, ...chunk)
      .all<RawRow>();
    all.push(...(rows.results ?? []));
  }
  return all;
}

/** The published promise per route: the schedule's own bands, compacted into
 * contiguous runs (e.g. 6:00–19:00 every ~5 min) for the three display
 * classes — the most recent Wednesday / Saturday / Sunday in the feed window
 * (exact class keys, so holiday overlays stay honest). */
async function loadRouteMetadata(
  db: D1Database,
  versionId: number,
): Promise<
  Map<
    string,
    {
      number: string;
      name: string;
      overnight: boolean;
      stopIds: string[];
      published: SlaPublishedSchedule;
    }
  >
> {
  const dates = (
    await db
      .prepare(`SELECT date_key, class_key FROM sla_schedule_dates WHERE version_id = ?`)
      .bind(versionId)
      .all<{ date_key: string; class_key: string }>()
  ).results;
  let weekdayClass: string | null = null;
  let saturdayClass: string | null = null;
  let sundayClass: string | null = null;
  let holidayClass: string | null = null;
  // A holiday is a date whose class differs from the most recent same-weekday
  // date's class — Thanksgiving Monday against the Mondays around it. This
  // catches holidays on any weekday and never fires on school-day layers
  // (they leave the streetcar class untouched).
  const lastClassByWeekday: Array<string | null> = Array.from({ length: 7 }, () => null);
  for (const entry of dates) {
    const weekday = new Date(`${entry.date_key}T00:00:00Z`).getUTCDay();
    const expected = lastClassByWeekday[weekday];
    if (expected !== null && entry.class_key !== expected) holidayClass = entry.class_key;
    lastClassByWeekday[weekday] = entry.class_key;
    if (weekday === 3) weekdayClass = entry.class_key;
    if (weekday === 6) saturdayClass = entry.class_key;
    if (weekday === 0) sundayClass = entry.class_key;
  }

  const routes = (
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
  ).results;

  const map = new Map<
    string,
    {
      number: string;
      name: string;
      overnight: boolean;
      stopIds: string[];
      published: SlaPublishedSchedule;
    }
  >();
  for (const route of routes) {
    const headways = JSON.parse(route.headways_json) as Record<
      string,
      Array<number | null>
    >;
    const bandsFor = (classKey: string | null): ScheduledBand[] | null => {
      if (!classKey || !headways[classKey]) return null;
      // Published on the TTC's advertised grid (5-minute multiples, floored
      // at 10) — quantized at read time so legacy pre-grid rows publish
      // exactly like freshly derived ones.
      const quantized = headways[classKey].map((value) =>
        value === null ? null : advertisedHeadwaySeconds(value),
      );
      return scheduledBands(quantized);
    };
    map.set(route.route_id, {
      number: route.number,
      name: route.name,
      overnight: route.overnight === 1,
      stopIds: JSON.parse(route.stops_json) as string[],
      published: {
        weekday: bandsFor(weekdayClass),
        saturday: bandsFor(saturdayClass),
        sunday: bandsFor(sundayClass),
        holiday: bandsFor(holidayClass),
      },
    });
  }
  return map;
}

async function loadStopMetadata(
  db: D1Database,
  versionId: number,
  stopIds: string[],
): Promise<
  Map<string, { name: string; directionId: 0 | 1; headsign: string; routeIds: string[] }>
> {
  const map = new Map<
    string,
    { name: string; directionId: 0 | 1; headsign: string; routeIds: string[] }
  >();
  for (let index = 0; index < stopIds.length; index += 90) {
    const chunk = stopIds.slice(index, index + 90);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = (
      await db
        .prepare(
          `SELECT stop_id, name, direction_id, headsign, route_ids_json FROM sla_schedule_targets
           WHERE version_id = ? AND stop_id IN (${placeholders})`,
        )
        .bind(versionId, ...chunk)
        .all<{
          stop_id: string;
          name: string;
          direction_id: number;
          headsign: string;
          route_ids_json: string;
        }>()
    ).results;
    for (const row of rows) {
      map.set(row.stop_id, {
        name: row.name,
        directionId: (row.direction_id === 1 ? 1 : 0) as 0 | 1,
        headsign: row.headsign,
        routeIds: JSON.parse(row.route_ids_json) as string[],
      });
    }
  }
  return map;
}

export async function slaReportResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const config = serviceConfig(env);
  const url = new URL(request.url);
  const routeFilter = url.searchParams.get('route');

  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(
    `https://ttcstatus-cache.invalid/api/v1/sla/report?route=${encodeURIComponent(routeFilter ?? '')}`,
  );
  const cached = await cache.match(key);
  if (cached) return conditional(request, cached);

  const versionId = await activeVersionId(env.DB);
  // generatedAt is the newest fold underneath the payload, not the wall
  // clock: the report is a pure function of its tables, so identical data
  // yields identical ETags and 304s work between folds.
  const metRatio = config.slaMetRatio;
  const degradedRatio = config.slaDegradedRatio;

  // The honest "collecting" report: schema and thresholds, no rows, no
  // fabricated green.
  const collecting: SlaReportResponse = {
    schemaVersion: 1,
    generatedAt: 0,
    dataThrough: null,
    targets: {
      versionId: versionId ?? 0,
      toleranceRatio: config.slaToleranceRatio,
      metRatio,
      degradedRatio,
    },
    overall: summaryFromRows([], metRatio, degradedRatio),
    routes: [],
  };

  if (versionId === null) {
    return finish(request, ctx, cache, key, collecting);
  }

  const [routeMetadata, routeDaily, routeWeekly] = await Promise.all([
    loadRouteMetadata(env.DB, versionId),
    loadRows(env.DB, 'sla_daily', 'route'),
    loadRows(env.DB, 'sla_weekly', 'route'),
  ]);
  const routeDays = groupRows(routeDaily);
  const routeWeeks = groupRows(routeWeekly);

  const routes: SlaRouteReport[] = [];
  const overallRows: RawRow[] = [];
  for (const [routeId, metadata] of [...routeMetadata.entries()].sort((a, b) =>
    a[1].number.localeCompare(b[1].number, undefined, { numeric: true }),
  )) {
    const days = routeDays.get(routeId) ?? [];
    const weeks = routeWeeks.get(routeId) ?? [];
    routes.push({
      routeId,
      number: metadata.number,
      name: metadata.name,
      overnight: metadata.overnight,
      published: metadata.published,
      overall: summaryFromRows(days, metRatio, degradedRatio),
      days: days.map((row) => tickFromRow(row, metRatio, degradedRatio)),
      weeks: weeks.map((row) => tickFromRow(row, metRatio, degradedRatio)),
    });
    overallRows.push(...days);
  }

  const dataThrough = routes.reduce<string | null>((latest, route) => {
    const candidate = route.days.at(-1)?.key ?? null;
    return candidate !== null && (latest === null || candidate > latest)
      ? candidate
      : latest;
  }, null);

  const report: SlaReportResponse = {
    schemaVersion: 1,
    generatedAt: Math.max(latestComputedAt(routeDaily), latestComputedAt(routeWeekly)),
    dataThrough,
    targets: {
      versionId,
      toleranceRatio: config.slaToleranceRatio,
      metRatio,
      degradedRatio,
    },
    overall: summaryFromRows(overallRows, metRatio, degradedRatio),
    routes,
  };

  // `?route=` adds that route's directional-stop rows (the expandable detail).
  const routeEntry = routeFilter ? routeMetadata.get(routeFilter) : undefined;
  if (routeFilter && routeEntry) {
    const stopIds = routeEntry.stopIds;
    const [stopMeta, stopDaily, stopWeekly] = await Promise.all([
      loadStopMetadata(env.DB, versionId, stopIds),
      loadRows(env.DB, 'sla_daily', 'stop', stopIds),
      loadRows(env.DB, 'sla_weekly', 'stop', stopIds),
    ]);
    const stopDays = groupRows(stopDaily);
    const stopWeeks = groupRows(stopWeekly);
    const stops: SlaStopReport[] = stopIds
      .filter((stopId) => stopMeta.has(stopId))
      .map((stopId) => {
        const meta = stopMeta.get(stopId)!;
        const days = stopDays.get(stopId) ?? [];
        const weeks = stopWeeks.get(stopId) ?? [];
        return {
          stopId,
          name: meta.name,
          directionId: meta.directionId,
          headsign: meta.headsign,
          routeIds: meta.routeIds,
          overall: summaryFromRows(days, metRatio, degradedRatio),
          days: days.map((row) => tickFromRow(row, metRatio, degradedRatio)),
          weeks: weeks.map((row) => tickFromRow(row, metRatio, degradedRatio)),
        };
      });
    report.stops = stops;
    report.generatedAt = Math.max(
      report.generatedAt,
      latestComputedAt(stopDaily),
      latestComputedAt(stopWeekly),
    );
  } else if (routeFilter) {
    // Unknown route: the honest empty detail, not an error — the caller may be
    // ahead of the newest schedule import.
    report.stops = [];
  }

  return finish(request, ctx, cache, key, report);
}

function finish(
  request: Request,
  ctx: ExecutionContextLike,
  cache: Cache,
  key: Request,
  report: SlaReportResponse,
): Promise<Response> {
  return (async () => {
    const etag = `"sla-${await sha256Hex(JSON.stringify(report))}"`;
    const response = json(report, 200, {
      'cache-control': `public, max-age=${REPORT_CACHE_SECONDS}`,
      etag,
    });
    ctx.waitUntil(cache.put(key, response.clone()));
    return conditional(request, response);
  })();
}
