import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { SlaReportResponse } from '../../../../shared/service/contracts';
import { torontoDayKey } from '../../../../shared/service/sla-metrics';
import { Banner, type BannerTone } from '../../components/data/Banner';
import { Legend } from '../../components/data/Legend';
import type { SlaLiveState } from './useSlaLive';
import { RoutesStopsSearch } from '../../components/search/RoutesStopsSearch';
import { SlaMethodology } from './SlaMethodology';
import { SlaRouteRow } from './SlaRouteRow';
import { bannerCounts, formatDayKeyLong, formatPercent } from './sla-view';

export type SlaGrain = 'day' | 'week';

interface Props {
  report: SlaReportResponse;
  grain: SlaGrain;
  query: string;
  needle: string;
  expanded: Set<string>;
  filteredRoutes: SlaReportResponse['routes'];
  live: SlaLiveState;
  onGrainChange(grain: SlaGrain): void;
  onQueryChange(query: string): void;
  onToggle(routeId: string): void;
}

export function SlaReport({
  report,
  grain,
  query,
  needle,
  expanded,
  filteredRoutes,
  live,
  onGrainChange,
  onQueryChange,
  onToggle,
}: Props) {
  useLanguage();
  const counts = bannerCounts(report.routes);
  const overallPercent = formatPercent(report.overall.compliance);
  const todayKey = torontoDayKey(Date.now());
  const throughText =
    report.dataThrough === null
      ? null
      : t('sla.dataThrough', {
          value1:
            report.dataThrough === todayKey
              ? t('sla.today')
              : formatDayKeyLong(report.dataThrough),
        });
  const bannerText =
    report.dataThrough === null
      ? t('sla.bannerCollecting')
      : counts.met === counts.total
        ? t('sla.bannerAllMet', {
            value1: counts.total,
            value2: formatDayKeyLong(report.dataThrough),
          })
        : t('sla.bannerSomeMet', {
            value1: counts.met,
            value2: counts.total,
            value3: formatDayKeyLong(report.dataThrough),
          });
  const bannerTone: BannerTone =
    report.overall.band === 'met'
      ? 'positive'
      : report.overall.band === 'degraded'
        ? 'warning'
        : report.overall.band === 'missed'
          ? 'negative'
          : 'neutral';
  return (
    <>
      <Banner
        title={bannerText}
        tone={bannerTone}
        ariaLabel={bannerText}
        detail={
          <>
            {overallPercent !== null && (
              <>
                <strong>{t('sla.tickWithin', { value1: overallPercent })}</strong>
                {' · '}
              </>
            )}
            {t('sla.services', { value1: report.overall.services })}
            {throughText && (
              <>
                {' · '}
                {throughText}
              </>
            )}
          </>
        }
      />
      <div className="sla-controls">
        <RoutesStopsSearch
          id="sla-filter"
          value={query}
          label={t('sla.filterRoutesAndStops')}
          onChange={onQueryChange}
        />
        <div className="sla-grain" role="group" aria-label={t('sla.grainTitle')}>
          <button
            type="button"
            className="sla-grain__button"
            aria-pressed={grain === 'day'}
            onClick={() => onGrainChange('day')}
          >
            {t('sla.grainDay')}
          </button>
          <button
            type="button"
            className="sla-grain__button"
            aria-pressed={grain === 'week'}
            onClick={() => onGrainChange('week')}
          >
            {t('sla.grainWeek')}
          </button>
        </div>
      </div>
      <Legend
        ariaLabel={t('sla.legendTitle')}
        items={[
          {
            key: 'met',
            label: t('sla.legendMet'),
            tone: 'positive',
          },
          {
            key: 'degraded',
            label: t('sla.legendDegraded'),
            tone: 'warning',
          },
          {
            key: 'missed',
            label: t('sla.legendMissed'),
            tone: 'negative',
          },
          {
            key: 'no-data',
            label: t('sla.legendNoData'),
            tone: 'neutral',
          },
          {
            key: 'today',
            label: t('sla.legendToday'),
            tone: 'positive',
            partial: true,
          },
          {
            key: 'live',
            label: t('sla.legendLive'),
            tone: 'positive',
            live: true,
          },
        ]}
      />
      {filteredRoutes.length === 0 && (
        <p className="sla-empty">{t('sla.filterNoMatches')}</p>
      )}
      {filteredRoutes.length > 0 && (
        <ol className="sla-routes">
          {filteredRoutes.map((route) => (
            <SlaRouteRow
              key={route.routeId}
              route={route}
              grain={grain}
              expanded={expanded.has(route.routeId)}
              onToggle={onToggle}
              needle={needle}
              live={live.byRoute.get(route.routeId)}
              liveByStop={live.byStop}
            />
          ))}
        </ol>
      )}
      <SlaMethodology targets={report.targets} />
    </>
  );
}
