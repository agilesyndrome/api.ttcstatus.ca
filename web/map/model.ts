import { PALETTE } from "../../workers/map-generator/src/debug-render";
import type { GeographicTransform, ProjectionEdge } from "../../workers/shared/map-projection";

export type Point = [number, number];
export interface Route { id: string; number: string; name: string; color: string; overnight: boolean; scheduled: boolean }
export interface Feature {
  id: string; name: string; kind: "stop" | "terminal"; point: Point;
  routeIds: string[]; accessible: boolean | null; boardingPoints: number;
  platformNames: string[]; destinations: Record<string, string[]>; replacementRouteIds: string[];
}
export interface Edge extends ProjectionEdge { infrastructureIds: string[] }
export interface ViewerData {
  features: Feature[]; routes: Route[]; edges: Edge[];
  infrastructure: { id: string; name: string }[];
  shoreline: Point[]; labels: { text: string; kind: string; angle: number; point: Point }[];
  northAngle: number; snapshot: string; bounds: Bounds;
  geographicTransform: GeographicTransform;
}
export interface Bounds { x: number; y: number; width: number; height: number }
interface SourceStop { id: string; name: string; x: number; y: number; routeIds: string[]; stopIds: string[]; accessible?: boolean }
export interface ViewerSource {
  display: { geographicTransform: GeographicTransform };
  generatedAt?: string; source?: { fetchedAt?: string };
  routes: { id: string; shortName?: string; longName?: string; color?: string }[];
  stops: SourceStop[];
  patterns: { routeId: string; stopIds: string[]; headsign: string }[];
  excludedServices?: { routeId: string }[];
  graph: { edges: Edge[] };
  infrastructure: { id: string; name: string }[];
  context: { shoreline: Point[]; labels: ViewerData["labels"]; north: { angle: number } };
}

const distance = (a: Point, b: Point) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const unique = <T>(values: T[]) => [...new Set(values)];
export function boundsOf(points: Point[], padding = 35): Bounds {
  if (!points.length) throw new Error("Map has no points to display");
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x = Math.min(...xs)-padding, y = Math.min(...ys)-padding;
  return { x, y, width: Math.max(...xs)-x+padding, height: Math.max(...ys)-y+padding };
}

/** Keep the static page small and give terminals the union of their actual
 * nearby boarding records. Physical loops without records do not gain service. */
export function buildViewerData(source: ViewerSource): ViewerData {
  if (!source.graph?.edges.length || !source.context) throw new Error("Viewer requires a generated schematic with a graph and geographic context");
  const scheduled = new Set(source.graph.edges.flatMap(e => e.routeIds));
  const routes = source.routes.map(r => {
    const number = r.shortName ?? r.id, overnight = /^3\d\d$/.test(number);
    const displayNumber = overnight ? String(Number(number)+200) : number;
    return { id: r.id, number, name: r.longName ?? "", overnight, scheduled: scheduled.has(r.id),
      color: PALETTE[displayNumber] ?? (/^#[a-f0-9]{6}$/i.test(r.color ?? "") ? r.color! : "#477cb1") };
  });
  const patternsByStop = new Map<string, typeof source.patterns>();
  for (const pattern of source.patterns) for (const id of pattern.stopIds) {
    const list = patternsByStop.get(id) ?? []; list.push(pattern); patternsByStop.set(id,list);
  }
  const makeFeature = (id: string, name: string, kind: Feature["kind"], point: Point, stops: SourceStop[]): Feature => {
    const routeIds = unique(stops.flatMap(s => s.routeIds)).sort();
    const stopIds = unique(stops.flatMap(s => s.stopIds));
    const destinations: Feature["destinations"] = {};
    for (const stopId of stopIds) for (const pattern of patternsByStop.get(stopId) ?? []) {
      if (routeIds.includes(pattern.routeId)) destinations[pattern.routeId] = unique([...(destinations[pattern.routeId] ?? []),pattern.headsign]);
    }
    return { id,name,kind,point,routeIds, boardingPoints: stopIds.length,
      accessible: stops.some(s => s.accessible) ? true : null,
      platformNames: unique(stops.map(s => s.name)), destinations, replacementRouteIds: [] };
  };
  const terminals: Feature[] = [], grouped = new Set<string>();
  const replacementIds = new Set((source.excludedServices ?? []).map(p => p.routeId));
  const physicalRouteNumbers: Record<string,string> = { "Long Branch": "507", "Bingham": "503", "Gunns": "512" };
  for (const label of source.context.labels.filter(l => l.kind === "terminal")) {
    const candidates = source.stops.filter(s => s.name.toLowerCase().includes(label.text.toLowerCase()) && /loop|station/i.test(s.name))
      .sort((a,b) => distance([a.x,a.y],label.point)-distance([b.x,b.y],label.point));
    const nearest = candidates.find(s => distance([s.x,s.y],label.point)<65);
    const point: Point = nearest ? [nearest.x,nearest.y] : label.point;
    const members = nearest ? candidates.filter(s => distance([s.x,s.y],point)<16) : [];
    members.forEach(s => grouped.add(s.id));
    const terminal = makeFeature(`terminal:${label.text}`,label.text,"terminal",point,members);
    const replacement = routes.find(r => r.number === physicalRouteNumbers[label.text] && replacementIds.has(r.id));
    if (!members.length && replacement) terminal.replacementRouteIds = [replacement.id];
    terminals.push(terminal);
  }
  const features = [
    ...source.stops.filter(s => !grouped.has(s.id)).map(s => makeFeature(s.id,s.name,"stop",[s.x,s.y],[s])),
    ...terminals,
  ];
  const edges = source.graph.edges.map(e => ({ id:e.id, points:e.points, routeIds:e.routeIds,
    a:e.a, b:e.b, sourcePoints:e.sourcePoints, sourceDistances:e.sourceDistances,
    infrastructureIds:e.infrastructureIds, lengthMetres:e.lengthMetres }));
  if (!source.display?.geographicTransform) throw new Error("Rebuild the map with map:preview to include its geographic transform");
  return { features, routes, edges, infrastructure:source.infrastructure.map(i => ({id:i.id,name:i.name})),
    shoreline:source.context.shoreline, labels:source.context.labels.filter(l => l.kind !== "terminal"),
    northAngle:source.context.north.angle, snapshot:source.source?.fetchedAt ?? source.generatedAt ?? "",
    bounds:boundsOf([...edges.flatMap(e => e.points),...features.map(f => f.point)],45),
    geographicTransform:source.display.geographicTransform };
}

export function searchFeatures(features: Feature[], routes: Route[], query: string): Feature[] {
  const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
  const needle = normal(query);
  if (!needle) return [];
  const matchingRoutes = new Set(routes.filter(r => normal(`${r.number} ${r.name}`).includes(needle)).map(r => r.id));
  return features.filter(f => normal(f.name).includes(needle) || f.routeIds.some(id => matchingRoutes.has(id)))
    .sort((a,b) => Number(b.kind === "terminal")-Number(a.kind === "terminal") || a.name.localeCompare(b.name)).slice(0,12);
}
