import type { Feature, ViewerData } from '../../../../shared/map/model';

export interface RouteItinerary {
  key: string;
  headsign: string;
  stops: { feature: Feature; sequence: number }[];
  boardingPoints: number;
  unmapped: number;
}

/** Use scheduled boarding order. Geometry and shared route IDs do not imply order. */
export function routeItineraries(data: ViewerData, routeId: string): RouteItinerary[] {
  const features = new Map<string, Feature>();
  for (const feature of data.features) {
    if (!feature.boardingPoints || !feature.routeIds.includes(routeId)) continue;
    for (const stopId of feature.stopIds ?? [])
      if (!features.has(stopId)) features.set(stopId, feature);
  }
  const itineraries = new Map<string, RouteItinerary>();
  for (const pattern of data.patterns ?? []) {
    if (pattern.routeId !== routeId || !pattern.stopIds.length) continue;
    const key = JSON.stringify([pattern.headsign, pattern.stopIds]);
    if (itineraries.has(key)) continue;
    const stops: RouteItinerary['stops'] = [];
    let unmapped = 0;
    let previous: string | undefined;
    pattern.stopIds.forEach((id, index) => {
      const feature = features.get(id);
      if (!feature) unmapped++;
      // Adjacent boarding points may share one map stop. A later loop visit stays.
      else if (feature.id !== previous) stops.push({ feature, sequence: index + 1 });
      previous = feature?.id;
    });
    itineraries.set(key, {
      key,
      headsign: pattern.headsign,
      stops,
      boardingPoints: pattern.stopIds.length,
      unmapped,
    });
  }
  return [...itineraries.values()].sort(
    (a, b) =>
      b.boardingPoints - a.boardingPoints ||
      a.headsign.localeCompare(b.headsign) ||
      a.key.localeCompare(b.key),
  );
}
