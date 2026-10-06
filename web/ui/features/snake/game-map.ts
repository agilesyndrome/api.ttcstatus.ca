import type { Edge, EdgeRef, Point, ViewerData } from '../../../../shared/map/model';
import { boundsOf } from '../../../../shared/map/model';
import { simplifyPolyline } from '../../../../shared/map/geometry';
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
const GAME_SMOOTHING_METRES = 24;
const GAME_CORNER_RADIUS_METRES = 22;
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

function roundCorners(points: Point[]): Point[] {
  if (
    points.length < 3 ||
    (points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1])
  )
    return points;
  const rounded: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1],
      point = points[i],
      after = points[i + 1],
      incoming = distance(before, point),
      outgoing = distance(point, after),
      radius = Math.min(GAME_CORNER_RADIUS_METRES, incoming * 0.28, outgoing * 0.28);
    if (radius < 8) {
      rounded.push(point);
      continue;
    }
    const entry: Point = [
      point[0] + ((before[0] - point[0]) * radius) / incoming,
      point[1] + ((before[1] - point[1]) * radius) / incoming,
    ];
    const exit: Point = [
      point[0] + ((after[0] - point[0]) * radius) / outgoing,
      point[1] + ((after[1] - point[1]) * radius) / outgoing,
    ];
    rounded.push(entry);
    for (const t of [0.25, 0.5, 0.75])
      rounded.push([
        (1 - t) * (1 - t) * entry[0] + 2 * (1 - t) * t * point[0] + t * t * exit[0],
        (1 - t) * (1 - t) * entry[1] + 2 * (1 - t) * t * point[1] + t * t * exit[1],
      ]);
    rounded.push(exit);
  }
  rounded.push(points.at(-1)!);
  return rounded;
}

function gameGeometry(edge: Edge, sourcePoints: Point[], data: ViewerData): Edge {
  const simplified = simplifyPolyline(sourcePoints, GAME_SMOOTHING_METRES);
  return geometry(edge, roundCorners(simplified), data);
}

function edgeStart(edge: Edge, direction: 1 | -1) {
  return direction === 1 ? edge.a : edge.b;
}

function edgeEnd(edge: Edge, direction: 1 | -1) {
  return direction === 1 ? edge.b : edge.a;
}

function clearFeatureAttachments(data: ViewerData) {
  data.features = data.features.map((feature) => {
    const { edgeId: _edgeId, distanceAlongMetres: _distance, ...unattached } = feature;
    return unattached;
  });
}

function remapEdgeRefs(data: ViewerData, aliases: Map<string, EdgeRef>) {
  data.paths = data.paths?.map((path) => ({
    ...path,
    edgeRefs: path.edgeRefs.map((ref) => {
      const replacement = aliases.get(ref.edgeId);
      if (!replacement) return ref;
      return {
        edgeId: replacement.edgeId,
        direction: (ref.direction * replacement.direction) as 1 | -1,
      };
    }),
  }));
}

/** Route variants frequently describe the same centreline in opposite order.
 * They are useful source evidence, but two copies make an arcade switch look
 * like a four-way turnout. Keep the richest copy and union its labels. */
function collapseDuplicateRails(data: ViewerData): number {
  const groups = new Map<string, Edge[]>();
  for (const edge of data.edges) {
    const key = [edge.a, edge.b].sort().join('|');
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  // A terminal loop can be represented by two coincident source edges that a
  // signed path deliberately traverses in sequence. Removing one would turn
  // that loop into an immediate same-rail reversal and a long train would
  // crash before it reached the terminal.
  const protectedEdges = new Set<string>();
  for (const group of groups.values()) {
    const ids = new Set(group.map((edge) => edge.id));
    for (const path of data.paths ?? []) {
      const used = new Set(
        path.edgeRefs.filter((ref) => ids.has(ref.edgeId)).map((ref) => ref.edgeId),
      );
      if (used.size > 1) used.forEach((id) => protectedEdges.add(id));
    }
  }
  const aliases = new Map<string, EdgeRef>();
  const kept: Edge[] = [];
  for (const group of groups.values()) {
    if (group.length === 2) {
      const ids = new Set(group.map((edge) => edge.id));
      const joins = (a: EdgeRef, b: EdgeRef) => {
        const first = group.find((edge) => edge.id === a.edgeId);
        const second = group.find((edge) => edge.id === b.edgeId);
        return (
          first &&
          second &&
          first.id !== second.id &&
          edgeEnd(first, a.direction) === edgeStart(second, b.direction)
        );
      };
      let loopPair:
        { path: NonNullable<ViewerData['paths']>[number]; index: number } | undefined;
      let safeLoop = true;
      for (const path of data.paths ?? []) {
        for (let i = 0; i < path.edgeRefs.length; i++) {
          const ref = path.edgeRefs[i];
          if (!ids.has(ref.edgeId)) continue;
          const next = path.edgeRefs[i + 1],
            previous = path.edgeRefs[i - 1];
          if (next && joins(ref, next)) {
            loopPair ??= { path, index: i };
            continue;
          }
          if (!(previous && joins(previous, ref))) safeLoop = false;
        }
      }
      if (safeLoop && loopPair) {
        const firstRef = loopPair.path.edgeRefs[loopPair.index];
        const secondRef = loopPair.path.edgeRefs[loopPair.index + 1];
        const firstEdge = group.find((edge) => edge.id === firstRef.edgeId)!;
        const secondEdge = group.find((edge) => edge.id === secondRef.edgeId)!;
        const orient = (edge: Edge, direction: 1 | -1) =>
          direction === 1 ? edge.sourcePoints : edge.sourcePoints.slice().reverse();
        const loop = gameGeometry(
          {
            ...firstEdge,
            id: `snake:loop:${firstEdge.id}:${secondEdge.id}`,
            a: edgeStart(firstEdge, firstRef.direction),
            b: edgeStart(firstEdge, firstRef.direction),
            routeIds: unique(group.flatMap((edge) => edge.routeIds)).sort(),
            infrastructureIds: unique(
              group.flatMap((edge) => edge.infrastructureIds),
            ).sort(),
          },
          [
            ...orient(firstEdge, firstRef.direction),
            ...orient(secondEdge, secondRef.direction).slice(1),
          ],
          data,
        );
        kept.push(loop);
        for (const path of data.paths ?? []) {
          const nextRefs: EdgeRef[] = [];
          for (let i = 0; i < path.edgeRefs.length; i++) {
            const a = path.edgeRefs[i],
              b = path.edgeRefs[i + 1];
            if (a && b && joins(a, b)) {
              nextRefs.push({ edgeId: loop.id, direction: 1 });
              i++;
            } else nextRefs.push(a);
          }
          path.edgeRefs = nextRefs;
        }
        continue;
      }
    }
    if (group.some((edge) => protectedEdges.has(edge.id))) {
      kept.push(...group);
      continue;
    }
    const representative = group
      .slice()
      .sort(
        (a, b) =>
          b.routeIds.length * 100 +
          b.infrastructureIds.length -
          (a.routeIds.length * 100 + a.infrastructureIds.length),
      )[0];
    representative.routeIds = unique(group.flatMap((edge) => edge.routeIds)).sort();
    representative.infrastructureIds = unique(
      group.flatMap((edge) => edge.infrastructureIds),
    ).sort();
    kept.push(representative);
    for (const edge of group) {
      const sameDirection = edge.a === representative.a && edge.b === representative.b;
      aliases.set(edge.id, {
        edgeId: representative.id,
        direction: sameDirection ? 1 : -1,
      });
    }
  }
  const collapsed = data.edges.length - kept.length;
  data.edges = kept;
  remapEdgeRefs(data, aliases);
  return collapsed;
}

function protectedNodes(data: ViewerData, nodes: Map<string, Point>) {
  const terminals = data.features
    .filter((feature) => feature.kind === 'terminal')
    .map((feature) => sourcePoint(feature.point, data));
  return new Set(
    [...nodes]
      .filter(([, point]) => terminals.some((terminal) => distance(point, terminal) < 80))
      .map(([id]) => id),
  );
}

/** Contract degree-two source vertices only when every mission crossing that
 * vertex uses both sides. This turns a street's dozens of shape fragments
 * into one smooth driving corridor without teleporting a signed mission. */
function collapseGeometryNodes(data: ViewerData): number {
  let collapsed = 0;
  for (;;) {
    const adjacency = new Map<string, Edge[]>();
    const nodes = new Map<string, Point>();
    for (const edge of data.edges) {
      nodes.set(edge.a, edge.sourcePoints[0]);
      nodes.set(edge.b, edge.sourcePoints.at(-1)!);
      for (const node of unique([edge.a, edge.b]))
        adjacency.set(node, [...(adjacency.get(node) ?? []), edge]);
    }
    const protectedIds = protectedNodes(data, nodes);
    let merged = false;
    for (const [node, legs] of adjacency) {
      if (
        protectedIds.has(node) ||
        legs.length !== 2 ||
        legs[0].a === legs[0].b ||
        legs[1].a === legs[1].b
      )
        continue;
      const [first, second] = legs,
        outerFirst = first.a === node ? first.b : first.a,
        outerSecond = second.a === node ? second.b : second.a;
      if (outerFirst === outerSecond) continue;

      const joins = (a: EdgeRef, b: EdgeRef) =>
        [a.edgeId, b.edgeId].sort().join('|') ===
          [first.id, second.id].sort().join('|') &&
        edgeEnd(
          data.edges.find((edge) => edge.id === a.edgeId)!,
          a.direction,
        ) === node &&
        edgeStart(
          data.edges.find((edge) => edge.id === b.edgeId)!,
          b.direction,
        ) === node;
      let safe = true;
      for (const path of data.paths ?? []) {
        for (let i = 0; i < path.edgeRefs.length; i++) {
          const ref = path.edgeRefs[i];
          if (ref.edgeId !== first.id && ref.edgeId !== second.id) continue;
          const next = path.edgeRefs[i + 1];
          const previous = path.edgeRefs[i - 1];
          if (!(next && joins(ref, next)) && !(previous && joins(previous, ref))) {
            safe = false;
            break;
          }
        }
        if (!safe) break;
      }
      if (!safe) continue;

      const orient = (edge: Edge, from: string) =>
        edge.a === from ? edge.sourcePoints : edge.sourcePoints.slice().reverse();
      const points = [...orient(first, outerFirst), ...orient(second, node).slice(1)];
      const mergedEdge = gameGeometry(
        {
          ...first,
          id: `snake:corridor:${first.id}:${second.id}`,
          a: outerFirst,
          b: outerSecond,
          routeIds: unique([...first.routeIds, ...second.routeIds]).sort(),
          infrastructureIds: unique([
            ...first.infrastructureIds,
            ...second.infrastructureIds,
          ]).sort(),
        },
        points,
        data,
      );
      for (const path of data.paths ?? []) {
        const nextRefs: EdgeRef[] = [];
        for (let i = 0; i < path.edgeRefs.length; i++) {
          const a = path.edgeRefs[i],
            b = path.edgeRefs[i + 1];
          if (b && joins(a, b)) {
            const start = edgeStart(
              data.edges.find((edge) => edge.id === a.edgeId)!,
              a.direction,
            );
            nextRefs.push({
              edgeId: mergedEdge.id,
              direction: start === outerFirst ? 1 : -1,
            });
            i++;
          } else nextRefs.push(a);
        }
        path.edgeRefs = nextRefs;
      }
      data.edges = data.edges.filter((edge) => edge !== first && edge !== second);
      data.edges.push(mergedEdge);
      merged = true;
      collapsed++;
      break;
    }
    if (!merged) return collapsed;
  }
}

interface BarnAccess {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  routes: string[];
}

// These are deliberately game spurs, not a claim that the public schematic is
// a surveyed yard plan. They give the two classic operating barns a clear,
// reversible entry and exit instead of making a child hunt for an invisible
// track inside a dense city block.
const BARN_ACCESS: BarnAccess[] = [
  {
    id: 'roncesvalles',
    name: 'Roncesvalles Carhouse',
    latitude: 43 + 38 / 60 + 37 / 3600,
    longitude: -(79 + 26 / 60 + 32 / 3600),
    routes: ['501', '504'],
  },
  {
    id: 'russell',
    name: 'Russell Carhouse',
    latitude: 43 + 39 / 60 + 42 / 3600,
    longitude: -(79 + 19 / 60 + 34 / 3600),
    routes: ['501', '506'],
  },
];

function localGpsPoint(latitude: number, longitude: number, data: ViewerData): Point {
  const p = data.geographicTransform.projection;
  return [
    (longitude - p.longitude) * p.metresPerLongitudeDegree,
    (latitude - p.latitude) * p.metresPerLatitudeDegree,
  ];
}

function addBarnAccess(data: ViewerData): number {
  let added = 0;
  for (const barn of BARN_ACCESS) {
    const point = localGpsPoint(barn.latitude, barn.longitude, data);
    const candidates = data.edges.filter((edge) =>
      edge.routeIds.some((id) =>
        barn.routes.includes(data.routes.find((route) => route.id === id)?.number ?? id),
      ),
    );
    const hit = nearest(point, candidates.length ? candidates : data.edges);
    if (!hit || hit.gap > 700) continue;

    let node = hit.edge.a;
    let anchor = hit.edge.sourcePoints[0];
    if (hit.metres > 20 && hit.edge.lengthMetres - hit.metres > 20) {
      node = `snake:barn:${barn.id}:entry`;
      const first = gameGeometry(
        { ...hit.edge, id: `${node}:in`, b: node },
        [...hit.edge.sourcePoints.slice(0, hit.segment), hit.point],
        data,
      );
      const second = gameGeometry(
        { ...hit.edge, id: `${node}:out`, a: node },
        [hit.point, ...hit.edge.sourcePoints.slice(hit.segment)],
        data,
      );
      data.edges = data.edges.flatMap((edge) =>
        edge.id === hit.edge.id ? [first, second] : [edge],
      );
      data.paths = data.paths?.map((path) => ({
        ...path,
        edgeRefs: path.edgeRefs.flatMap((ref): EdgeRef[] =>
          ref.edgeId !== hit.edge.id
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
      anchor = hit.point;
    } else if (hit.metres >= hit.edge.lengthMetres - 20) {
      node = hit.edge.b;
      anchor = hit.edge.sourcePoints.at(-1)!;
    }

    const terminalNode = `snake:barn:${barn.id}`;
    const approach: Point = [(anchor[0] + point[0]) / 2, (anchor[1] + point[1]) / 2];
    const branch = gameGeometry(
      {
        id: `snake:barn:${barn.id}:access`,
        a: node,
        b: terminalNode,
        routeIds: hit.edge.routeIds.slice(),
        infrastructureIds: ['snake:barn-access'],
      } as Edge,
      [anchor, approach, point],
      data,
    );
    data.edges.push(branch);
    data.features.push({
      id: `terminal:${barn.id}`,
      name: barn.name,
      kind: 'terminal',
      point: localToMap(point, data.geographicTransform),
      routeIds: unique(hit.edge.routeIds),
      accessible: null,
      boardingPoints: 0,
      platformNames: [barn.name],
      destinations: {},
      replacementRouteIds: [],
    });
    if (!data.infrastructure.some((item) => item.id === 'snake:barn-access'))
      data.infrastructure.push({
        id: 'snake:barn-access',
        name: 'Simple game access to TTC barns',
      });
    added++;
  }
  return added;
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
  clearFeatureAttachments(data);
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

  // From here on the graph is a game board, not an infrastructure inventory:
  // one centreline per corridor, one long edge between meaningful choices,
  // and a rounded polyline that is forgiving at arcade speed.
  let collapsedEdges = removed.size;
  collapsedEdges += collapseDuplicateRails(data);
  collapsedEdges += collapseGeometryNodes(data);
  // Contracting a corridor can create a new duplicate at its far end. Run
  // the same cheap pass once more so merging does not reintroduce a turnout.
  collapsedEdges += collapseDuplicateRails(data);
  data.edges = data.edges.map((edge) => gameGeometry(edge, edge.sourcePoints, data));

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
  addBarnAccess(data);
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
  return { data, collapsedEdges, transfers };
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
