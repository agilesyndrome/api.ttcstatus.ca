import GtfsBindings from 'gtfs-realtime-bindings';
import type {
  LiveVehicle,
  VehicleSnapshot,
  SubwayPrediction,
} from '../../../../shared/live/vehicles';

const { transit_realtime } = GtfsBindings;

export const DEFAULT_VEHICLE_FEED_URL = 'https://bustime.ttc.ca/gtfsrt/vehicles';
export const DEFAULT_SUBWAY_FEED_URL = 'https://gtfsrt.ttc.ca/trips/subway?format=binary';
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
  return decodeVehicleSnapshot(await fetchFeedBytes(source), source, attribution);
}

async function fetchFeedBytes(source: string): Promise<Uint8Array> {
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
  return bytes;
}

/** Subway trip updates contain station predictions, not GPS observations. */
export function decodeSubwayPredictions(bytes: Uint8Array): SubwayPrediction[] {
  const feed = transit_realtime.FeedMessage.decode(bytes);
  if (
    feed.header.incrementality === transit_realtime.FeedHeader.Incrementality.DIFFERENTIAL
  )
    throw new Error('A differential feed cannot be used as a complete snapshot');
  const predictions = new Map<string, SubwayPrediction>();
  for (const entity of feed.entity) {
    const update = entity.tripUpdate;
    if (entity.isDeleted || !update || !/^(1|2|4|5|6)$/.test(update.trip.routeId ?? ''))
      continue;
    if (
      update.trip.scheduleRelationship ===
        transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED ||
      update.trip.scheduleRelationship ===
        transit_realtime.TripDescriptor.ScheduleRelationship.DELETED
    )
      continue;
    const stops = (update.stopTimeUpdate ?? [])
      .flatMap((stop) => {
        if (
          stop.scheduleRelationship ===
            transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED ||
          stop.scheduleRelationship ===
            transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.NO_DATA
        )
          return [];
        const arrivalAt = isoTimestamp(stop.arrival?.time ?? stop.departure?.time);
        return stop.stopId && arrivalAt
          ? [{ stopId: stop.stopId, sequence: stop.stopSequence ?? 0, arrivalAt }]
          : [];
      })
      .sort((a, b) => a.sequence - b.sequence);
    if (!stops.length) continue;
    const routeId = update.trip.routeId!;
    const number = update.vehicle?.label || update.vehicle?.id;
    const id = `subway:${routeId}:${update.vehicle?.id || update.trip.tripId || entity.id}`;
    const prediction: SubwayPrediction = {
      id,
      label: number || `Trip ${update.trip.tripId || entity.id}`,
      routeId,
      tripId: update.trip.tripId || entity.id,
      observedAt: isoTimestamp(update.timestamp) ?? isoTimestamp(feed.header.timestamp),
      stops,
    };
    if (
      !predictions.has(id) ||
      (prediction.observedAt ?? '') > (predictions.get(id)!.observedAt ?? '')
    )
      predictions.set(id, prediction);
  }
  return [...predictions.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchRailSnapshot(
  source: string,
  attribution: string,
  subwaySource = DEFAULT_SUBWAY_FEED_URL,
): Promise<VehicleSnapshot> {
  const [surface, subway] = await Promise.allSettled([
    fetchVehicleSnapshot(source, attribution),
    fetchFeedBytes(subwaySource).then(decodeSubwayPredictions),
  ]);
  if (surface.status === 'rejected' && subway.status === 'rejected') throw surface.reason;
  return {
    ...(surface.status === 'fulfilled'
      ? surface.value
      : {
          schemaVersion: 1 as const,
          vehicles: [],
          invalidPositions: 0,
          fetchedAt: new Date().toISOString(),
          feedTimestamp: null,
          source,
          attribution,
        }),
    surfaceStatus: surface.status === 'fulfilled' ? 'available' : 'unavailable',
    subwaySource,
    subwayPredictions: subway.status === 'fulfilled' ? subway.value : [],
    subwayStatus: subway.status === 'fulfilled' ? 'available' : 'unavailable',
  };
}
