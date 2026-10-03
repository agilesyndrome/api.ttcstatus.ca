import tracks from "./physical-tracks.json";
import { nearestOnSegment, projectToLocalMetres } from "./geometry";
import type { MapSeed } from "./schematic";
import type { LatLon, XY } from "./types";

/** Versioned, attributed physical corridors missing from scheduled GTFS.
 * Apply to the Toronto network, not arbitrary geometry fixtures. Database
 * overlays with the same ID take precedence over these bundled defaults. */
export function addAuditedPhysicalTracks<T extends MapSeed>(seed: T) {
  const routeIds = new Map((seed.routes ?? []).map(r => [r.shortName ?? r.id, r.id]));
  if (!["501", "511", "512"].every(id => routeIds.has(id))) return seed;
  const paths = seed.paths.map(path => {
    if (path.gtfsSourcePoints) return path;
    let points = path.points;
    for (const track of tracks) {
      if (!track.alignmentRoutes?.some(id => path.routeIds.includes(routeIds.get(id) ?? ""))) continue;
      const override = seed.infrastructure.find(p => p.id === track.id);
      const corridor = override?.points ?? track.points.map(p => projectToLocalMetres(p as LatLon));
      const position = (point: XY) => {
        const hits = corridor.slice(1).map((p,i) => ({ ...nearestOnSegment(point, corridor[i], p), index: i }));
        return hits.sort((a,b) => a.distance-b.distance)[0];
      };
      const result: XY[] = [points[0]];
      let aligned = false;
      for (let i=1; i<points.length; i++) {
        const a = position(points[i-1]), b = position(points[i]);
        if (Math.max(a.distance,b.distance) > track.alignmentToleranceMetres!) { result.push(points[i]); continue; }
        aligned = true;
        // Preserve the order through the audited polyline, including every bend
        // hidden by a long straight GTFS chord. Do not align nearby cross streets.
        const forward = a.index+a.t <= b.index+b.t;
        const between = corridor.filter((_,j) => forward ? j>a.index+a.t && j<b.index+b.t : j>b.index+b.t && j<a.index+a.t);
        if (!forward) between.reverse();
        result[result.length-1] = a.point;
        result.push(...between,b.point);
      }
      if (aligned) points = result;
    }
    return points === path.points ? path : { ...path, gtfsSourcePoints: path.points, points };
  });
  const existing = new Set(seed.infrastructure.map(p => p.id));
  const additions = tracks.filter(track => !existing.has(track.id)).map(track => {
    const points = track.points.map(p => projectToLocalMetres(p as LatLon));
    // Only the explicitly audited endpoint connections may attach to nearby
    // scheduled corridors. This does not turn arbitrary crossings into switches.
    for (const connection of track.connections) {
      const index = connection.end === "start" ? 0 : points.length - 1;
      const routes = connection.routes.map(id => routeIds.get(id));
      let closest: { point: XY; distance: number } | undefined;
      for (const path of paths.filter(p => p.routeIds.some(id => routes.includes(id)))) {
        for (let i = 1; i < path.points.length; i++) {
          const hit = nearestOnSegment(points[index], path.points[i - 1], path.points[i]);
          if (hit.distance <= 45 && (!closest || hit.distance < closest.distance)) closest = hit;
        }
      }
      if (closest) points[index] = closest.point;
    }
    return { ...track, points };
  });
  return { ...seed, paths, infrastructure: [...seed.infrastructure, ...additions] };
}
