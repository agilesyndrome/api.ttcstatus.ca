import type { MapSeed } from "./schematic";

/** A streetcar route ID can also carry explicitly named replacement-bus trips.
 * Those shapes are service data, but are not evidence of physical rail. */
export function selectRailService<T extends MapSeed>(seed: T) {
  const excluded = (seed.patterns ?? []).filter(p => /\b(?:replacement\s+bus|shuttle\s+bus)\b/i.test(p.headsign));
  if (!excluded.length) return { ...seed, excludedServices: seed.excludedServices ?? [] };
  const excludedIds = new Set(excluded.map(p => p.id));
  const patterns = seed.patterns!.filter(p => !excludedIds.has(p.id));
  const byPath = new Map<string, typeof patterns>();
  const routesByStop = new Map<string, Set<string>>();
  for (const pattern of patterns) {
    const list = byPath.get(pattern.pathId) ?? [];
    list.push(pattern); byPath.set(pattern.pathId, list);
    for (const id of pattern.stopIds ?? []) {
      const routes = routesByStop.get(id) ?? new Set<string>();
      routes.add(pattern.routeId); routesByStop.set(id, routes);
    }
  }
  const knownPaths = new Set(seed.patterns!.map(p => p.pathId));
  const paths = seed.paths.filter(p => !knownPaths.has(p.id) || byPath.has(p.id)).map(p => {
    const members = byPath.get(p.id);
    return members ? { ...p, routeIds: [...new Set(members.map(m => m.routeId))], patternIds: members.map(m => m.id) } : p;
  });
  const stops = seed.stops.flatMap(stop => {
    if (!stop.stopIds) return [stop];
    const routeIds = [...new Set(stop.stopIds.flatMap(id => [...(routesByStop.get(id) ?? [])]))].sort();
    return routeIds.length ? [{ ...stop, routeIds }] : [];
  });
  return { ...seed, paths, patterns, stops, excludedServices: [...(seed.excludedServices ?? []), ...excluded] };
}
