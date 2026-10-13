/** GPS observations stay independent of a network/map version. A later Worker
 * stream can deliver this same contract without changing projection/rendering. */
export interface LiveVehicle {
  mode?: 'streetcar' | 'subway';
  positionKind?: 'gps' | 'next-station';
  nextStopName?: string;
  arrivalAt?: string;
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  routeId?: string;
  tripId?: string;
  bearing?: number;
  speedMetresPerSecond?: number;
  observedAt: string | null;
}
export interface SubwayPrediction {
  id: string;
  label: string;
  routeId: string;
  tripId: string;
  observedAt: string | null;
  stops: { stopId: string; sequence: number; arrivalAt: string }[];
}
/** Outage honesty on the live path (docs/optimize-transport.md change 2):
 * the recorder publishes `{ vehicles: [], outage }` every tick through a
 * total upstream failure. An outage is a *body field*, never an HTTP
 * status — the CDN path cannot speak dynamic 5xx, so the honesty moved
 * into the document. */
export interface SnapshotOutage {
  since: string;
  tickId: number;
}

export interface VehicleSnapshot {
  surfaceStatus?: 'available' | 'unavailable';
  subwaySource?: string;
  subwayPredictions?: SubwayPrediction[];
  subwayStatus?: 'available' | 'unavailable';
  schemaVersion: 1;
  fetchedAt: string;
  feedTimestamp: string | null;
  source: string;
  attribution: string;
  vehicles: LiveVehicle[];
  invalidPositions: number;
  /** The tick grid id this document was published for (`floor(epoch/cadence)`).
   * Present on live-path tick documents; lets clients detect clock drift. */
  tickId?: number;
  /** Present only while the whole upstream was down at acquisition time. */
  outage?: SnapshotOutage;
}
export const VEHICLE_STALE_AFTER_MS = 120_000;
export function vehicleIsStale(
  vehicle: LiveVehicle,
  snapshot: VehicleSnapshot,
  now = Date.now(),
): boolean {
  const timestamp = Date.parse(vehicle.observedAt ?? snapshot.feedTimestamp ?? '');
  return (
    !Number.isFinite(timestamp) ||
    now - timestamp > VEHICLE_STALE_AFTER_MS ||
    timestamp > now + 60_000
  );
}
