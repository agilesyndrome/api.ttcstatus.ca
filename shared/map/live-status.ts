import { gpsToMap, matchGpsToTrack, pointAlongEdge, type TrackMatch } from './projection';
import { vehicleIsStale, type LiveVehicle, type VehicleSnapshot } from '../live/vehicles';
import type { Edge, Point, ViewerData } from './model';

export interface PlottedVehicle {
  vehicle: LiveVehicle;
  point: Point;
  angle: number;
  match?: TrackMatch;
  stale: boolean;
}

/** Snapshot ingestion is pure and transport-independent. A future stream only
 * needs to replace the snapshot and provide previous matches for continuity. */
export function projectSnapshot(
  data: ViewerData,
  snapshot: VehicleSnapshot,
  now = Date.now(),
  previous: PlottedVehicle[] = [],
): PlottedVehicle[] {
  const previousById = new Map(
    previous.map((car) => [car.vehicle.id, car.match?.edgeId]),
  );
  return snapshot.vehicles.map((vehicle) => {
    const match = matchGpsToTrack(data.edges, vehicle.latitude, vehicle.longitude, {
      routeId: vehicle.routeId,
      bearing: vehicle.bearing,
      previousEdgeId: previousById.get(vehicle.id),
      transform: data.geographicTransform,
    });
    const point =
      match?.point ??
      gpsToMap(vehicle.latitude, vehicle.longitude, data.geographicTransform);
    // Transform bearing in geographic space, including unequal axis scaling.
    const radians = ((vehicle.bearing ?? 90) * Math.PI) / 180;
    const ahead = gpsToMap(
      vehicle.latitude + Math.cos(radians) * 0.0001,
      vehicle.longitude +
        (Math.sin(radians) * 0.0001) / Math.cos((vehicle.latitude * Math.PI) / 180),
      data.geographicTransform,
    );
    return {
      vehicle,
      point,
      match,
      angle:
        match?.angle ??
        (Math.atan2(ahead[1] - point[1], ahead[0] - point[0]) * 180) / Math.PI,
      stale: vehicleIsStale(vehicle, snapshot, now),
    };
  });
}

/** Sample the articulated body behind its GPS fix. Continue only through real
 * graph endpoints, choosing the straightest route-compatible continuation.
 * Body length is exaggerated for readability; it is not a vehicle-length scale. */
export function streetcarBody(
  car: PlottedVehicle,
  edges: Edge[],
  scale: number,
): { point: Point; angle: number }[] {
  if (!car.match) {
    const radians = (car.angle * Math.PI) / 180;
    return Array.from({ length: 5 }, (_, i) => ({
      point: [
        car.point[0] - ((i * 6) / scale) * Math.cos(radians),
        car.point[1] - ((i * 6) / scale) * Math.sin(radians),
      ] as Point,
      angle: car.angle,
    }));
  }
  let edge = edges.find((e) => e.id === car.match!.edgeId)!,
    direction = car.match.direction,
    distance = car.match.distanceAlongMetres;
  const body: { point: Point; angle: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const sample = pointAlongEdge(edge, distance);
    body.push({
      point: sample.point,
      angle: sample.angle + (direction === -1 ? 180 : 0),
    });
    const local = pointAlongEdge(edge, Math.min(edge.lengthMetres, distance + 1));
    const fallback = pointAlongEdge(edge, Math.max(0, distance - 1));
    const pixelsPerMetre =
      Math.hypot(local.point[0] - fallback.point[0], local.point[1] - fallback.point[1]) /
      (Math.min(edge.lengthMetres, distance + 1) - Math.max(0, distance - 1) || 1);
    let remaining = 6 / (scale * Math.max(0.001, pixelsPerMetre));
    // A finite guard also handles loops and malformed zero-length edges.
    for (let steps = 0; remaining > 0 && steps < edges.length; steps++) {
      const available = direction === 1 ? distance : edge.lengthMetres - distance;
      if (remaining <= available) {
        distance -= direction * remaining;
        break;
      }
      remaining -= available;
      const node = direction === 1 ? edge.a : edge.b;
      const heading = body.at(-1)!.angle;
      const candidates = edges
        .filter((e) => e.id !== edge.id && (e.a === node || e.b === node))
        .map((next) => {
          const nextDirection: 1 | -1 = next.b === node ? 1 : -1;
          const nextDistance = nextDirection === 1 ? next.lengthMetres : 0;
          const angle =
            pointAlongEdge(next, nextDistance).angle + (nextDirection === -1 ? 180 : 0);
          const turn = Math.abs(((angle - heading + 540) % 360) - 180);
          return {
            next,
            nextDirection,
            nextDistance,
            score:
              turn +
              (car.vehicle.routeId && !next.routeIds.includes(car.vehicle.routeId)
                ? 45
                : 0),
          };
        })
        .sort((a, b) => a.score - b.score || a.next.id.localeCompare(b.next.id));
      const next = candidates[0];
      if (!next || next.score >= 135) {
        distance = direction === 1 ? 0 : edge.lengthMetres;
        break;
      }
      edge = next.next;
      direction = next.nextDirection;
      distance = next.nextDistance;
    }
  }
  return body;
}
