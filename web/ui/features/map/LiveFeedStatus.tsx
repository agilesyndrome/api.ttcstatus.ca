import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { vehicleIsStale } from '../../../../shared/live/vehicles';
export interface FeedState {
  snapshot?: VehicleSnapshot;
  failed: boolean;
  active: boolean;
  updateSeconds: number;
  retrySeconds: number;
  now: number;
}
export function LiveFeedStatus({
  snapshot,
  failed,
  active,
  updateSeconds,
  retrySeconds,
  now,
}: FeedState) {
  const stale =
    snapshot?.vehicles.filter((vehicle) => vehicleIsStale(vehicle, snapshot, now))
      .length ?? 0;
  return (
    <section className="live-status" aria-label="Live feed status">
      <h2>
        <span className="live-dot" aria-hidden="true" /> Live trains & streetcars
      </h2>
      <p role="status">
        {snapshot
          ? `${snapshot.vehicles.length} ${snapshot.vehicles.length === 1 ? 'car' : 'cars'} reported${stale ? ` · ${stale} stale` : ''}.`
          : failed
            ? 'Live positions unavailable.'
            : active
              ? 'Loading vehicle reports…'
              : 'Live updates paused.'}{' '}
        {failed && snapshot && 'Refresh unavailable; keeping last positions.'}{' '}
        {failed && active && `Retry in ${retrySeconds}s.`}{' '}
        {!active && snapshot && 'Updates paused.'}
      </p>
      {snapshot?.surfaceStatus === 'unavailable' && (
        <p>Streetcar positions unavailable.</p>
      )}
      {snapshot?.subwayStatus && (
        <p>
          {snapshot.subwayStatus === 'unavailable'
            ? 'Subway predictions unavailable.'
            : `${snapshot.subwayPredictions?.length ?? 0} train predictions · markers show next reported station, not GPS.`}{' '}
          Lines without live reports show routes only.
        </p>
      )}
      {snapshot && (
        <p>
          Positions ·{' '}
          {new Date(snapshot.feedTimestamp ?? snapshot.fetchedAt).toLocaleTimeString(
            'en-CA',
            { timeZone: 'America/Toronto' },
          )}{' '}
          · updates every {updateSeconds}s
        </p>
      )}
    </section>
  );
}
