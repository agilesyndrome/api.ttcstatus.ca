import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { SlaRouteReport } from '../../../../shared/service/contracts';
import { formatPercent, publishedClasses, type PublishedClass } from './sla-view';
import type { SlaLiveBucket } from './sla-live';

const PUBLISHED_CLASS_LABELS: Record<PublishedClass, string> = {
  weekday: 'sla.publishedWeekday',
  saturday: 'sla.publishedSaturday',
  sunday: 'sla.publishedSunday',
  holiday: 'sla.publishedHoliday',
};
import { useSlaStops } from './useSlaReport';
import { SlaTickStrip } from './SlaTickStrip';
import { SlaStopRow } from './SlaStopRow';

interface Props {
  route: SlaRouteReport;
  grain: 'day' | 'week';
  /** User's expand/collapse choice (session-scoped, not persisted). */
  expanded: boolean;
  onToggle(routeId: string): void;
  /** The live filter; expanded rows also filter their loaded stop list. */
  needle: string;
  /** The live tier's slivers for this route, oldest → newest. */
  live?: SlaLiveBucket[] | null;
  /** Live slivers for the route's stops, keyed `${routeId}|${stopId}`. */
  liveByStop?: Map<string, SlaLiveBucket[]>;
}

/** One route row: number, name, the SLA the TTC's own schedule indicates, the
 * current status, the overall compliance, and the tick strip. Expanding shows
 * the route's directional stops with their own strips (one lazy fetch,
 * session-cached). */
export function SlaRouteRow({
  route,
  grain,
  expanded,
  onToggle,
  needle,
  live,
  liveByStop,
}: Props) {
  useLanguage();
  const wantsStops = expanded;
  const { stops, failed: stopsFailed } = useSlaStops(wantsStops ? route.routeId : null);
  const percent = formatPercent(route.overall.compliance);
  const statusKey =
    route.overall.latestBand === null
      ? 'sla.routeStatusNoData'
      : route.overall.latestBand === 'met'
        ? 'sla.routeStatusMeeting'
        : route.overall.latestBand === 'degraded'
          ? 'sla.routeStatusDegraded'
          : 'sla.routeStatusMissed';
  const bandClass = route.overall.latestBand ?? 'no-data';

  const publishedGroups = publishedClasses(route.published);
  // Group the class lines by their rendered text: with the advertised grid,
  // most routes publish the same promise for every class — one unlabeled line
  // reads cleaner than four identical labelled ones. Differing classes keep
  // their labels, so weekend and holiday schedules stay visible when they
  // actually differ.
  const byText = new Map<string, string[]>();
  for (const group of publishedGroups) {
    const text = group.bands
      .map((fragment) =>
        t('sla.publishedEvery', {
          value1: fragment.minutes,
          value2: fragment.from,
          value3: fragment.to,
        }),
      )
      .join(' · ');
    const labels = byText.get(text) ?? [];
    labels.push(t(PUBLISHED_CLASS_LABELS[group.class]));
    byText.set(text, labels);
  }
  const publishedText =
    publishedGroups.length === 0
      ? t('sla.publishedNoSchedule')
      : byText.size === 1
        ? [...byText.keys()][0]
        : [...byText.entries()]
            .map(([text, labels]) => `${labels.join(' / ')}: ${text}`)
            .join(' · ');

  const visibleStops = (stops ?? []).filter((stop) => {
    const text = `${stop.name} ${stop.headsign}`.toLowerCase();
    return !needle || text.includes(needle);
  });

  return (
    <li className={`sla-route sla-route--${bandClass}`} data-route={route.routeId}>
      {/* The card reads as two lines: the title row (arrow, route, status,
       * percent) and the chart (the tick strip). The full published schedule
       * lives inside the collapsible — detail on demand, clean by default. */}
      <div className="sla-route__head">
        <button
          type="button"
          className="sla-route__toggle"
          aria-expanded={expanded}
          aria-label={t(expanded ? 'sla.hideStops' : 'sla.showStops')}
          onClick={() => onToggle(route.routeId)}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span className="sla-route__number">{route.number}</span>
        <span className="sla-route__name">{route.name}</span>
        <span className={`sla-route__status sla-route__status--${bandClass}`}>
          {t(statusKey)}
        </span>
        <span className="sla-route__percent">
          {percent === null ? '—' : t('sla.tickWithin', { value1: percent })}
        </span>
      </div>
      <SlaTickStrip
        ticks={grain === 'day' ? route.days : route.weeks}
        grain={grain}
        live={live}
      />
      {expanded && (
        <div className="sla-route__stops">
          <p className="sla-route__published">
            {t('sla.publishedSchedule', { value1: publishedText })}
          </p>
          <h3 className="sla-route__stops-title">
            {t('sla.stopsFor', { value1: route.number, value2: route.name })}
          </h3>
          {stopsFailed && (
            <p className="sla-route__stops-failed">{t('sla.reportFailed')}</p>
          )}
          {!stopsFailed && !stops && (
            <p className="sla-route__stops-failed">{t('sla.noDataYet')}</p>
          )}
          {visibleStops.length > 0 && (
            <ol className="sla-stops">
              {visibleStops.map((stop) => (
                <SlaStopRow
                  key={stop.stopId}
                  stop={stop}
                  grain={grain}
                  live={liveByStop?.get(`${route.routeId}|${stop.stopId}`)}
                />
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}
