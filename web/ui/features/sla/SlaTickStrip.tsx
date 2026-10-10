import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { SlaTick } from '../../../../shared/service/contracts';
import { formatDayKey, tickTip } from './sla-view';

interface Props {
  ticks: SlaTick[];
  grain: 'day' | 'week';
}

/** One row of little boxes — the USA-status.com anatomy: one box per data
 * segment, oldest on the left, "today" on the right, exactly as many boxes
 * as there are recorded segments. Week grain renders the same boxes wider
 * (a week is seven days of promise in one glance). */
export function SlaTickStrip({ ticks, grain }: Props) {
  useLanguage();
  if (ticks.length === 0) {
    return <p className="sla-strip__empty">{t('sla.noDataYet')}</p>;
  }
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  return (
    <div className="sla-strip">
      <div
        className={
          grain === 'week' ? 'sla-strip__row sla-strip__row--week' : 'sla-strip__row'
        }
        role="group"
        aria-label={t(grain === 'week' ? 'sla.grainWeek' : 'sla.grainDay')}
      >
        {ticks.map((tick) => {
          const tip = tickTip(tick, grain);
          const parts: string[] = [];
          parts.push(
            grain === 'week' ? t('sla.tickWeekOf', { value1: tip.date }) : tip.date,
          );
          if (tip.noData) {
            parts.push(t('sla.tickNoData'));
          } else {
            if (tip.percent !== null)
              parts.push(t('sla.tickWithin', { value1: tip.percent }));
            parts.push(t('sla.tickServices', { value1: tip.services }));
            if (tip.maxGap) parts.push(t('sla.tickLongestGap', { value1: tip.maxGap }));
            if (tip.coveragePercent !== null && tip.coveragePercent !== '') {
              parts.push(t('sla.monitoredShare', { value1: tip.coveragePercent }));
            }
            if (tip.partial) parts.push(t('sla.tickTodayPartial'));
          }
          const label = parts.join(' · ');
          const classes = ['sla-tick', `sla-tick--${tick.band}`];
          if (!tick.final) classes.push('sla-tick--partial');
          return (
            <span
              key={tick.key}
              className={classes.join(' ')}
              title={label}
              role="img"
              aria-label={label}
            />
          );
        })}
      </div>
      <div className="sla-strip__edges">
        <span>{formatDayKey(first.key)}</span>
        <span>{formatDayKey(last.key)}</span>
      </div>
    </div>
  );
}
