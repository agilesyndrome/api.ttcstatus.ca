import type { BoardingStop } from '../../../../shared/transit/stop-directory';
import type { MapSourceData } from '../types';

/** Preserve boarding records before any clustering, rail snapping, or schematic warping. */
export function boardingStopsById(data: MapSourceData): Map<string, BoardingStop> {
  const patterns = new Map(data.patterns.map((pattern) => [pattern.pattern_id, pattern]));
  const stops = new Map<string, BoardingStop>();
  for (const stop of data.stops) {
    if (
      !Number.isFinite(stop.lat) ||
      !Number.isFinite(stop.lon) ||
      Math.abs(stop.lat) > 90 ||
      Math.abs(stop.lon) > 180
    )
      continue;
    stops.set(stop.stop_id, {
      stopId: stop.stop_id,
      name: stop.name,
      latitude: stop.lat,
      longitude: stop.lon,
      parentStationId: stop.parent_station || null,
      accessible:
        stop.wheelchair_boarding === 1
          ? true
          : stop.wheelchair_boarding === 2
            ? false
            : null,
      services: [],
    });
  }
  for (const item of data.patternStops) {
    const stop = stops.get(item.stop_id);
    const pattern = patterns.get(item.pattern_id);
    if (
      !stop ||
      !pattern ||
      stop.services.some((service) => service.patternId === pattern.pattern_id)
    )
      continue;
    stop.services.push({
      patternId: pattern.pattern_id,
      routeId: pattern.route_id,
      directionId: pattern.direction_id === 1 ? 1 : 0,
      headsign: pattern.headsign,
    });
  }
  for (const stop of stops.values())
    stop.services.sort((a, b) => a.patternId.localeCompare(b.patternId));
  return stops;
}
