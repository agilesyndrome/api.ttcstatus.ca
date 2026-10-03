import { DISPLAY_HEIGHT, DISPLAY_WIDTH, GENERATOR_VERSION, STREET_GRID_DEGREES, TRACK_SNAP_METRES } from "./config";
import { calculateBounds, metresBetween, nearestOnSegment, projectToLocalMetres } from "./geometry";
import type { XY } from "./types";
import { selectRailService } from "./rail-service";
import { addAuditedPhysicalTracks } from "./physical-network";
import shorelineData from "./shoreline.json";
export { nearestOnSegment } from "./geometry";

export interface MapSeed {
  display: { width: number; height: number; [key: string]: unknown };
  paths: { id: string; routeIds: string[]; points: XY[]; [key: string]: unknown }[];
  infrastructure: { id: string; name: string; points: XY[]; [key: string]: unknown }[];
  stops: { id: string; name: string; x: number; y: number; routeIds: string[]; stopIds?: string[]; [key: string]: unknown }[];
  routes?: { id: string; shortName?: string; [key: string]: unknown }[];
  patterns?: { id: string; routeId: string; pathId: string; headsign: string; stopIds?: string[]; [key: string]: unknown }[];
  excludedServices?: NonNullable<MapSeed["patterns"]>;
}

export interface TrackNode { id: string; sourcePoint: XY; x: number; y: number; edgeIds: string[] }
export interface TrackEdge {
  id: string; a: string; b: string; routeIds: string[]; pathIds: string[];
  infrastructureIds: string[]; sourcePoints: XY[]; points: XY[];
  lengthMetres: number; displayLength: number;
  sourceDistances: number[];
}

/** A continuous, invertible warp: straighten Toronto's street grid and give the
 * central network more space. Apply the SAME transform to every layer. There is
 * no display-space route snapping that could create a crossing. */
export function createSchematicTransform(points: XY[]) {
  const angle = STREET_GRID_DEGREES * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const rotate = ([x, y]: XY): XY => [x * c + y * s, -x * s + y * c];
  const axis = (v: number, lo: number, hi: number, outerScale: number) =>
    v < lo ? lo + (v - lo) * outerScale : v > hi ? hi + (v - hi) * outerScale : v;
  const warp = (p: XY): XY => {
    const [x, y] = rotate(p);
    return [axis(x, -4200, 4400, 0.56), axis(y, -1600, 2400, 0.62)];
  };
  const box = calculateBounds(points.map(warp));
  const scaleX = (DISPLAY_WIDTH - 180) / Math.max(1, box.maxX - box.minX);
  const scaleY = (DISPLAY_HEIGHT - 320) / Math.max(1, box.maxY - box.minY);
  const toDisplay = (p: XY): XY => {
    const [x, y] = warp(p);
    return [+(90 + (x - box.minX) * scaleX).toFixed(2), +(150 + (box.maxY - y) * scaleY).toFixed(2)];
  };
  // The slope changes are vertices too. Keeping these when transforming a
  // segment prevents a straight display chord cutting across the warped graph.
  const segmentPoints = (a: XY, b: XY) => {
    const ra = rotate(a), rb = rotate(b), ts = [0, 1];
    for (const [dimension, knots] of [[0, [-4200, 4400]], [1, [-1600, 2400]]] as const) {
      for (const k of knots) {
        const t = (k - ra[dimension]) / (rb[dimension] - ra[dimension]);
        if (t > 0 && t < 1) ts.push(t);
      }
    }
    const fractions = [...new Set(ts)].sort((a, b) => a - b);
    return { points: fractions.map(t => toDisplay([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])),
      sourceDistances: fractions.map(t => t * metresBetween(a, b)) };
  };
  return { toDisplay, segmentPoints };
}

/** Input coordinates are canonical local metres, never already-warped pixels. */
export function layoutStreetcarMap<T extends MapSeed>(input: T) {
  const seed = addAuditedPhysicalTracks(selectRailService(input));
  const sources = [
    ...seed.paths.map(p => ({ ...p, overlay: false })),
    ...seed.infrastructure.map(p => ({ ...p, routeIds: [] as string[], overlay: true })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const allPoints = sources.flatMap(p => p.points);
  const transform = createSchematicTransform(allPoints);
  const nodes: TrackNode[] = [];
  const nodeBySource = new Map<string, TrackNode[]>();
  // Conservative source-space snapping only. Mere line crossings are never
  // made into switches: a source vertex must provide evidence of a connection.
  for (const source of sources) {
    const list: TrackNode[] = [];
    for (const point of source.points) {
      let node = nodes.find(n => metresBetween(n.sourcePoint, point) <= TRACK_SNAP_METRES);
      if (!node) {
        const [x, y] = transform.toDisplay(point);
        node = { id: `node:${nodes.length}`, sourcePoint: point, x, y, edgeIds: [] };
        nodes.push(node);
      }
      list.push(node);
    }
    nodeBySource.set(source.id, list);
  }
  const edges: TrackEdge[] = [];
  const byPair = new Map<string, TrackEdge>();
  const traversals = new Map<string, { edgeId: string; direction: 1 | -1 }[]>();
  for (const source of sources) {
    const vertices = nodeBySource.get(source.id)!;
    const traversal: { edgeId: string; direction: 1 | -1 }[] = [];
    for (let i = 1; i < vertices.length; i++) {
      const a = vertices[i - 1], b = vertices[i];
      if (a === b) continue;
      const interior = nodes.map(node => ({ node, ...nearestOnSegment(node.sourcePoint, a.sourcePoint, b.sourcePoint) }))
        .filter(p => p.node !== a && p.node !== b && p.t > 0 && p.t < 1 && p.distance <= TRACK_SNAP_METRES)
        .sort((a, b) => a.t - b.t || a.node.id.localeCompare(b.node.id));
      const chain = [a, ...interior.map(p => p.node), b];
      for (let j = 1; j < chain.length; j++) {
        const from = chain[j - 1], to = chain[j];
        const pair = [from.id, to.id].sort().join("|");
        let edge = byPair.get(pair);
        if (!edge) {
          const { points, sourceDistances } = transform.segmentPoints(from.sourcePoint, to.sourcePoint);
          edge = { id: `edge:${edges.length}`, a: from.id, b: to.id, routeIds: [], pathIds: [], infrastructureIds: [],
            sourcePoints: [from.sourcePoint, to.sourcePoint], points, sourceDistances,
            lengthMetres: metresBetween(from.sourcePoint, to.sourcePoint),
            displayLength: points.slice(1).reduce((n, p, i) => n + metresBetween(points[i], p), 0) };
          edges.push(edge); byPair.set(pair, edge);
          from.edgeIds.push(edge.id); to.edgeIds.push(edge.id);
        }
        for (const id of source.routeIds) if (!edge.routeIds.includes(id)) edge.routeIds.push(id);
        const ids = source.overlay ? edge.infrastructureIds : edge.pathIds;
        if (!ids.includes(source.id)) ids.push(source.id);
        traversal.push({ edgeId: edge.id, direction: edge.a === from.id ? 1 : -1 });
      }
    }
    traversals.set(source.id, traversal);
  }
  const byId = new Map(edges.map(e => [e.id, e]));
  const turns = new Map<string, { nodeId: string; fromEdgeId: string; toEdgeId: string; pathIds: string[] }>();
  for (const source of sources.filter(s => !s.overlay)) {
    const steps = traversals.get(source.id)!;
    for (let i = 1; i < steps.length; i++) {
      const from = steps[i - 1], to = steps[i];
      const edge = byId.get(from.edgeId)!;
      const nodeId = from.direction === 1 ? edge.b : edge.a;
      const key = `${nodeId}|${from.edgeId}|${to.edgeId}`;
      const turn = turns.get(key) ?? { nodeId, fromEdgeId: from.edgeId, toEdgeId: to.edgeId, pathIds: [] };
      if (!turn.pathIds.includes(source.id)) turn.pathIds.push(source.id);
      turns.set(key, turn);
    }
  }
  const pathPoints = (id: string) => (traversals.get(id) ?? []).flatMap((step, i) => {
    const pts = byId.get(step.edgeId)!.points;
    const ordered = step.direction === 1 ? pts : [...pts].reverse();
    return i ? ordered.slice(1) : ordered;
  });
  const stops = seed.stops.map(stop => {
    let best: { edge: TrackEdge; t: number; distance: number; point: XY } | undefined;
    const candidates = edges.filter(e => e.routeIds.some(id => stop.routeIds.includes(id)));
    for (const edge of candidates) {
      const hit = nearestOnSegment([stop.x, stop.y], edge.sourcePoints[0], edge.sourcePoints[1]);
      if (!best || hit.distance < best.distance) best = { edge, ...hit };
    }
    // Do not attach a platform to distant rail simply because it shares a route.
    const attached = best && best.distance <= 100 ? best : undefined;
    const [x, y] = transform.toDisplay(attached?.point ?? [stop.x, stop.y]);
    return { ...stop, x, y, sourcePoint: [stop.x, stop.y] as XY,
      ...(attached ? { edgeId: attached.edge.id, edgeFraction: attached.t, distanceAlongMetres: attached.t * attached.edge.lengthMetres } : {}) };
  });
  return {
    ...seed, generatorVersion: GENERATOR_VERSION,
    display: { ...seed.display, width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT, coordinateSystem: "snake-display-v1",
      streetGridRotationDegrees: STREET_GRID_DEGREES,
      note: "Toronto street grid rotated upright; outer geography compressed with a continuous warp. Display pixels are not metres." },
    paths: seed.paths.map(p => ({ ...p, sourcePoints: p.points, points: pathPoints(p.id), edgeRefs: traversals.get(p.id) })),
    infrastructure: seed.infrastructure.map(p => ({ ...p, sourcePoints: p.points, points: pathPoints(p.id), edgeRefs: traversals.get(p.id) })),
    stops,
    graph: { coordinateSystem: "local-equirectangular-metres", snapToleranceMetres: TRACK_SNAP_METRES,
      provenance: "Inferred corridor centreline graph from scheduled shapes and audited overlays; not a surveyed inventory of switches or permitted turns.",
      nodes: nodes.filter(n => n.edgeIds.length), edges, observedTurns: [...turns.values()] },
    context: buildContext(transform),
  };
}

function buildContext(transform: ReturnType<typeof createSchematicTransform>) {
  const { toDisplay } = transform;
  const origin = toDisplay([0, 0]), geographicNorth = toDisplay([0, 100]);
  const streets: [string, number, number, number][] = [
    ["St Clair", 43.681, -79.44, 0], ["College", 43.656, -79.42, 0],
    ["Carlton", 43.6621, -79.38, 0], ["Gerrard", 43.670, -79.335, 0],
    ["Dundas West", 43.651, -79.43, 0], ["Dundas East", 43.660, -79.369, 0],
    ["Queen West", 43.6465, -79.414, 0], ["Queen East", 43.664, -79.327, 0],
    ["King West", 43.6422, -79.414, 0], ["King East", 43.651, -79.366, 0],
    ["Queens Quay", 43.6382, -79.39, 0], ["The Queensway", 43.6385, -79.472, 0],
    ["Lake Shore West", 43.607, -79.516, -45], ["Kingston Rd", 43.675, -79.299, -40],
    ["Roncesvalles", 43.645, -79.4485, -90], ["Bathurst", 43.659, -79.409, -90],
    ["Spadina", 43.651, -79.397, -90], ["Broadview", 43.671, -79.357, -90],
    ["Ossington", 43.652, -79.4217, 0],
  ];
  const terminals: [string, number, number][] = [
    ["Long Branch", 43.5919323, -79.5441246], ["Humber", 43.631041, -79.478838],
    ["Dundas West", 43.6566, -79.4523], ["High Park", 43.6542, -79.456],
    ["Gunns", 43.6718954, -79.4718178], ["St Clair", 43.6882, -79.3944],
    ["Bathurst", 43.6662, -79.411], ["Spadina", 43.6678, -79.4039],
    ["Broadview", 43.6769, -79.3588], ["Main Street", 43.6891, -79.301],
    ["Neville Park", 43.6736, -79.2812], ["Bingham", 43.6815049, -79.2848082],
    ["Exhibition", 43.6352, -79.4165], ["Dufferin Gate", 43.6348, -79.4264],
    ["Union", 43.6452, -79.3807], ["Distillery", 43.6505, -79.3592],
  ];
  const shoreline = shorelineData.points.map(p => projectToLocalMetres(p as XY));
  const displayShoreline = shoreline.slice(1).flatMap((p, i) => {
    const points = transform.segmentPoints(shoreline[i], p).points;
    return i ? points.slice(1) : points;
  });
  return {
    note: "Orientation labels are approximate. Mainland shoreline uses City of Toronto geometry under the same transform as rail; context does not define track connections.",
    labels: [
      ...streets.map(([text, lat, lon, angle]) => ({ text, kind: "street", angle, point: toDisplay(projectToLocalMetres([lat, lon])) })),
      ...terminals.map(([text, lat, lon]) => ({ text, kind: "terminal", angle: 0, point: toDisplay(projectToLocalMetres([lat, lon])) })),
    ],
    shoreline: displayShoreline,
    shorelineSource: { url: shorelineData.sourceUrl, attribution: shorelineData.attribution,
      retrievedAt: shorelineData.retrievedAt, note: shorelineData.note },
    north: { angle: Math.atan2(geographicNorth[1] - origin[1], geographicNorth[0] - origin[0]) * 180 / Math.PI },
  };
}
