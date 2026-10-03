import type { VehicleSnapshot } from '../../../workers/shared/live-vehicles';
import { vehicleIsStale } from '../../../workers/shared/live-vehicles';
export interface FeedState { snapshot?: VehicleSnapshot; failed: boolean; active: boolean; updateSeconds: number; retrySeconds: number; now: number }
export function LiveFeedStatus({ snapshot, failed, active, updateSeconds, retrySeconds, now }: FeedState) {
  const stale = snapshot?.vehicles.filter(vehicle => vehicleIsStale(vehicle, snapshot, now)).length ?? 0;
  return <section className="live-status" aria-label="Live feed status"><h2><span className="live-dot" aria-hidden="true" /> Live streetcars</h2>
    <p role="status">{snapshot ? `${snapshot.vehicles.length} ${snapshot.vehicles.length === 1 ? 'car' : 'cars'} reported${stale ? ` · ${stale} stale` : ''}.` : failed ? 'Live positions unavailable.' : active ? 'Loading streetcar positions…' : 'Live updates paused.'} {failed && snapshot && 'Refresh unavailable; keeping last positions.'} {failed && active && `Retry in ${retrySeconds}s.`} {!active && snapshot && 'Updates paused.'}</p>
    {snapshot && <p>Positions · {new Date(snapshot.feedTimestamp ?? snapshot.fetchedAt).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto' })} · updates every {updateSeconds}s</p>}
  </section>;
}
