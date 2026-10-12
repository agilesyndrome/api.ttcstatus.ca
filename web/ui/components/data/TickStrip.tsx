import type { ReactNode } from 'react';

export interface TickStripItem {
  key: string;
  tone: string;
  label: string;
  partial?: boolean;
  unmonitored?: boolean;
}

export interface TickStripProps {
  ticks: TickStripItem[];
  live?: TickStripItem[] | null;
  size?: 'standard' | 'wide';
  ariaLabel: string;
  liveAriaLabel?: string;
  emptyLabel: ReactNode;
  startLabel?: ReactNode;
  endLabel?: ReactNode;
}

/** A data-agnostic row of status ticks. Features provide the display labels,
 * tones, and edge captions; this component only owns the visual grammar. */
export function TickStrip({
  ticks,
  live,
  size = 'standard',
  ariaLabel,
  liveAriaLabel = 'Live',
  emptyLabel,
  startLabel = '',
  endLabel = '',
}: TickStripProps) {
  if (ticks.length === 0 && (!live || live.length === 0)) {
    return <p className="tick-strip__empty">{emptyLabel}</p>;
  }

  return (
    <div className="tick-strip">
      <div
        className={
          size === 'wide' ? 'tick-strip__row tick-strip__row--wide' : 'tick-strip__row'
        }
        role="group"
        aria-label={ariaLabel}
      >
        {ticks.map((tick) => (
          <span
            key={tick.key}
            className={[
              'tick-strip__tick',
              `tick-strip__tick--${tick.tone}`,
              tick.partial ? 'tick-strip__tick--partial' : '',
              tick.unmonitored ? 'tick-strip__tick--unmonitored' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={tick.label}
            role="img"
            aria-label={tick.label}
          />
        ))}
        {live && live.length > 0 && (
          <span className="tick-strip__live" role="group" aria-label={liveAriaLabel}>
            {live.map((tick) => (
              <span
                key={tick.key}
                className={[
                  'tick-strip__tick',
                  'tick-strip__tick--live',
                  `tick-strip__tick--${tick.tone}`,
                  tick.partial ? 'tick-strip__tick--partial' : '',
                  tick.unmonitored ? 'tick-strip__tick--unmonitored' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={tick.label}
                role="img"
                aria-label={tick.label}
              />
            ))}
          </span>
        )}
      </div>
      <div className="tick-strip__edges">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
