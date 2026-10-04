import { mapToGps } from '../../workers/shared/map-projection';
import type { Feature, Route, ViewerData } from '../map/model';
import { distanceMetres } from './commute';

export interface StopConnection { route: Route; headsigns: string[]; minimumStopsBetween: number; maximumStopsBetween: number }
/** Ordered boarding IDs establish a forward scheduled pattern. Shared route
 * IDs or a connected physical rail graph alone cannot establish a ride. */
export function compareStops(data: ViewerData, from: Feature, to: Feature, includeOvernight = false) {
  const metres = distanceMetres(mapToGps(from.point, data.geographicTransform), mapToGps(to.point, data.geographicTransform));
  const available = Boolean(data.patterns?.length && from.stopIds?.length && to.stopIds?.length);
  const connections = new Map<string, StopConnection>();
  if (from.id !== to.id && available) {
    const starts = new Set(from.stopIds), ends = new Set(to.stopIds);
    for (const pattern of data.patterns ?? []) {
      const route = data.routes.find(route => route.id === pattern.routeId && route.scheduled && (includeOvernight || !route.overnight));
      if (!route) continue;
      let lastStart = -1, shortest = Infinity;
      for (let index = 0; index < pattern.stopIds.length; index++) {
        const stopId = pattern.stopIds[index];
        if (ends.has(stopId) && lastStart >= 0) shortest = Math.min(shortest, index - lastStart - 1);
        if (starts.has(stopId)) lastStart = index;
      }
      if (!Number.isFinite(shortest)) continue;
      const previous = connections.get(route.id);
      if (previous) {
        previous.minimumStopsBetween = Math.min(previous.minimumStopsBetween, shortest);
        previous.maximumStopsBetween = Math.max(previous.maximumStopsBetween, shortest);
        if (pattern.headsign && !previous.headsigns.includes(pattern.headsign)) previous.headsigns.push(pattern.headsign);
      } else connections.set(route.id, { route, headsigns: pattern.headsign ? [pattern.headsign] : [], minimumStopsBetween: shortest, maximumStopsBetween: shortest });
    }
  }
  return { metres, available, sameStop: from.id === to.id, connections: [...connections.values()].sort((a, b) => a.route.number.localeCompare(b.route.number, undefined, { numeric: true })) };
}
