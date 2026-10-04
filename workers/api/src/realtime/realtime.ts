import GtfsBindings from 'gtfs-realtime-bindings';
import type { LiveVehicle, VehicleSnapshot } from '../../../../shared/live/vehicles';

const { transit_realtime } = GtfsBindings;

export const DEFAULT_VEHICLE_FEED_URL = 'https://bustime.ttc.ca/gtfsrt/vehicles';
const MAX_FEED_BYTES = 5_000_000;

function isoTimestamp(
  value: number | { toString(): string } | null | undefined,
): string | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 && seconds < 253402300800
    ? new Date(seconds * 1000).toISOString()
    : null;
}

/** Fleet identity excludes replacement buses on streetcar routes and includes
 * cars without trips. Audited fleet: TTC 2026 service summary, cars 4400–4663.
 * https://www.ttc.ca/news/2026/January/TTC-welcomes-60th-streetcar-expanding-fleet-to-264
 */
export function isFlexity(id: string): boolean {
  return /^\d{4}$/.test(id) && Number(id) >= 4400 && Number(id) <= 4663;
}

export function decodeVehicleSnapshot(
  bytes: Uint8Array,
  source: string,
  attribution: string,
  now = new Date(),
): VehicleSnapshot {
  const feed = transit_realtime.FeedMessage.decode(bytes);
  if (
    feed.header.incrementality === transit_realtime.FeedHeader.Incrementality.DIFFERENTIAL
  ) {
    throw new Error('A differential feed cannot be used as a complete snapshot');
  }
  const vehicles = new Map<string, LiveVehicle>();
  let invalidPositions = 0;
  for (const entity of feed.entity) {
    const observation = entity.vehicle;
    if (entity.isDeleted || !observation) continue;
    const id = observation.vehicle?.id || observation.vehicle?.label || '';
    if (!isFlexity(id)) continue;
    const position = observation.position;
    if (
      !position ||
      !Object.hasOwn(position, 'latitude') ||
      !Object.hasOwn(position, 'longitude') ||
      !Number.isFinite(position.latitude) ||
      !Number.isFinite(position.longitude) ||
      Math.abs(position.latitude) > 90 ||
      Math.abs(position.longitude) > 180 ||
      (position.latitude === 0 && position.longitude === 0)
    ) {
      invalidPositions++;
      continue;
    }
    const vehicle: LiveVehicle = {
      id,
      label: observation.vehicle?.label || id,
      latitude: position.latitude,
      longitude: position.longitude,
      observedAt: isoTimestamp(observation.timestamp),
      ...(observation.trip?.routeId ? { routeId: observation.trip.routeId } : {}),
      ...(observation.trip?.tripId ? { tripId: observation.trip.tripId } : {}),
    };
    // Protobuf defaults must not invent a northbound bearing or zero speed.
    if (
      Object.hasOwn(position, 'bearing') &&
      Number.isFinite(position.bearing) &&
      position.bearing! >= 0 &&
      position.bearing! < 360
    )
      vehicle.bearing = position.bearing!;
    if (
      Object.hasOwn(position, 'speed') &&
      Number.isFinite(position.speed) &&
      position.speed! >= 0
    )
      vehicle.speedMetresPerSecond = position.speed!;
    const previous = vehicles.get(id);
    if (!previous || (vehicle.observedAt ?? '') > (previous.observedAt ?? ''))
      vehicles.set(id, vehicle);
  }
  return {
    schemaVersion: 1,
    fetchedAt: now.toISOString(),
    feedTimestamp: isoTimestamp(feed.header.timestamp),
    source,
    attribution,
    vehicles: [...vehicles.values()].sort((a, b) => a.id.localeCompare(b.id)),
    invalidPositions,
  };
}

/** Read upstream once. Cache orchestration is separate, allowing a scheduled
 * or stateful Worker to reuse acquisition without calling our public API. */
export async function fetchVehicleSnapshot(
  source: string,
  attribution: string,
): Promise<VehicleSnapshot> {
  const response = await fetch(source, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/x-protobuf' },
  });
  if (!response.ok) throw new Error(`Vehicle feed returned HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_FEED_BYTES)
    throw new Error('Vehicle feed is too large');
  if (!response.body) throw new Error('Vehicle feed is empty');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new Error('Vehicle feed is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeVehicleSnapshot(bytes, source, attribution);
}
