import type { ReactNode } from 'react';

export interface LegendItem {
  key: string;
  label: ReactNode;
  swatchClassName?: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'negative';
  partial?: boolean;
  live?: boolean;
}

export interface LegendProps {
  items: LegendItem[];
  ariaLabel: string;
  className?: string;
}

/** A reusable inline legend. Swatches accept feature-owned classes so the
 * legend does not know whether it is describing SLA bands, map states, or a
 * different visual vocabulary. */
export function Legend({ items, ariaLabel, className }: LegendProps) {
  return (
    <section
      className={['legend', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <span className="legend__item" key={item.key}>
          <span
            className={[
              'legend__swatch',
              item.tone ? `legend__swatch--${item.tone}` : '',
              item.partial ? 'legend__swatch--partial' : '',
              item.live ? 'legend__swatch--live' : '',
              item.swatchClassName,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </section>
  );
}
