import { useMemo, useState } from 'react';
import { serviceConfig } from '../../../../shared/service/config';
import { drynessColor } from './wave-field';
import type { ColourMode, FieldTheme } from '../../../../shared/map/field-palette';
import { trackEvent } from '../../analytics';
import { t } from '../../i18n';

export type LegendBucket = 'fresh' | 'due' | 'void' | 'beyond';

export interface LegendBarProps {
  theme?: FieldTheme;
  colourMode?: ColourMode;
  selectedHeadwayMinutes?: number;
}

const BUCKETS: readonly LegendBucket[] = ['fresh', 'due', 'void', 'beyond'];

export function minuteRuler(headwayMinutes: number, config = serviceConfig()) {
  return [
    0,
    headwayMinutes * config.freshDrynessRatio,
    headwayMinutes,
    headwayMinutes * config.voidDrynessRatio,
  ];
}

export function LegendBar({
  theme = 'light',
  colourMode = 'standard',
  selectedHeadwayMinutes,
}: LegendBarProps) {
  const config = serviceConfig();
  const [highlight, setHighlight] = useState<LegendBucket | null>(null);
  const samples = useMemo(
    () =>
      Array.from({ length: 11 }, (_, index) =>
        drynessColor(index / 4, undefined, theme, colourMode),
      ),
    [theme, colourMode],
  );
  const ruler = minuteRuler(selectedHeadwayMinutes ?? 3, config);
  const rows = selectedHeadwayMinutes
    ? [
        {
          label: t('serviceLegend.selectedRoute'),
          values: ruler,
        },
      ]
    : [
        { label: t('serviceLegend.frequentRoute'), values: minuteRuler(3, config) },
        { label: t('serviceLegend.localRoute'), values: minuteRuler(12, config) },
      ];
  const selectBucket = (bucket: LegendBucket) => {
    const next = highlight === bucket ? null : bucket;
    setHighlight(next);
    if (next) trackEvent('legend-highlight');
    else trackEvent('legend-row-select');
  };
  return (
    <section
      className="service-legend-bar"
      data-state={highlight ?? undefined}
      aria-label={t('serviceLegend.title')}
    >
      <strong>{t('serviceLegend.title')}</strong>
      <div className="service-legend-bar__ramp" role="group">
        <div
          className="service-legend-bar__gradient"
          onPointerDown={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const bucket =
              BUCKETS[
                Math.min(
                  3,
                  Math.floor(((event.clientX - bounds.left) / bounds.width) * 4),
                )
              ]!;
            selectBucket(bucket);
          }}
        >
          {BUCKETS.map((bucket, index) => (
            <span
              key={bucket}
              className="service-legend-bar__segment"
              data-state={bucket}
              style={{
                background: `linear-gradient(90deg, ${samples.slice(index * 3, index * 3 + 4).join(', ')})`,
              }}
            />
          ))}
        </div>
        <div className="service-legend-bar__labels">
          <button type="button" onClick={() => selectBucket('fresh')}>
            {t('serviceLegend.justWent')}
          </button>
          <button type="button" onClick={() => selectBucket('due')}>
            {t('serviceLegend.longerThanUsual')}
          </button>
          <button type="button" onClick={() => selectBucket('void')}>
            {t('serviceLegend.realGap')}
          </button>
          <button type="button" onClick={() => selectBucket('beyond')}>
            {t('serviceLegend.beyondTwoTimes')}
          </button>
        </div>
      </div>
      <div className="service-legend-bar__rows">
        {rows.map((row) => (
          <button
            type="button"
            className="service-legend-bar__row"
            key={row.label}
            onClick={() => {
              trackEvent('legend-row-select');
              selectBucket('due');
            }}
          >
            <span>{row.label}</span>
            <span>
              {row.values.map((value, index) =>
                index
                  ? ` · ${Math.round(value)} ${t('serviceLegend.minutes')}`
                  : t('serviceLegend.justWent'),
              )}
            </span>
          </button>
        ))}
      </div>
      <span className="service-legend-bar__nodata">
        <i aria-hidden="true" /> {t('serviceLegend.noData')}
      </span>
    </section>
  );
}
