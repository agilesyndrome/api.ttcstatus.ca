import { t } from '../../i18n';
import type { SlaTick } from '../../../../shared/service/contracts';
import type { TickStripItem, TickStripProps } from '../../components/data/TickStrip';
import { formatDayKey, tickTip } from './sla-view';
import type { SlaLiveBucket } from './sla-live';

function toneForBand(band: SlaTick['band'] | SlaLiveBucket['band']): string {
  return band === 'met'
    ? 'positive'
    : band === 'degraded'
      ? 'warning'
      : band === 'missed'
        ? 'negative'
        : 'neutral';
}

/** Converts the SLA contract into the shared tick-strip vocabulary. Keeping
 * this as a data adapter means route and stop rows can render the same generic
 * component without duplicating tooltip or live-tail logic. */
export function slaTickStripProps(
  ticks: SlaTick[],
  grain: 'day' | 'week',
  live?: SlaLiveBucket[] | null,
): TickStripProps {
  const tickItems: TickStripItem[] = ticks.map((tick) => {
    const tip = tickTip(tick, grain);
    const parts: string[] = [
      grain === 'week' ? t('sla.tickWeekOf', { value1: tip.date }) : tip.date,
    ];
    if (tip.noData) {
      parts.push(t('sla.tickNoData'));
    } else {
      if (tip.percent !== null) parts.push(t('sla.tickWithin', { value1: tip.percent }));
      parts.push(t('sla.tickServices', { value1: tip.services }));
      if (tip.maxGap) parts.push(t('sla.tickLongestGap', { value1: tip.maxGap }));
      if (tip.coveragePercent !== null && tip.coveragePercent !== '')
        parts.push(t('sla.monitoredShare', { value1: tip.coveragePercent }));
      if (tip.partial) parts.push(t('sla.tickTodayPartial'));
    }
    return {
      key: tick.key,
      tone: toneForBand(tick.band),
      label: parts.join(' · '),
      partial: !tick.final,
    };
  });
  const liveItems: TickStripItem[] | null = live
    ? live.map((bucket) => {
        const clock = new Date(bucket.endAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        const parts = [t('sla.liveLabel'), clock];
        if (!bucket.monitored) parts.push(t('sla.liveUnmonitored'));
        else if (bucket.compliance === null) parts.push(t('sla.tickNoData'));
        else
          parts.push(
            t('sla.tickWithin', { value1: (bucket.compliance * 100).toFixed(1) }),
          );
        return {
          key: String(bucket.endAt),
          tone: toneForBand(bucket.band),
          label: parts.join(' · '),
          unmonitored: !bucket.monitored,
        };
      })
    : null;

  return {
    ticks: tickItems,
    live: liveItems,
    size: grain === 'week' ? 'wide' : 'standard',
    ariaLabel: t(grain === 'week' ? 'sla.grainWeek' : 'sla.grainDay'),
    liveAriaLabel: t('sla.liveLabel'),
    emptyLabel: t('sla.noDataYet'),
    startLabel: ticks.length > 0 ? formatDayKey(ticks[0].key) : '',
    endLabel:
      ticks.length === 0 || (live && live.length > 0)
        ? t('sla.liveNow')
        : formatDayKey(ticks[ticks.length - 1].key),
  };
}
