import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { Feature, ViewerData } from '../../../../shared/map/model';

export interface JourneyStop {
  id: string;
  name: string;
  sequence: number;
}

export interface VehicleJourneyEstimate {
  headsign: string;
  previous: JourneyStop[];
  upcoming: JourneyStop[];
}

/** Find the likely scheduled stop sequence from a vehicle's mapped position
 * and heading. The vehicle feed does not identify a pattern or confirm stop
 * calls, so this is route context rather than a record of service. */
export function vehicleJourney(
  data: ViewerData,
  car: PlottedVehicle,
): VehicleJourneyEstimate | null {
  const routeId = car.vehicle.routeId;
  if (!routeId || car.vehicle.mode === 'subway' || !car.match) return null;

  const featuresByStop = new Map<string, Feature>();
  for (const feature of data.features) {
    if (!feature.routeIds.includes(routeId)) continue;
    for (const stopId of feature.stopIds ?? [])
      if (!featuresByStop.has(stopId)) featuresByStop.set(stopId, feature);
  }

  const facing = [
    Math.cos((car.angle * Math.PI) / 180),
    Math.sin((car.angle * Math.PI) / 180),
  ];
  let best:
    | {
        score: number;
        distance: number;
        nextIndex: number;
        stops: JourneyStop[];
        headsign: string;
      }
    | undefined;

  for (const pattern of data.patterns ?? []) {
    if (pattern.routeId !== routeId) continue;
    const stops: (JourneyStop & { point: Feature['point'] })[] = [];
    for (let index = 0; index < pattern.stopIds.length; index++) {
      const feature = featuresByStop.get(pattern.stopIds[index]);
      if (!feature || feature.id === stops.at(-1)?.id) continue;
      stops.push({
        id: feature.id,
        name: feature.name,
        sequence: index + 1,
        point: feature.point,
      });
    }
    if (stops.length < 2) continue;

    for (let index = 0; index < stops.length - 1; index++) {
      const from = stops[index].point;
      const to = stops[index + 1].point;
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const length = Math.hypot(dx, dy);
      if (length < 0.01) continue;
      const progress = Math.max(
        0,
        Math.min(
          1,
          ((car.point[0] - from[0]) * dx + (car.point[1] - from[1]) * dy) /
            (length * length),
        ),
      );
      const distance = Math.hypot(
        car.point[0] - from[0] - progress * dx,
        car.point[1] - from[1] - progress * dy,
      );
      const alignment = (facing[0] * dx + facing[1] * dy) / length;
      const score = distance + (1 - alignment) * Math.min(45, Math.max(20, length));
      if (
        !best ||
        score < best.score - 0.01 ||
        (Math.abs(score - best.score) <= 0.01 && stops.length > best.stops.length)
      )
        best = {
          score,
          distance,
          nextIndex: index + 1,
          stops,
          headsign: pattern.headsign,
        };
    }
  }

  // A remote or off-route observation cannot support a useful stop sequence.
  if (!best || best.distance > 80) return null;
  const clean = ({ id, name, sequence }: JourneyStop): JourneyStop => ({
    id,
    name,
    sequence,
  });
  return {
    headsign: best.headsign,
    previous: best.stops
      .slice(Math.max(0, best.nextIndex - 3), best.nextIndex)
      .map(clean),
    upcoming: best.stops.slice(best.nextIndex).map(clean),
  };
}
