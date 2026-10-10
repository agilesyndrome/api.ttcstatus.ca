import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { SlaTick } from '../../../../shared/service/contracts';
import { formatDayKey, tickTip } from './sla-view';
import type { SlaLiveBucket } from './sla-live';

interface Props {
  ticks: SlaTick[];
  grain: 'day' | 'week';
  /** The live tier: thin slivers for the recorder's rolling 30-minute
   * window, one per completed 5-minute bucket, at the right edge after a
   * divider — instant realtime, visually distinct from the thicker daily
   * and weekly boxes. Absent when the recorder is unreachable. */
  live?: SlaLiveBucket[] | null;
}

/** One row of boxes — the USA-status.com anatomy plus the live tier: daily
 * tick marks, wider weekly boxes, and at the right edge a divider and six
 * thin slivers (the last 30 minutes), oldest left, "now" at the right.
 * Exactly as many boxes as there are recorded segments — no fabricated
 * history; the slivers are the recorder's own live window. */
export function SlaTickStrip({ ticks, grain, live }: Props) {
  useLanguage();
  if (ticks.length === 0 && !live) {
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
        {live && live.length > 0 && (
          <span className="sla-strip__live" role="group" aria-label={t('sla.liveLabel')}>
            {live.map((bucket) => {
              const clock = new Date(bucket.endAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              const parts = [t('sla.liveLabel'), clock];
              if (!bucket.monitored) {
                parts.push(t('sla.liveUnmonitored'));
              } else if (bucket.compliance === null) {
                parts.push(t('sla.tickNoData'));
              } else {
                parts.push(
                  t('sla.tickWithin', {
                    value1: (bucket.compliance * 100).toFixed(1),
                  }),
                );
              }
              const label = parts.join(' · ');
              const classes = ['sla-tick', 'sla-tick--live', `sla-tick--${bucket.band}`];
              if (!bucket.monitored) classes.push('sla-tick--unmonitored');
              return (
                <span
                  key={bucket.endAt}
                  className={classes.join(' ')}
                  title={label}
                  role="img"
                  aria-label={label}
                />
              );
            })}
          </span>
        )}
      </div>
      <div className="sla-strip__edges">
        <span>{ticks.length > 0 ? formatDayKey(first.key) : ''}</span>
        <span>
          {ticks.length === 0 || (live && live.length > 0)
            ? t('sla.liveNow')
            : formatDayKey(last.key)}
        </span>
      </div>
    </div>
  );
}
