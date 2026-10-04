/** GPS observations stay independent of a network/map version. A later Worker
 * stream can deliver this same contract without changing projection/rendering. */
export interface LiveVehicle {
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
export interface VehicleSnapshot {
  schemaVersion: 1;
  fetchedAt: string;
  feedTimestamp: string | null;
  source: string;
  attribution: string;
  vehicles: LiveVehicle[];
  invalidPositions: number;
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
