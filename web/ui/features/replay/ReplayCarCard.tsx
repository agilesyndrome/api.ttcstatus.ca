import { t, getLocale } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useMemo } from 'react';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { Route } from '../../../../shared/map/model';
import type { ReplayState } from './useReplay';
import { formatDwellClock } from './replay';

/** The followed replay car's card: who it is, when the recorder last saw
 * it, and the stops it made along the way — each with the window of ticks
 * it sat still, in Toronto time. The dwell list is recomputed at every
 * frame boundary, so a stop in progress closes as the playhead moves on. */
export function ReplayCarCard({
  replay,
  car,
  routes,
  onClose,
}: {
  replay: ReplayState;
  car: PlottedVehicle;
  routes: Route[];
  onClose(): void;
}) {
  useLanguage();
  const locale = getLocale();
  const route = routes.find((entry) => entry.id === car.vehicle.routeId);
  // Recompute at each frame boundary: a new frame can extend or close the
  // stop the car is sitting in right now. (The engine identity changes per
  // render, so the deps are deliberately the frame boundary, not `replay`.)
  const stops = useMemo(
    () => replay.dwellStopsOf(car.vehicle.id),
    [car.vehicle.id, replay.frameMs, replay.loadedTicks],
  );
  const shown = stops.slice(-6).reverse();
  return (
    <div className="replay-car-card" data-replay-car={car.vehicle.id}>
      <header className="replay-car-card__head">
        {route && (
          <span
            className="replay-car-card__swatch"
            style={{ background: route.color }}
            aria-hidden="true"
          />
        )}
        <h3>{t('replay.carTitle', { value1: car.vehicle.label })}</h3>
        {route && (
          <small>
            {route.number} {route.name}
          </small>
        )}
        <button
          type="button"
          className="replay-car-card__close"
          aria-label={t('replay.clearFocus')}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p className="replay-car-card__following">
        <span className="live-dot" aria-hidden="true" /> {t('replay.following')}
        {replay.frameMs !== undefined && (
          <>
            {' '}
            · {t('replay.frameTime')} {formatDwellClock(replay.frameMs, locale)}
          </>
        )}
      </p>
      <h4>{t('replay.recordedStops')}</h4>
      {shown.length ? (
        <ul className="replay-car-card__stops">
          {shown.map((stop) => (
            <li key={stop.startMs}>
              <span className="replay-stop-window">
                {formatDwellClock(stop.startMs, locale)} –{' '}
                {formatDwellClock(stop.endMs, locale)}
              </span>
              {stop.nextStopName && (
                <span className="replay-stop-name">{stop.nextStopName}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="replay-note">{t('replay.noStopsYet')}</p>
      )}
    </div>
  );
}
