import { useEffect, useMemo, useState } from 'react';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { AuthControls } from '../accounts/auth';
import type { SlaReportResponse } from '../../../../shared/service/contracts';
import { torontoDayKey } from '../../../../shared/service/sla-metrics';
import {
  bannerCounts,
  filterSlaRoutes,
  formatDayKeyLong,
  formatPercent,
} from './sla-view';
import { useSlaReport, loadedStopsByRoute } from './useSlaReport';
import { SlaRouteRow } from './SlaRouteRow';

type Grain = 'day' | 'week';

/** The /sla page (docs/sla-stories.md Epic 8, E8S5): a USA-status.com-style
 * status page for delivered service — a filterable list of streetcar routes
 * (expandable to their stops), each with little green/yellow/red boxes, one
 * per recorded day (or wider boxes per week). Every number is precomputed;
 * the page makes exactly one fetch, never polls, never computes. */
export function SlaPage() {
  useLanguage();
  useEffect(() => {
    document.title = t('sla.pageTitle');
  });
  const { report, failed } = useSlaReport();
  const [grain, setGrain] = useState<Grain>('day');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => filterSlaRoutes(report?.routes ?? [], needle, loadedStopsByRoute()),
    [report, needle],
  );

  const toggle = (routeId: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  return (
    <>
      <header className="account-header">
        <a className="account-link" href="/">
          {t('profile.ttcStatus')}
        </a>
        <AuthControls />
      </header>
      <main className="sla-page">
        <h1>{t('sla.reportTitle')}</h1>
        {failed && <p className="sla-failed">{t('sla.reportFailed')}</p>}
        {!failed && !report && <p className="sla-loading">{t('sla.noDataYet')}</p>}
        {!failed && report && (
          <ReportBody
            report={report}
            grain={grain}
            setGrain={setGrain}
            needle={needle}
            query={query}
            setQuery={setQuery}
            expanded={expanded}
            toggle={toggle}
            filteredRoutes={filtered.routes}
          />
        )}
      </main>
    </>
  );
}

interface BodyProps {
  report: SlaReportResponse;
  grain: Grain;
  setGrain(grain: Grain): void;
  needle: string;
  query: string;
  setQuery(query: string): void;
  expanded: Set<string>;
  toggle(routeId: string): void;
  filteredRoutes: SlaReportResponse['routes'];
}

function ReportBody({
  report,
  grain,
  setGrain,
  needle,
  query,
  setQuery,
  expanded,
  toggle,
  filteredRoutes,
}: BodyProps) {
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
  const bannerBand = report.overall.band;

  return (
    <>
      <section className={`sla-banner sla-banner--${bannerBand}`} aria-label={bannerText}>
        <p className="sla-banner__headline">{bannerText}</p>
        <p className="sla-banner__metric">
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
        </p>
      </section>

      <div className="sla-controls">
        <label className="sr-only" htmlFor="sla-filter">
          {t('sla.filterRoutesAndStops')}
        </label>
        <input
          id="sla-filter"
          className="sla-filter"
          type="search"
          placeholder={t('sla.filterRoutesAndStops')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="sla-grain" role="group" aria-label={t('sla.grainTitle')}>
          <button
            type="button"
            className="sla-grain__button"
            aria-pressed={grain === 'day'}
            onClick={() => setGrain('day')}
          >
            {t('sla.grainDay')}
          </button>
          <button
            type="button"
            className="sla-grain__button"
            aria-pressed={grain === 'week'}
            onClick={() => setGrain('week')}
          >
            {t('sla.grainWeek')}
          </button>
        </div>
      </div>

      <section className="sla-legend" aria-label={t('sla.legendTitle')}>
        <span className="sla-legend__item">
          <span className="sla-tick sla-tick--met" aria-hidden="true" />{' '}
          {t('sla.legendMet')}
        </span>
        <span className="sla-legend__item">
          <span className="sla-tick sla-tick--degraded" aria-hidden="true" />{' '}
          {t('sla.legendDegraded')}
        </span>
        <span className="sla-legend__item">
          <span className="sla-tick sla-tick--missed" aria-hidden="true" />{' '}
          {t('sla.legendMissed')}
        </span>
        <span className="sla-legend__item">
          <span className="sla-tick sla-tick--no-data" aria-hidden="true" />{' '}
          {t('sla.legendNoData')}
        </span>
        <span className="sla-legend__item">
          <span className="sla-tick sla-tick--met sla-tick--partial" aria-hidden="true" />{' '}
          {t('sla.legendToday')}
        </span>
      </section>

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
              onToggle={toggle}
              needle={needle}
            />
          ))}
        </ol>
      )}

      <details className="sla-methodology">
        <summary>{t('sla.methodology')}</summary>
        <p>
          {t('sla.methodologyBody', {
            value1: Math.round(report.targets.metRatio * 100),
            value2: report.targets.toleranceRatio,
            value3: Math.round(report.targets.degradedRatio * 100),
          })}
        </p>
      </details>
    </>
  );
}
