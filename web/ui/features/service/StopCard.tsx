import type { ReactNode } from 'react';
import type { StopServiceState } from '../../../../shared/service/contracts';
import { SERVICE_WINDOW_SECONDS } from '../../../../shared/service/config';
import { platformRoutes, stopSentence, STATE_COLORS } from './wave-field';
import type { RouteBadge } from './wave-field';

export interface StopCardProps {
  stop: StopServiceState;
  name?: string;
  onClear: () => void;
  children?: ReactNode;
  onDetailsToggle?: (open: boolean) => void;
  /** The two switchers (Route, then Direction), rendered under the title
   * bar so a mis-tap can be corrected without leaving the popup. */
  controls?: ReactNode;
  /** The day routes serving this platform — night 3xx twins fold into
   * their 5xx day numbers; "305 Dundas" never shows at noon. */
  routes?: RouteBadge[];
}

/** The fast-read screen rounds to whole minutes — here only. The API stays
 * honest (fractional); a mom holding kids at a stop needs "11 min ago",
 * not "10.7 min". */
const wholeMin = (minutes: number | null): string =>
  minutes === null ? '—' : `${Math.round(minutes)} min`;

/** The rolling window the "usually" numbers average over, in minutes. */
const WINDOW_MIN = SERVICE_WINDOW_SECONDS / 60;
const stateLabels: Record<StopServiceState['state'], string> = {
  fresh: 'Recently served',
  due: 'Getting due',
  void: 'Service gap',
  unmonitored: 'Status unavailable',
  collecting: 'Gathering data',
};

/** The stop's fast read (the street test): three scan lines, minutes only —
 * what's coming, what just passed, and whether cars bunched. The name lives
 * in the title; the story prose waits in "details". Every number is one we
 * already serve — no editorialising. */
export function StopCard({
  stop,
  name,
  onClear,
  children,
  onDetailsToggle,
  controls,
  routes,
}: StopCardProps) {
  const med =
    stop.medianHeadwayOwnSeconds !== null ? stop.medianHeadwayOwnSeconds / 60 : null;
  const est = stop.expectedWaitSeconds !== null ? stop.expectedWaitSeconds / 60 : null;
  const nextCar = est === null ? '—' : est < 1 ? 'almost here' : `${wholeMin(est)} away`;
  return (
    <div
      className="service-card"
      data-stop-id={stop.stopId}
      data-state={stop.state}
      aria-label={`Delivered service for ${name ?? stop.stopId}`}
    >
      <div className="service-card__bar">
        <h2 className="service-card__name">{name ?? stop.stopId}</h2>
        <button className="chip" onClick={onClear} aria-label="Clear selected stop">
          ×
        </button>
      </div>
      {controls}
      <div className="service-card__arrival">
        <span>Next car</span>
        <strong>{nextCar}</strong>
      </div>
      <p className="service-card__status" data-state={stop.state}>
        <span
          className="service-card__status-dot"
          style={{ background: STATE_COLORS[stop.state] }}
        />
        {stateLabels[stop.state]}
      </p>
      <dl className="service-card__facts">
        <div>
          <dt>last service</dt>
          <dd>
            {stop.minutesSince === null ? '—' : `${wholeMin(stop.minutesSince)} ago`}
          </dd>
        </div>
        {stop.backToBack > 0 && (
          <div>
            <dt>bunched cars</dt>
            <dd>
              {stop.backToBack} back-to-back passed in the last {WINDOW_MIN} min
            </dd>
          </div>
        )}
        {med !== null && (
          <div>
            <dt>usually</dt>
            <dd>
              a car every {wholeMin(med)} (average over the last {WINDOW_MIN} min)
            </dd>
          </div>
        )}
      </dl>
      <details
        className="service-card__details"
        onToggle={(event) => onDetailsToggle?.(event.currentTarget.open)}
      >
        <summary>Service details</summary>
        <div className="service-card__detail-content">
          <p className="service-card__sentence">{stopSentence(stop)}</p>
          {stop.backToBack > 0 && (
            <p className="service-card__badge">
              A pair passed through here — {stop.backToBack} back-to-back service
              {stop.backToBack === 1 ? '' : 's'} in the window (shown, never detected). We
              can’t see what’s still upstream, so this counts what already passed, never
              what’s coming.
            </p>
          )}
          {stop.state === 'unmonitored' && (
            <p className="service-card__badge">
              This is a blind spot, not a verdict — one fabricated void would ruin every
              real one.
            </p>
          )}
          {stop.state !== 'unmonitored' && (
            <p className="service-card__badge">
              Dryness {stop.dryness === null ? '—' : `${stop.dryness.toFixed(1)}×`} the
              usual (minutes since last car ÷ this stop’s own average).
            </p>
          )}
          {(routes ?? platformRoutes(stop.routeIds, [])).length > 0 && (
            <p className="service-card__routes">
              routes:{' '}
              {(routes ?? platformRoutes(stop.routeIds, []))
                .map((route) => `${route.number} ${route.name}`.trim())
                .join(', ')}
            </p>
          )}
          {children}
        </div>
      </details>
    </div>
  );
}
