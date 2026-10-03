import { nearestOnSegment } from "./geometry";
import type { TrackEdge, TrackNode } from "./schematic";

export const CHORD_MERGE_METRES = 30;
type Step = { edgeId: string; direction: 1 | -1 };

/** Simplified GTFS shapes can shortcut bends retained by another shape on the
 * same corridor. Reuse that connected traversal when it stays within 30 m of
 * the chord. Both endpoints must already connect, every step must advance
 * along the chord, and one scheduled route must cover the whole alternative.
 * This cannot join disconnected parallel tracks or create a new junction. */
export function consolidateCorridorChords(edges: TrackEdge[], nodes: TrackNode[], traversals: Map<string, Step[]>) {
  const active = new Map(edges.map(edge => [edge.id, edge]));
  const byNode = new Map(nodes.map(node => [node.id, node]));
  for (const chord of [...edges].sort((a,b) => b.lengthMetres-a.lengthMetres)) {
    if (chord.lengthMetres < 150 || !chord.routeIds.length) continue;
    const positions = new Map(nodes.map(node => [node.id,
      nearestOnSegment(node.sourcePoint, chord.sourcePoints[0], chord.sourcePoints[1])]));
    let replacement: Step[] | undefined;
    for (const routeId of chord.routeIds) {
      const deadEnds = new Set<string>();
      const visit = (nodeId: string): Step[] | undefined => {
        if (nodeId === chord.b) return [];
        if (deadEnds.has(nodeId)) return undefined;
        const from = positions.get(nodeId)!;
        const candidates = byNode.get(nodeId)!.edgeIds.map(id => active.get(id))
          .filter((edge): edge is TrackEdge => Boolean(edge && edge.id !== chord.id && edge.routeIds.includes(routeId)))
          .sort((a,b) => a.lengthMetres-b.lengthMetres);
        for (const edge of candidates) {
          const next = edge.a === nodeId ? edge.b : edge.a, to = positions.get(next)!;
          if (to.t <= from.t + 1e-8 || to.distance > CHORD_MERGE_METRES) continue;
          const rest = visit(next);
          if (rest) return [{ edgeId: edge.id, direction: edge.a === nodeId ? 1 : -1 }, ...rest];
        }
        deadEnds.add(nodeId);
        return undefined;
      };
      replacement = visit(chord.a);
      if (replacement) break;
    }
    if (!replacement || replacement.length < 2) continue;
    for (const step of replacement) {
      const edge = active.get(step.edgeId)!;
      for (const key of ["routeIds", "pathIds", "infrastructureIds"] as const) {
        for (const id of chord[key]) if (!edge[key].includes(id)) edge[key].push(id);
      }
    }
    for (const [id, steps] of traversals) {
      traversals.set(id, steps.flatMap(step => step.edgeId !== chord.id ? [step] : step.direction === 1 ? replacement! :
        [...replacement!].reverse().map(item => ({ edgeId: item.edgeId, direction: -item.direction as 1 | -1 }))));
    }
    active.delete(chord.id);
    for (const id of [chord.a, chord.b]) {
      const node = byNode.get(id)!;
      node.edgeIds = node.edgeIds.filter(edgeId => edgeId !== chord.id);
    }
  }
  return edges.filter(edge => active.has(edge.id));
}
