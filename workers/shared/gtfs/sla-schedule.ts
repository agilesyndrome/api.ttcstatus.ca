/** The promise lens's derivation (docs/sla-stories.md Epic 8, E8S1): turn the
 * raw schedule materials the streetcar parser already collects — every
 * streetcar trip's calendar membership and departure times — into the
 * published SLA: per directional stop and per route, the scheduled headway
 * per hour-of-day band, per calendar class.
 *
 * Classes are exact active-service sets ('1', '2', '1+4401', ...), computed
 * from calendar.txt + calendar_dates.txt — never weekday folklore, so holiday
 * variants and school-day layers keep their own promises. A date whose set
 * publishes no service for a stop simply has no promise there (the fold
 * excludes it — no promise is never a fabricated pass).
 *
 * Pure: same materials in, same targets out, byte-identical (deterministic
 * orders + row hashes) — so a re-import of the same feed reproduces the same
 * rows, like every other layer of this pipeline. */

import { fnv1a } from './hash';
import type { ParsedStreetcarGtfs } from './parser';
import { median } from '../../../shared/service/wait-metrics';
import { hourlyScheduledHeadways } from '../../../shared/service/sla-metrics';

export type SlaHeadwayBands = Array<number | null>;

export interface SlaScheduleStopTarget {
  stopId: string;
  name: string;
  directionId: 0 | 1;
  /** The serving trips' headsign — the "towards X" label on the page. */
  headsign: string;
  routeIds: string[];
  /** classKey → 24 hourly bands (null = no scheduled service that hour). */
  headways: Record<string, SlaHeadwayBands>;
}

export interface SlaScheduleRouteTarget {
  routeId: string;
  number: string;
  name: string;
  overnight: boolean;
  headways: Record<string, SlaHeadwayBands>;
  /** The directional stops this route serves (corridor membership). */
  stopIds: string[];
}

export interface SlaScheduleTargets {
  /** 'YYYY-MM-DD' → classKey, every date in the feed's validity window. */
  dates: Array<{ dateKey: string; classKey: string }>;
  stops: SlaScheduleStopTarget[];
  routes: SlaScheduleRouteTarget[];
}

const DAY_MS = 86_400_000;

/** GTFS 'YYYYMMDD' → 'YYYY-MM-DD' (the house day-key format, Toronto). */
function toDayKey(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/** The GTFS window as UTC day keys ('YYYYMMDD' strings compare lexically). */
function calendarWindow(
  materials: ParsedStreetcarGtfs['schedule'],
): { start: string; end: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const service of materials.calendarServices.values()) {
    if (!start || service.startDate < start) start = service.startDate;
    if (!end || service.endDate > end) end = service.endDate;
  }
  if (!start || !end) return null;
  return { start, end };
}

function activeServices(
  materials: ParsedStreetcarGtfs['schedule'],
  rawDate: string,
): Set<string> {
  const utc = Date.parse(
    `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}T00:00:00Z`,
  );
  if (!Number.isFinite(utc)) return new Set();
  const weekday = (new Date(utc).getUTCDay() + 6) % 7; // Mon = 0 … Sun = 6
  const active = new Set<string>();
  for (const [serviceId, service] of materials.calendarServices) {
    if (
      service.weekdays[weekday] === 1 &&
      service.startDate <= rawDate &&
      rawDate <= service.endDate
    ) {
      active.add(serviceId);
    }
  }
  for (const exception of materials.calendarExceptions) {
    if (exception.dateKey !== rawDate) continue;
    if (exception.added) active.add(exception.serviceId);
    else active.delete(exception.serviceId);
  }
  return active;
}

export function deriveSlaSchedule(parsed: ParsedStreetcarGtfs): SlaScheduleTargets {
  const materials = parsed.schedule;
  const stopNames = new Map(parsed.stops.map((stop) => [stop.stopId, stop.name]));

  // The /sla page is streetcar service (docs/sla-stories.md E8S1; the E7S7
  // steering excluded the rapid lines from the delivered-service surface, and
  // isSubwayOnlyStop's set — Lines 1/2/4 plus the 5/6 LRT — is the rule).
  // Rapid routes and rapid-only stops publish no promise here; a stop shared
  // by streetcar corridors keeps its streetcar truth.
  const RAPID_LINE_NUMBERS = new Set(['1', '2', '4', '5', '6']);
  const streetcarRouteIds = new Set(
    parsed.routes
      .filter(
        (route) => route.routeType === 0 && !RAPID_LINE_NUMBERS.has(route.shortName),
      )
      .map((route) => route.routeId),
  );

  // Only services that actually carry streetcar trips can change a streetcar
  // schedule — the class key is the exact active set, intersected honestly.
  const streetcarServices = new Set<string>();
  for (const trip of materials.trips.values()) {
    if (streetcarRouteIds.has(trip.routeId)) streetcarServices.add(trip.serviceId);
  }

  // Dates: every day in the feed window, ascending, with its class key. Dates
  // with no active streetcar service publish no promise and are skipped.
  const dates: Array<{ dateKey: string; classKey: string }> = [];
  const window = calendarWindow(materials);
  if (window) {
    for (
      let at = Date.parse(
        `${window.start.slice(0, 4)}-${window.start.slice(4, 6)}-${window.start.slice(6, 8)}T00:00:00Z`,
      );
      Number.isFinite(at);
      at += DAY_MS
    ) {
      const rawDate = new Date(at).toISOString().slice(0, 10).replace(/-/g, '');
      if (rawDate > window.end) break;
      const active = activeServices(materials, rawDate);
      const relevant = [...active].filter((id) => streetcarServices.has(id)).sort();
      if (relevant.length === 0) continue;
      dates.push({ dateKey: toDayKey(rawDate), classKey: relevant.join('+') });
    }
  }
  const classKeys = [...new Set(dates.map((entry) => entry.classKey))].sort();
  const classServices = new Map(classKeys.map((key) => [key, key.split('+')] as const));

  // Per stop: pooled STREETCAR departures per class → hourly bands. The pool
  // spans every streetcar route serving the stop (a rider there cares about
  // all of them); subway departures never enter the promise. Deterministic
  // order.
  const stops: SlaScheduleStopTarget[] = [];
  const stopIds = [...materials.departuresByStop.keys()].sort();
  for (const stopId of stopIds) {
    const byService = materials.departuresByStop.get(stopId)!;
    const headways: Record<string, SlaHeadwayBands> = {};
    for (const classKey of classKeys) {
      const pooled: number[] = [];
      for (const serviceId of classServices.get(classKey)!) {
        const byRoute = byService.get(serviceId);
        if (!byRoute) continue;
        for (const [routeId, departures] of byRoute) {
          if (streetcarRouteIds.has(routeId)) pooled.push(...departures);
        }
      }
      if (pooled.length === 0) continue;
      headways[classKey] = hourlyScheduledHeadways(pooled);
    }
    if (Object.keys(headways).length === 0) continue;
    const routes = [...(materials.stopRoutes.get(stopId) ?? new Set<string>())]
      .filter((routeId) => streetcarRouteIds.has(routeId))
      .sort();
    if (routes.length === 0) continue;
    stops.push({
      stopId,
      name: stopNames.get(stopId) ?? stopId,
      directionId: (materials.stopDirections.get(stopId) ?? 0) as 0 | 1,
      headsign: materials.stopHeadsigns.get(stopId) ?? '',
      routeIds: routes,
      headways,
    });
  }

  // Per route: the route's OWN departures at each member stop → hourly bands
  // → median across stops. A night route sharing a corridor with a day route
  // publishes only its own service span (its member stops' pooled bands
  // belong to the stops, not to it) — and one inserted tripper still cannot
  // move the corridor's promise (median across stops).
  const routes: SlaScheduleRouteTarget[] = [];
  for (const route of [...parsed.routes]
    .filter((entry) => entry.routeType === 0 && !RAPID_LINE_NUMBERS.has(entry.shortName))
    .sort((a, b) => a.shortName.localeCompare(b.shortName))) {
    const memberStops = stops.filter((stop) => stop.routeIds.includes(route.routeId));
    if (memberStops.length === 0) continue;
    const headways: Record<string, SlaHeadwayBands> = {};
    for (const classKey of classKeys) {
      const perStopBands: SlaHeadwayBands[] = [];
      let any = false;
      for (const stop of memberStops) {
        const byService = materials.departuresByStop.get(stop.stopId);
        if (!byService) continue;
        const own: number[] = [];
        for (const serviceId of classServices.get(classKey)!) {
          const departures = byService.get(serviceId)?.get(route.routeId);
          if (departures) own.push(...departures);
        }
        if (own.length === 0) continue;
        any = true;
        perStopBands.push(hourlyScheduledHeadways(own));
      }
      if (!any) continue;
      const bands: SlaHeadwayBands = [];
      for (let hour = 0; hour < 24; hour += 1) {
        const values = perStopBands
          .map((bands) => bands[hour] ?? null)
          .filter((value): value is number => value !== null);
        if (values.length === 0) {
          bands.push(null);
          continue;
        }
        const value = median(values);
        bands.push(value === null ? null : Math.round(value));
      }
      headways[classKey] = bands;
    }
    if (Object.keys(headways).length === 0) continue;
    routes.push({
      routeId: route.routeId,
      number: route.shortName,
      name: route.longName,
      overnight: /^3/.test(route.shortName),
      headways,
      stopIds: memberStops.map((stop) => stop.stopId),
    });
  }

  return { dates, stops, routes };
}

/** Canonical content hash for a stored schedule row (fnv1a, like gtfs_* rows). */
export function slaScheduleRowHash(parts: Array<string | number | null>): string {
  return fnv1a(parts.join('|'));
}
