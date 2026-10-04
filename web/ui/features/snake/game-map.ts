import type { Edge, EdgeRef, Point, ViewerData } from '../../../../shared/map/model';
import { boundsOf } from '../../../../shared/map/model';
import {
  localToMap,
  mapToGps,
  pointAlongEdge,
  matchGpsToTrack,
} from '../../../../shared/map/projection';
import type { PlottedVehicle } from '../../../../shared/map/live-status';

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rapid = (number: string) => /^(1|2|4|5|6)$/.test(number);
const unique = <T>(items: T[]) => [...new Set(items)];
function sourcePoint(point: Point, data: ViewerData): Point {
  const gps = mapToGps(point, data.geographicTransform),
    p = data.geographicTransform.projection;
  return [
    (gps.longitude - p.longitude) * p.metresPerLongitudeDegree,
    (gps.latitude - p.latitude) * p.metresPerLatitudeDegree,
  ];
}
function geometry(edge: Edge, sourcePoints: Point[], data: ViewerData): Edge {
  const clean = sourcePoints.filter(
    (p, i) => !i || distance(p, sourcePoints[i - 1]) > 0.001,
  );
  const sourceDistances = [0];
  for (let i = 1; i < clean.length; i++)
    sourceDistances.push(sourceDistances.at(-1)! + distance(clean[i - 1], clean[i]));
  const points = clean.map((point) => localToMap(point, data.geographicTransform));
  const lengthMetres = sourceDistances.at(-1)!;
  return { ...edge, sourcePoints: clean, points, sourceDistances, lengthMetres };
}
function nearest(point: Point, edges: Edge[]) {
  let best:
    | { edge: Edge; metres: number; gap: number; point: Point; segment: number }
    | undefined;
  for (const edge of edges) {
    let metres = 0;
    for (let i = 1; i < edge.sourcePoints.length; i++) {
      const a = edge.sourcePoints[i - 1],
        b = edge.sourcePoints[i],
        length = distance(a, b);
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) /
            (length * length || 1),
        ),
      );
      const projected: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const gap = distance(point, projected);
      if (!best || gap < best.gap)
        best = { edge, metres: metres + t * length, gap, point: projected, segment: i };
      metres += length;
    }
  }
  return best;
}

export interface SnakeMap {
  data: ViewerData;
  collapsedEdges: number;
  transfers: { name: string; nodeId: string }[];
}

/** A private, deterministic game projection. Never mutate the explorer bundle.
 * Only already-connected short approaches are contracted: crossings do not
 * become switches. Larger city loops and the Toronto street backbone survive. */
export function buildSnakeMap(input: ViewerData): SnakeMap {
  const data = structuredClone(input);
  // Some decorative terminal labels are approximate. Prefer the actual named
  // boarding record before simplifying its loop (not a nearby unrelated rail).
  for (const terminal of data.features.filter((f) => f.kind === 'terminal')) {
    const named = data.features.filter(
      (f) =>
        f.kind === 'stop' &&
        f.name.toLowerCase().includes(terminal.name.toLowerCase()) &&
        /loop|station/i.test(f.name),
    );
    if (named.length) {
      const nearest = named.sort(
        (a, b) => distance(a.point, terminal.point) - distance(b.point, terminal.point),
      )[0];
      terminal.point = [...nearest.point];
      terminal.routeIds = unique([...terminal.routeIds, ...nearest.routeIds]);
    }
  }

  const rapidIds = new Set(data.routes.filter((r) => rapid(r.number)).map((r) => r.id));
  const isRapid = (edge: Edge) => edge.routeIds.some((id) => rapidIds.has(id));
  const nodes = new Map<string, Point>();
  const adjacency = new Map<string, Edge[]>();
  for (const edge of data.edges) {
    nodes.set(edge.a, edge.sourcePoints[0]);
    nodes.set(edge.b, edge.sourcePoints.at(-1)!);
    for (const id of unique([edge.a, edge.b]))
      adjacency.set(id, [...(adjacency.get(id) ?? []), edge]);
  }
  const parent = new Map([...nodes.keys()].map((id) => [id, id]));
  const root = (id: string): string => {
    const next = parent.get(id)!;
    if (next === id) return id;
    const result = root(next);
    parent.set(id, result);
    return result;
  };
  const members = new Map([...nodes.keys()].map((id) => [id, [id]]));
  const join = (a: string, b: string, diameter: number) => {
    a = root(a);
    b = root(b);
    if (a === b) return;
    const group = [...members.get(a)!, ...members.get(b)!];
    if (
      group.some((x) =>
        group.some((y) => distance(nodes.get(x)!, nodes.get(y)!) > diameter),
      )
    )
      return;
    parent.set(b, a);
    members.set(a, group);
    members.delete(b);
  };
  // Terminal loops become a single easy arrival/automatic turnback. Walk the
  // connected approach only; a subway beneath it is never swallowed.
  for (const terminal of data.features.filter((f) => f.kind === 'terminal')) {
    const point = sourcePoint(terminal.point, data);
    const start = nearest(
      point,
      data.edges.filter((e) => !isRapid(e)),
    );
    if (!start || start.gap > 180) continue;
    const candidates = data.edges.filter(
      (e) => !isRapid(e) && e.sourcePoints.every((p) => distance(p, point) <= 180),
    );
    const allowed = new Set(candidates.map((e) => e.id));
    const pending = [
      distance(nodes.get(start.edge.a)!, point) <
      distance(nodes.get(start.edge.b)!, point)
        ? start.edge.a
        : start.edge.b,
    ];
    const seen = new Set<string>();
    while (pending.length) {
      const node = pending.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const edge of adjacency.get(node) ?? [])
        if (allowed.has(edge.id)) {
          join(edge.a, edge.b, 300);
          pending.push(edge.a, edge.b);
        }
    }
  }
  // Remove tiny multi-stage junction decisions, not an entire short branch.
  for (const edge of data.edges.slice().sort((a, b) => a.lengthMetres - b.lengthMetres)) {
    if (
      !isRapid(edge) &&
      edge.lengthMetres < 85 &&
      edge.a !== edge.b &&
      (adjacency.get(edge.a)?.length ?? 0) > 1 &&
      (adjacency.get(edge.b)?.length ?? 0) > 1
    )
      join(edge.a, edge.b, 120);
  }
  const centres = new Map(
    [...members].map(([id, group]) => [
      id,
      [
        group.reduce((sum, node) => sum + nodes.get(node)![0], 0) / group.length,
        group.reduce((sum, node) => sum + nodes.get(node)![1], 0) / group.length,
      ] as Point,
    ]),
  );
  const removed = new Set<string>();
  data.edges = data.edges.flatMap((edge) => {
    const a = root(edge.a),
      b = root(edge.b);
    // Keep real large loops even when their endpoints share a junction.
    if (
      !isRapid(edge) &&
      a === b &&
      data.edges.some((other) => (root(other.a) === a) !== (root(other.b) === a)) &&
      edge.sourcePoints.every((p) => distance(p, centres.get(a)!) < 220)
    ) {
      removed.add(edge.id);
      return [];
    }
    if (
      a === edge.a &&
      b === edge.b &&
      members.get(a)?.length === 1 &&
      members.get(b)?.length === 1
    )
      return [edge];
    const interior = edge.sourcePoints
      .slice(1, -1)
      .filter(
        (p) =>
          (members.get(a)!.length === 1 || distance(p, centres.get(a)!) > 55) &&
          (members.get(b)!.length === 1 || distance(p, centres.get(b)!) > 55),
      );
    const changed = geometry(
      { ...edge, a, b },
      [centres.get(a)!, ...interior, centres.get(b)!],
      data,
    );
    if (changed.lengthMetres <= 0.1) {
      removed.add(edge.id);
      return [];
    }
    return [changed];
  });
  data.paths = data.paths?.map((path) => ({
    ...path,
    edgeRefs: path.edgeRefs.filter((ref) => !removed.has(ref.edgeId)),
  }));

  const transfers: SnakeMap['transfers'] = [];
  // Split existing edges at stations so the fake interchange works in either
  // direction, and expand every mission reference in its original order.
  function split(hit: NonNullable<ReturnType<typeof nearest>>) {
    const { edge, metres, point } = hit;
    if (metres < 20) return { node: edge.a, point: edge.sourcePoints[0] };
    if (edge.lengthMetres - metres < 20)
      return { node: edge.b, point: edge.sourcePoints.at(-1)! };
    // A station can be encountered more than once while the transfer hubs are
    // assembled. If the nearest projection is already at a vertex, reuse that
    // vertex instead of manufacturing a zero-length split edge.
    let segment = 1;
    let travelled = 0;
    while (segment < edge.sourcePoints.length - 1) {
      const next =
        travelled + distance(edge.sourcePoints[segment - 1], edge.sourcePoints[segment]);
      if (metres <= next) break;
      travelled = next;
      segment++;
    }
    if (distance(point, edge.sourcePoints[segment - 1]) < 1)
      return { node: edge.a, point: edge.sourcePoints[0] };
    if (distance(point, edge.sourcePoints[segment]) < 1)
      return { node: edge.b, point: edge.sourcePoints.at(-1)! };
    const node = `snake:station:${edge.id}:${Math.round(metres)}`;
    const first = geometry(
      { ...edge, id: `${node}:a`, b: node },
      [...edge.sourcePoints.slice(0, segment), point],
      data,
    );
    const second = geometry(
      { ...edge, id: `${node}:b`, a: node },
      [point, ...edge.sourcePoints.slice(segment)],
      data,
    );
    if (first.sourcePoints.length < 2 || second.sourcePoints.length < 2)
      return { node: edge.a, point: edge.sourcePoints[0] };
    data.edges = data.edges.flatMap((e) => (e.id === edge.id ? [first, second] : [e]));
    data.paths = data.paths?.map((path) => ({
      ...path,
      edgeRefs: path.edgeRefs.flatMap((ref): EdgeRef[] =>
        ref.edgeId !== edge.id
          ? [ref]
          : ref.direction === 1
            ? [
                { edgeId: first.id, direction: 1 },
                { edgeId: second.id, direction: 1 },
              ]
            : [
                { edgeId: second.id, direction: -1 },
                { edgeId: first.id, direction: -1 },
              ],
      ),
    }));
    return { node, point };
  }
  const stations = data.features.filter((f) => f.routeIds.some((id) => rapidIds.has(id)));
  for (const station of stations) {
    const point = sourcePoint(station.point, data);
    const nearby = data.features.filter(
      (f) => distance(point, sourcePoint(f.point, data)) <= 180,
    );
    const routes = unique([...station.routeIds, ...nearby.flatMap((f) => f.routeIds)]);
    const anchors: { node: string; point: Point }[] = [];
    for (const route of routes) {
      const hit = nearest(
        point,
        data.edges.filter(
          (e) => e.routeIds.includes(route) && !e.id.startsWith('snake:transfer:'),
        ),
      );
      if (hit && hit.gap <= 180) anchors.push(split(hit));
    }
    const hub = anchors[0];
    if (!hub) continue;
    const joined = new Set(anchors.map((anchor) => anchor.node));
    if (joined.size < 2) continue;
    // One decision selects either direction of the destination line. A short
    // connector followed by another fork would be impossible to steer at speed.
    data.edges = data.edges.map((edge) => {
      if (!joined.has(edge.a) && !joined.has(edge.b)) return edge;
      const points = edge.sourcePoints.slice();
      if (joined.has(edge.a)) points[0] = hub.point;
      if (joined.has(edge.b)) points[points.length - 1] = hub.point;
      return geometry(
        {
          ...edge,
          a: joined.has(edge.a) ? hub.node : edge.a,
          b: joined.has(edge.b) ? hub.node : edge.b,
        },
        points,
        data,
      );
    });
    transfers.push({ name: station.name, nodeId: hub.node });
  }
  const invalid = new Set(
    data.edges
      .filter((edge) => edge.lengthMetres <= 0.1 || edge.sourcePoints.length < 2)
      .map((edge) => edge.id),
  );
  if (invalid.size) {
    data.edges = data.edges.filter((edge) => !invalid.has(edge.id));
    data.paths = data.paths?.map((path) => ({
      ...path,
      edgeRefs: path.edgeRefs.filter((ref) => !invalid.has(ref.edgeId)),
    }));
  }
  // Reattach ALL stations, including grouped terminal records, to the game
  // geometry. Keep names, boarding IDs and service metadata from Toronto.
  data.features = data.features.map((feature) => {
    const point = sourcePoint(feature.point, data);
    const matching = data.edges.filter((e) =>
      feature.routeIds.some((id) => e.routeIds.includes(id)),
    );
    const hit = nearest(
      point,
      matching.length
        ? matching
        : data.edges.filter((e) => !e.id.startsWith('snake:transfer:')),
    );
    if (!hit) return feature;
    if (feature.kind === 'terminal') {
      const endpoints = (matching.length ? matching : data.edges)
        .flatMap((edge) => [
          { edge, metres: 0, point: edge.sourcePoints[0] },
          { edge, metres: edge.lengthMetres, point: edge.sourcePoints.at(-1)! },
        ])
        .sort((a, b) => distance(point, a.point) - distance(point, b.point));
      const end = endpoints[0];
      if (end && distance(point, end.point) < 350)
        return {
          ...feature,
          edgeId: end.edge.id,
          distanceAlongMetres: end.metres,
          point: pointAlongEdge(end.edge, end.metres).point,
        };
    }
    return {
      ...feature,
      edgeId: hit.edge.id,
      distanceAlongMetres: hit.metres,
      point: pointAlongEdge(hit.edge, hit.metres).point,
    };
  });
  data.bounds = boundsOf(
    [...data.edges.flatMap((e) => e.points), ...data.features.map((f) => f.point)],
    45,
  );
  return { data, collapsedEdges: removed.size, transfers };
}

/** Only already-matched reports can become pickups; feed ownership stays with
 * the explorer. Use each route's game geometry and retain identity/staleness. */
export function snakeCars(data: ViewerData, cars: PlottedVehicle[]): PlottedVehicle[] {
  return cars.map((car) => {
    if (!car.match) return car;
    const candidates = data.edges.filter((e) =>
      car.vehicle.routeId
        ? e.routeIds.includes(car.vehicle.routeId)
        : e.id === car.match!.edgeId,
    );
    const match = matchGpsToTrack(
      candidates,
      car.vehicle.latitude,
      car.vehicle.longitude,
      {
        routeId: car.vehicle.routeId,
        bearing: car.vehicle.bearing,
        transform: data.geographicTransform,
        maxDistanceMetres: 250,
      },
    );
    if (!match) return { ...car, match: undefined };
    if (car.vehicle.bearing === undefined) match.direction = car.match.direction;
    return { ...car, match, point: match.point, angle: match.angle };
  });
}

export function auditSnakeMap(data: ViewerData) {
  const errors: string[] = [];
  const edges = new Map(data.edges.map((e) => [e.id, e]));
  const nodes = new Map<string, Point>();
  for (const edge of data.edges) {
    if (
      !(edge.lengthMetres > 0.1) ||
      edge.points.length < 2 ||
      edge.sourcePoints.length < 2 ||
      edge.points.length !== edge.sourceDistances.length ||
      [...edge.points.flat(), ...edge.sourcePoints.flat(), ...edge.sourceDistances].some(
        (n) => !Number.isFinite(n),
      ) ||
      Math.abs(edge.sourceDistances.at(-1)! - edge.lengthMetres) > 0.01
    )
      errors.push(`Invalid geometry: ${edge.id}`);
    for (const [node, point] of [
      [edge.a, edge.sourcePoints[0]],
      [edge.b, edge.sourcePoints.at(-1)!],
    ] as const) {
      if (nodes.has(node) && distance(nodes.get(node)!, point) > 1)
        errors.push(`Disconnected node geometry: ${node}`);
      nodes.set(node, point);
    }
  }
  for (const feature of data.features) {
    const edge = edges.get(feature.edgeId ?? ''),
      d = feature.distanceAlongMetres;
    if (
      !edge ||
      d === undefined ||
      !Number.isFinite(d) ||
      d < 0 ||
      d > edge.lengthMetres + 0.01
    )
      errors.push(`Unattached station/terminal: ${feature.name}`);
    else if (distance(feature.point, pointAlongEdge(edge, d).point) > 0.01)
      errors.push(`Station off game track: ${feature.name}`);
  }
  for (const path of data.paths ?? [])
    for (let i = 0; i < path.edgeRefs.length; i++) {
      const ref = path.edgeRefs[i],
        edge = edges.get(ref.edgeId);
      if (!edge) {
        errors.push(`Missing mission edge: ${path.id}`);
        continue;
      }
      const prev = path.edgeRefs[i - 1],
        previous = prev && edges.get(prev.edgeId);
      if (
        previous &&
        (prev.direction === 1 ? previous.b : previous.a) !==
          (ref.direction === 1 ? edge.a : edge.b)
      )
        errors.push(`Broken mission: ${path.id}`);
    }
  return {
    errors: unique(errors),
    stations: data.features.length,
    terminals: data.features.filter((f) => f.kind === 'terminal').length,
    loops: data.edges.filter((e) => e.a === e.b).length,
    edges: data.edges.length,
  };
}
