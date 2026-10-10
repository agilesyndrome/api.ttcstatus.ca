import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { SlaRouteReport } from '../../../../shared/service/contracts';
import { formatPercent, publishedFragments } from './sla-view';
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
}

/** One route row: number, name, the SLA the TTC's own schedule indicates, the
 * current status, the overall compliance, and the tick strip. Expanding shows
 * the route's directional stops with their own strips (one lazy fetch,
 * session-cached). */
export function SlaRouteRow({ route, grain, expanded, onToggle, needle }: Props) {
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

  const fragments = publishedFragments(route.published, ['weekday']);
  const publishedText = fragments
    ? fragments
        .map((fragment) =>
          t('sla.publishedEvery', {
            value1: fragment.minutes,
            value2: fragment.from,
            value3: fragment.to,
          }),
        )
        .join(' · ')
    : t('sla.publishedNoSchedule');

  const visibleStops = (stops ?? []).filter((stop) => {
    const text = `${stop.name} ${stop.headsign}`.toLowerCase();
    return !needle || text.includes(needle);
  });

  return (
    <li className={`sla-route sla-route--${bandClass}`} data-route={route.routeId}>
      <div className="sla-route__head">
        <span className="sla-route__number">{route.number}</span>
        <span className="sla-route__name">{route.name}</span>
        <span className={`sla-route__status sla-route__status--${bandClass}`}>
          {t(statusKey)}
        </span>
        <span className="sla-route__percent">
          {percent === null ? '—' : t('sla.tickWithin', { value1: percent })}
        </span>
        <button
          type="button"
          className="sla-route__toggle"
          aria-expanded={expanded}
          onClick={() => onToggle(route.routeId)}
        >
          {t(expanded ? 'sla.hideStops' : 'sla.showStops')}
        </button>
      </div>
      <p className="sla-route__published">
        {t('sla.publishedSchedule', { value1: publishedText })}
      </p>
      <SlaTickStrip ticks={grain === 'day' ? route.days : route.weeks} grain={grain} />
      {expanded && (
        <div className="sla-route__stops">
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
                <SlaStopRow key={stop.stopId} stop={stop} grain={grain} />
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}
