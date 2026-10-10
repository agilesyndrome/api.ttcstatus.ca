/** The /sla page's pure view-brain (docs/sla-stories.md Epic 8, E8S5):
 * formatting, filtering, and tooltip fragments — all numbers come from the
 * precomputed report; nothing here derives compliance. Shared banding comes
 * from the same shared module the API uses, so page and payload can never
 * disagree about green, yellow, or red. */

import type {
  SlaPublishedSchedule,
  SlaRouteReport,
  SlaStopReport,
  SlaTick,
} from '../../../../shared/service/contracts';
import type { ScheduledBand } from '../../../../shared/service/sla-metrics';

/** '2026-10-10' → the page's short date, in the viewer's locale. Noon UTC
 * keeps the calendar date stable in every timezone. */
export function formatDayKey(dayKey: string, locale?: string): string {
  const date = new Date(`${dayKey}T12:00:00Z`);
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** '2026-10-10' → the long form banner dates use. */
export function formatDayKeyLong(dayKey: string, locale?: string): string {
  const date = new Date(`${dayKey}T12:00:00Z`);
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatPercent(ratio: number | null, decimals = 1): string | null {
  if (ratio === null) return null;
  return (ratio * 100).toFixed(decimals);
}

export function formatDurationShort(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 10) return `${minutes.toFixed(1)} min`;
  return `${Math.round(minutes)} min`;
}

/** One band of a compacted published schedule, as display fragments. */
export interface PublishedBandFragment {
  minutes: number;
  from: string;
  to: string;
}

function hourLabel(hour: number): string {
  return `${hour}:00`;
}

/** The published schedule as display fragments per calendar class: contiguous
 * bands of (minutes, from, to) — the component composes each class with its
 * label and t('sla.publishedEvery'), and joins bands and classes with ' · '.
 * The class list answers "does the page understand weekends and holidays?"
 * in the rendering itself: a route shows the lines its schedule publishes. */
export type PublishedClass = 'weekday' | 'saturday' | 'sunday' | 'holiday';

export interface PublishedClassFragments {
  class: PublishedClass;
  bands: PublishedBandFragment[];
}

const PUBLISHED_CLASS_ORDER: readonly PublishedClass[] = [
  'weekday',
  'saturday',
  'sunday',
  'holiday',
];

export function publishedClasses(
  schedule: SlaPublishedSchedule | null,
): PublishedClassFragments[] {
  if (!schedule) return [];
  const out: PublishedClassFragments[] = [];
  for (const key of PUBLISHED_CLASS_ORDER) {
    const bands = schedule[key];
    if (!bands || bands.length === 0) continue;
    out.push({
      class: key,
      bands: bands.map(bandToFragments),
    });
  }
  return out;
}

function bandToFragments(band: ScheduledBand): PublishedBandFragment {
  return {
    minutes: Math.round(band.headwaySeconds / 60),
    from: hourLabel(band.fromHour),
    to: hourLabel(band.toHour),
  };
}

/** The tick's tooltip fragments — the component localizes and joins. */
export interface TickTip {
  date: string;
  dayKey: string;
  percent: string | null;
  services: number;
  maxGap: string | null;
  coveragePercent: string | null;
  partial: boolean;
  noData: boolean;
}

export function tickTip(tick: SlaTick, grain: 'day' | 'week', locale?: string): TickTip {
  return {
    date:
      grain === 'week'
        ? formatDayKeyLong(tick.key, locale)
        : formatDayKey(tick.key, locale),
    dayKey: tick.key,
    percent: formatPercent(tick.compliance),
    services: tick.services,
    maxGap: tick.maxGapSeconds === null ? null : formatDurationShort(tick.maxGapSeconds),
    coveragePercent: formatPercent(tick.coverageRatio, 0),
    partial: !tick.final,
    noData: tick.compliance === null,
  };
}

export interface SlaRouteFilter {
  routes: SlaRouteReport[];
}

/** The filter box narrows routes and stops live, client-side over the fetched
 * report plus whatever detail the visitor has expanded (the expand is the
 * lazy-load): a route matches if its number/name matches, or if any of its
 * loaded stops matches. Zero network on the keystroke itself. */
export function filterSlaRoutes(
  routes: SlaRouteReport[],
  query: string,
  stopsByRoute: Map<string, SlaStopReport[]>,
): SlaRouteFilter {
  const needle = query.trim().toLowerCase();
  if (!needle) return { routes };
  const matched = routes.filter((route) => {
    if (`${route.number} ${route.name}`.toLowerCase().includes(needle)) return true;
    const stops = stopsByRoute.get(route.routeId) ?? [];
    return stops.some((stop) =>
      `${stop.name} ${stop.headsign}`.toLowerCase().includes(needle),
    );
  });
  return { routes: matched };
}

/** The banner's truth: how many routes met the SLA on the newest day. */
export function bannerCounts(routes: SlaRouteReport[]): { total: number; met: number } {
  let total = 0;
  let met = 0;
  for (const route of routes) {
    if (route.overall.latestBand === null) continue;
    total += 1;
    if (route.overall.latestBand === 'met') met += 1;
  }
  return { total, met };
}
