import type { StopServiceState } from '../../../../shared/service/contracts';
import { stopSentence, STATE_COLORS } from './wave-field';

export interface StopCardProps {
  stop: StopServiceState;
  name?: string;
  onClear: () => void;
}

const fmt = (value: number | null, decimals = 1) =>
  value === null ? '—' : String(Number(value.toFixed(decimals)));

/** The stop's story, in words (the grandma test): what happened, what's
 * usual here, how long the next car should be, and the honest blind spots.
 * Every sentence is a number we already serve — no editorialising. */
export function StopCard({ stop, name, onClear }: StopCardProps) {
  const med =
    stop.medianHeadwayOwnSeconds !== null ? stop.medianHeadwayOwnSeconds / 60 : null;
  const est = stop.expectedWaitSeconds !== null ? stop.expectedWaitSeconds / 60 : null;
  const uneven = (stop.irregularity ?? 0) >= 0.5;
  return (
    <div
      className="service-card"
      data-stop-id={stop.stopId}
      data-state={stop.state}
      aria-label={`Delivered service for ${name ?? stop.stopId}`}
    >
      <div className="service-card__bar">
        <span
          className="service-card__dot"
          style={{ background: STATE_COLORS[stop.state] }}
          data-state={stop.state}
        />
        <strong className="service-card__name">{name ?? stop.stopId}</strong>
        <span className="service-card__state">{stop.state}</span>
        <button className="chip" onClick={onClear} aria-label="Clear selected stop">
          ×
        </button>
      </div>
      <p className="service-card__sentence">{stopSentence(stop, name ?? stop.stopId)}</p>
      <dl className="service-card__facts">
        <div>
          <dt>waited</dt>
          <dd>{stop.minutesSince === null ? '—' : `${fmt(stop.minutesSince)} min`}</dd>
        </div>
        <div>
          <dt>usually</dt>
          <dd>{med === null ? 'collecting' : `${fmt(med)} min`}</dd>
        </div>
        <div>
          <dt>dryness</dt>
          <dd>{stop.dryness === null ? '—' : `${fmt(stop.dryness)}×`}</dd>
        </div>
        <div>
          <dt>next car</dt>
          <dd>{est === null ? '—' : `≈ ${fmt(est)} min`}</dd>
        </div>
      </dl>
      {stop.backToBack > 0 && (
        <p className="service-card__badge">
          A pair passed through here — {stop.backToBack} back-to-back service
          {stop.backToBack === 1 ? '' : 's'} in the window (shown, never detected).
        </p>
      )}
      {uneven && stop.state !== 'unmonitored' && (
        <p className="service-card__badge">
          Service has been uneven here — the gaps vary a lot (CV²{' '}
          {fmt(stop.irregularity, 2)}), which is exactly what inflates the wait.
        </p>
      )}
      {stop.state === 'unmonitored' && (
        <p className="service-card__badge">
          This is a blind spot, not a verdict — one fabricated void would ruin every real
          one.
        </p>
      )}
      {stop.routeIds.length > 0 && (
        <p className="service-card__routes">routes: {stop.routeIds.join(', ')}</p>
      )}
    </div>
  );
}
