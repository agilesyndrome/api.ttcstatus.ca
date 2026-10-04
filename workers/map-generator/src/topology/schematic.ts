import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  GENERATOR_VERSION,
  STREET_GRID_DEGREES,
  TRACK_SNAP_METRES,
} from '../config';
import {
  metresBetween,
  nearestOnSegment,
  projectToLocalMetres,
} from '../../../../shared/map/geometry';
import type { XY } from '../types';
import { selectRailService } from '../source/rail-service';
import { addAuditedPhysicalTracks } from '../source/physical-network';
import {
  fitGeographicTransform,
  localToMap,
  transformSegment,
} from '../../../../shared/map/projection';
import shorelineData from '../source/shoreline.json';
import { CHORD_MERGE_METRES, consolidateCorridorChords } from './corridor-graph';
export { nearestOnSegment } from '../../../../shared/map/geometry';

export interface MapSeed {
  display: { width: number; height: number; [key: string]: unknown };
  paths: { id: string; routeIds: string[]; points: XY[]; [key: string]: unknown }[];
  infrastructure: { id: string; name: string; points: XY[]; [key: string]: unknown }[];
  stops: {
    id: string;
    name: string;
    x: number;
    y: number;
    routeIds: string[];
    stopIds?: string[];
    [key: string]: unknown;
  }[];
  routes?: { id: string; shortName?: string; [key: string]: unknown }[];
  patterns?: {
    id: string;
    routeId: string;
    pathId: string;
    headsign: string;
    stopIds?: string[];
    [key: string]: unknown;
  }[];
  excludedServices?: NonNullable<MapSeed['patterns']>;
}

export interface TrackNode {
  id: string;
  sourcePoint: XY;
  x: number;
  y: number;
  edgeIds: string[];
}
export interface TrackEdge {
  id: string;
  a: string;
  b: string;
  routeIds: string[];
  pathIds: string[];
  infrastructureIds: string[];
  sourcePoints: XY[];
  points: XY[];
  lengthMetres: number;
  displayLength: number;
  sourceDistances: number[];
}

/** A continuous, invertible warp: straighten Toronto's street grid and give the
 * central network more space. Apply the SAME transform to every layer. There is
 * no display-space route snapping that could create a crossing. */
export function createSchematicTransform(points: XY[]) {
  const geographicTransform = fitGeographicTransform(
    points,
    DISPLAY_WIDTH,
    DISPLAY_HEIGHT,
    STREET_GRID_DEGREES,
  );
  return {
    geographicTransform,
    toDisplay: (point: XY) => localToMap(point, geographicTransform),
    segmentPoints: (a: XY, b: XY) => transformSegment(a, b, geographicTransform),
  };
}

/** Input coordinates are canonical local metres, never already-warped pixels. */
export function layoutStreetcarMap<T extends MapSeed>(input: T) {
  const seed = addAuditedPhysicalTracks(selectRailService(input));
  const sources = [
    ...seed.paths.map((p) => ({ ...p, overlay: false })),
    ...seed.infrastructure.map((p) => ({
      ...p,
      routeIds: [] as string[],
      overlay: true,
    })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const allPoints = sources.flatMap((p) => p.points);
  const transform = createSchematicTransform(allPoints);
  const nodes: TrackNode[] = [];
  const nodeBySource = new Map<string, TrackNode[]>();
  // Rapid-transit lines cross each other and surface rail at different grades.
  const rapidIds = new Set(
    (seed.routes ?? [])
      .filter((r) => /^(1|2|4|5|6)$/.test(r.shortName ?? r.id))
      .map((r) => r.id),
  );
  const layer = (source: { routeIds: string[] }) =>
    source.routeIds
      .filter((id) => rapidIds.has(id))
      .sort()
      .join('|') || 'surface';
  const nodeLayers = new Map<string, string>();
  // Conservative source-space snapping only. Mere line crossings are never
  // made into switches: a source vertex must provide evidence of a connection.
  for (const source of sources) {
    const list: TrackNode[] = [];
    for (const point of source.points) {
      let node = nodes.find(
        (n) =>
          nodeLayers.get(n.id) === layer(source) &&
          metresBetween(n.sourcePoint, point) <= TRACK_SNAP_METRES,
      );
      if (!node) {
        const [x, y] = transform.toDisplay(point);
        node = { id: `node:${nodes.length}`, sourcePoint: point, x, y, edgeIds: [] };
        nodes.push(node);
        nodeLayers.set(node.id, layer(source));
      }
      list.push(node);
    }
    nodeBySource.set(source.id, list);
  }
  let edges: TrackEdge[] = [];
  const byPair = new Map<string, TrackEdge>();
  const traversals = new Map<string, { edgeId: string; direction: 1 | -1 }[]>();
  for (const source of sources) {
    const vertices = nodeBySource.get(source.id)!;
    const traversal: { edgeId: string; direction: 1 | -1 }[] = [];
    for (let i = 1; i < vertices.length; i++) {
      const a = vertices[i - 1],
        b = vertices[i];
      if (a === b) continue;
      const interior = nodes
        .map((node) => ({
          node,
          ...nearestOnSegment(node.sourcePoint, a.sourcePoint, b.sourcePoint),
        }))
        .filter(
          (p) =>
            nodeLayers.get(p.node.id) === layer(source) &&
            p.node !== a &&
            p.node !== b &&
            p.t > 0 &&
            p.t < 1 &&
            p.distance <= TRACK_SNAP_METRES,
        )
        .sort((a, b) => a.t - b.t || a.node.id.localeCompare(b.node.id));
      const chain = [a, ...interior.map((p) => p.node), b];
      for (let j = 1; j < chain.length; j++) {
        const from = chain[j - 1],
          to = chain[j];
        const pair = [from.id, to.id].sort().join('|');
        let edge = byPair.get(pair);
        if (!edge) {
          const { points, sourceDistances } = transform.segmentPoints(
            from.sourcePoint,
            to.sourcePoint,
          );
          edge = {
            id: `edge:${edges.length}`,
            a: from.id,
            b: to.id,
            routeIds: [],
            pathIds: [],
            infrastructureIds: [],
            sourcePoints: [from.sourcePoint, to.sourcePoint],
            points,
            sourceDistances,
            lengthMetres: metresBetween(from.sourcePoint, to.sourcePoint),
            displayLength: points
              .slice(1)
              .reduce((n, p, i) => n + metresBetween(points[i], p), 0),
          };
          edges.push(edge);
          byPair.set(pair, edge);
          from.edgeIds.push(edge.id);
          to.edgeIds.push(edge.id);
        }
        for (const id of source.routeIds)
          if (!edge.routeIds.includes(id)) edge.routeIds.push(id);
        const ids = source.overlay ? edge.infrastructureIds : edge.pathIds;
        if (!ids.includes(source.id)) ids.push(source.id);
        traversal.push({ edgeId: edge.id, direction: edge.a === from.id ? 1 : -1 });
      }
    }
    traversals.set(source.id, traversal);
  }
  edges = consolidateCorridorChords(edges, nodes, traversals);
  const byId = new Map(edges.map((e) => [e.id, e]));
  const turns = new Map<
    string,
    { nodeId: string; fromEdgeId: string; toEdgeId: string; pathIds: string[] }
  >();
  for (const source of sources.filter((s) => !s.overlay)) {
    const steps = traversals.get(source.id)!;
    for (let i = 1; i < steps.length; i++) {
      const from = steps[i - 1],
        to = steps[i];
      const edge = byId.get(from.edgeId)!;
      const nodeId = from.direction === 1 ? edge.b : edge.a;
      const key = `${nodeId}|${from.edgeId}|${to.edgeId}`;
      const turn = turns.get(key) ?? {
        nodeId,
        fromEdgeId: from.edgeId,
        toEdgeId: to.edgeId,
        pathIds: [],
      };
      if (!turn.pathIds.includes(source.id)) turn.pathIds.push(source.id);
      turns.set(key, turn);
    }
  }
  const pathPoints = (id: string) =>
    (traversals.get(id) ?? []).flatMap((step, i) => {
      const pts = byId.get(step.edgeId)!.points;
      const ordered = step.direction === 1 ? pts : [...pts].reverse();
      return i ? ordered.slice(1) : ordered;
    });
  const stops = seed.stops.map((stop) => {
    let best: { edge: TrackEdge; t: number; distance: number; point: XY } | undefined;
    const candidates = edges.filter((e) =>
      e.routeIds.some((id) => stop.routeIds.includes(id)),
    );
    for (const edge of candidates) {
      const hit = nearestOnSegment(
        [stop.x, stop.y],
        edge.sourcePoints[0],
        edge.sourcePoints[1],
      );
      if (!best || hit.distance < best.distance) best = { edge, ...hit };
    }
    // Do not attach a platform to distant rail simply because it shares a route.
    const attached = best && best.distance <= 100 ? best : undefined;
    const [x, y] = transform.toDisplay(attached?.point ?? [stop.x, stop.y]);
    return {
      ...stop,
      x,
      y,
      sourcePoint: [stop.x, stop.y] as XY,
      ...(attached
        ? {
            edgeId: attached.edge.id,
            edgeFraction: attached.t,
            distanceAlongMetres: attached.t * attached.edge.lengthMetres,
          }
        : {}),
    };
  });
  return {
    ...seed,
    generatorVersion: GENERATOR_VERSION,
    display: {
      ...seed.display,
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      coordinateSystem: 'snake-display-v1',
      streetGridRotationDegrees: STREET_GRID_DEGREES,
      geographicTransform: transform.geographicTransform,
      note: 'Toronto street grid rotated upright; outer geography compressed with a continuous warp. Display pixels are not metres.',
    },
    paths: seed.paths.map((p) => ({
      ...p,
      sourcePoints: p.points,
      points: pathPoints(p.id),
      edgeRefs: traversals.get(p.id),
    })),
    infrastructure: seed.infrastructure.map((p) => ({
      ...p,
      sourcePoints: p.points,
      points: pathPoints(p.id),
      edgeRefs: traversals.get(p.id),
    })),
    stops,
    graph: {
      coordinateSystem: 'local-equirectangular-metres',
      snapToleranceMetres: TRACK_SNAP_METRES,
      chordMergeToleranceMetres: CHORD_MERGE_METRES,
      provenance:
        'Inferred corridor centreline graph from scheduled shapes and audited overlays; not a surveyed inventory of switches or permitted turns.',
      nodes: nodes.filter((n) => n.edgeIds.length),
      edges,
      observedTurns: [...turns.values()],
    },
    context: buildContext(transform),
  };
}

function buildContext(transform: ReturnType<typeof createSchematicTransform>) {
  const { toDisplay } = transform;
  const origin = toDisplay([0, 0]),
    geographicNorth = toDisplay([0, 100]);
  const streets: [string, number, number, number][] = [
    ['St Clair', 43.681, -79.44, 0],
    ['College', 43.656, -79.42, 0],
    ['Carlton', 43.6621, -79.38, 0],
    ['Gerrard', 43.67, -79.335, 0],
    ['Dundas West', 43.651, -79.43, 0],
    ['Dundas East', 43.66, -79.369, 0],
    ['Queen West', 43.6465, -79.414, 0],
    ['Queen East', 43.664, -79.327, 0],
    ['King West', 43.6422, -79.414, 0],
    ['King East', 43.651, -79.366, 0],
    ['Queens Quay', 43.6382, -79.39, 0],
    ['The Queensway', 43.6385, -79.472, 0],
    ['Lake Shore West', 43.607, -79.516, -45],
    ['Kingston Rd', 43.675, -79.299, -40],
    ['Roncesvalles', 43.645, -79.4485, -90],
    ['Bathurst', 43.659, -79.409, -90],
    ['Spadina', 43.651, -79.397, -90],
    ['Broadview', 43.671, -79.357, -90],
    ['Ossington', 43.652, -79.4217, 0],
  ];
  const terminals: [string, number, number][] = [
    ['Long Branch', 43.5919323, -79.5441246],
    ['Humber', 43.631041, -79.478838],
    ['Dundas West', 43.6566, -79.4523],
    ['High Park', 43.6542, -79.456],
    ['Gunns', 43.6718954, -79.4718178],
    ['St Clair', 43.6882, -79.3944],
    ['Bathurst', 43.6662, -79.411],
    ['Spadina', 43.6678, -79.4039],
    ['Broadview', 43.6769, -79.3588],
    ['Main Street', 43.6891, -79.301],
    ['Neville Park', 43.6736, -79.2812],
    ['Bingham', 43.6815049, -79.2848082],
    ['Exhibition', 43.6352, -79.4165],
    ['Dufferin Gate', 43.6348, -79.4264],
    ['Union', 43.6452, -79.3807],
    ['Distillery', 43.6505, -79.3592],
  ];
  const shoreline = shorelineData.points.map((p) => projectToLocalMetres(p as XY));
  const displayShoreline = shoreline.slice(1).flatMap((p, i) => {
    const points = transform.segmentPoints(shoreline[i], p).points;
    return i ? points.slice(1) : points;
  });
  return {
    note: 'Orientation labels are approximate. Mainland shoreline uses City of Toronto geometry under the same transform as rail; context does not define track connections.',
    labels: [
      ...streets.map(([text, lat, lon, angle]) => ({
        text,
        kind: 'street',
        angle,
        point: toDisplay(projectToLocalMetres([lat, lon])),
      })),
      ...terminals.map(([text, lat, lon]) => ({
        text,
        kind: 'terminal',
        angle: 0,
        point: toDisplay(projectToLocalMetres([lat, lon])),
      })),
    ],
    shoreline: displayShoreline,
    shorelineSource: {
      url: shorelineData.sourceUrl,
      attribution: shorelineData.attribution,
      retrievedAt: shorelineData.retrievedAt,
      note: shorelineData.note,
    },
    north: {
      angle:
        (Math.atan2(geographicNorth[1] - origin[1], geographicNorth[0] - origin[0]) *
          180) /
        Math.PI,
    },
  };
}
