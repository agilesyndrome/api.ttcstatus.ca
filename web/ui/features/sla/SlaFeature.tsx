import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { useSlaLive } from './useSlaLive';
import { loadedStopsByRoute, useSlaReport } from './useSlaReport';
import { filterSlaRoutes } from './sla-view';
import { SlaReport, type SlaGrain } from './SlaReport';

/** Stateful SLA feature: owns the report/live feeds and the user's view state,
 * while SlaReport and its children remain deterministic presentational units. */
export function SlaFeature() {
  const { report, failed } = useSlaReport();
  const live = useSlaLive(report);
  const [grain, setGrain] = useState<SlaGrain>('day');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => filterSlaRoutes(report?.routes ?? [], needle, loadedStopsByRoute()),
    [report, needle],
  );

  if (failed) return <p className="sla-failed">{t('sla.reportFailed')}</p>;
  if (!report) return <p className="sla-loading">{t('sla.noDataYet')}</p>;

  const toggle = (routeId: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  return (
    <SlaReport
      report={report}
      grain={grain}
      query={query}
      needle={needle}
      expanded={expanded}
      filteredRoutes={filtered.routes}
      live={live}
      onGrainChange={setGrain}
      onQueryChange={setQuery}
      onToggle={toggle}
    />
  );
}
