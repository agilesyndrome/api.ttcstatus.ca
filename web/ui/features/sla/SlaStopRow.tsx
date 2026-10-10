import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { SlaStopReport } from '../../../../shared/service/contracts';
import { formatPercent } from './sla-view';
import { SlaTickStrip } from './SlaTickStrip';
import type { SlaLiveBucket } from './sla-live';

interface Props {
  stop: SlaStopReport;
  grain: 'day' | 'week';
  /** The live tier's slivers for this stop (its route's target). */
  live?: SlaLiveBucket[] | null;
}

/** One directional stop's row inside an expanded route: the stop's name, the
 * direction it serves, and its own honest strip — with the live slivers
 * judged against the owning route's advertised target. */
export function SlaStopRow({ stop, grain, live }: Props) {
  useLanguage();
  const percent = formatPercent(stop.overall.compliance);
  const bandClass = stop.overall.latestBand ?? 'no-data';
  return (
    <li className={`sla-stop sla-stop--${bandClass}`} data-stop={stop.stopId}>
      <div className="sla-stop__head">
        <span className="sla-stop__name">{stop.name}</span>
        {stop.headsign && <span className="sla-stop__headsign">{stop.headsign}</span>}
        <span className={`sla-stop__status sla-stop__status--${bandClass}`}>
          {percent === null ? '—' : t('sla.tickWithin', { value1: percent })}
        </span>
      </div>
      <SlaTickStrip
        ticks={grain === 'day' ? stop.days : stop.weeks}
        grain={grain}
        live={live}
      />
    </li>
  );
}
