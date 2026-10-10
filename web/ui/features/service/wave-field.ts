/** The dream layer's brain (the polish epic): the dryness field made visible.
 * Everything here is pure, so the track gradients, the selected-stop ring,
 * and the stop card all speak with one mind — and tests hold them to it.
 *
 * New shape (E7S4): the field is painted on the TRACKS themselves. Stops are
 * just where we sample it: per-edge anchors (a stop feature's position along
 * its edge) carry the delivered dryness, and the field interpolates
 * continuously between them (sla.md §3.9 — the wave is a ridge in this
 * field, not a list of stops). Motion comes only from measured data:
 * dryness genuinely grows one second per second (the heartbeat), so the
 * band intensifies in real time; a soft flowing dash marks void stretches.
 *
 * Nearside platforms share an edge, so a track position carries both
 * directions: the field takes the WORST dryness at that position — the
 * rider's eye should find the pain — while the selected-stop card keeps the
 * per-direction truth. A blind spot (unmonitored) greys the stretch; it is
 * never a void. */

import type { StopServiceState } from '../../../../shared/service/contracts';
import type { Edge, Feature } from '../../../../shared/map/model';
import { drynessAndState } from '../../../../shared/service/wait-metrics';
import { serviceConfig } from '../../../../shared/service/config';
import type { ServiceConfig } from '../../../../shared/service/config';

export type FieldState = 'fresh' | 'due' | 'void' | 'unmonitored' | 'collecting';

/** The state ramp — calm green through amber to red, grey for the blind
 * spots. Colour is never the only channel, but the ramp is tuned to read at
 * a glance and survive colour weakness: fresh/void differ in lightness as
 * well as hue. */
export const STATE_COLORS: Record<FieldState, string> = {
  fresh: '#2f9e6e',
  due: '#e0a63c',
  void: '#d64550',
  unmonitored: '#8a8f98',
  collecting: '#b9bec7',
};

const fmt = (value: number, decimals = 1) =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : value;

/** Plain language for a stop's state — the grandma test. Every phrase is
 * backed by a number the API serves; nothing editorialises beyond the math. */
export function stopSentence(stop: StopServiceState, name?: string): string {
  const label = name ?? stop.stopId;
  const med =
    stop.medianHeadwayOwnSeconds !== null ? stop.medianHeadwayOwnSeconds / 60 : null;
  const waited = stop.minutesSince;
  const est = stop.expectedWaitSeconds !== null ? stop.expectedWaitSeconds / 60 : null;
  const usual = med !== null ? ` Cars here usually run every ${fmt(med)} min.` : '';
  switch (stop.state) {
    case 'fresh':
      return `${label}: just serviced.${usual}`;
    case 'due':
      return `${label}: you've waited ${fmt(waited ?? 0)} min — usually every ${fmt(med ?? 0)} min (${fmt((waited ?? 0) / (med ?? 1))}× the usual).${est !== null ? ` Next car ≈ ${fmt(est)} min, given recent gaps.` : ''}`;
    case 'void':
      return `${label}: ${fmt(waited ?? 0)} min without a car — usually every ${fmt(med ?? 0)} min (${fmt(stop.dryness ?? 0)}× the usual).${est !== null ? ` Next car ≈ ${fmt(est)} min, given how gaps have been running.` : ''}`;
    case 'unmonitored':
      return `${label}: we can't see this stop right now (${stop.coverage?.kind ?? 'outage'}). No verdict — never a void.`;
    case 'collecting':
      return `${label}: still collecting this stop's rhythm before it speaks.`;
  }
}

/** Advance a stop's state between feed ticks (the heartbeat): elapsed time
 * genuinely grows one second per second, so the marker re-scores honestly
 * with the same shared machine — a stop crosses fresh → due → void at the
 * true moment, not at the next tick. Estimates (R(e)) and coverage stay from
 * the tick — the estimate is a number about gaps, not a clock; a blind spot
 * never advances into a verdict. */
export function advanceStopState(
  stop: StopServiceState,
  byMs: number,
  config: ServiceConfig = serviceConfig(),
): StopServiceState {
  if (stop.state === 'unmonitored' || stop.state === 'collecting') return stop;
  const by = Math.max(0, byMs);
  if (by === 0 || stop.minutesSince === null) return stop;
  const minutesSince = stop.minutesSince + by / 60000;
  const medianSeconds = stop.medianHeadwayOwnSeconds;
  const scored = drynessAndState(
    {
      minutesSince,
      medianHeadwayOwnSeconds: medianSeconds,
      currentlyObservable: stop.coverage === null || stop.coverage.kind === 'observable',
      touchCount: config.baselineMinTouches,
      baselineTouches: medianSeconds !== null ? 0 : config.baselineMinTouches,
    },
    config,
  );
  return { ...stop, minutesSince, dryness: scored.dryness, state: scored.state };
}

// ---------------------------------------------------------------------------
// The field on the track.
// ---------------------------------------------------------------------------

/** One straight piece of one direction's stream: display-space endpoints
 * (unoffset — the renderer shifts them to their side of the track), the
 * field's value at the piece's midpoint, the travel direction of the stream
 * along the polyline's point order, and the flow speed the state earns. */
export interface TrackSegment {
  directionId: 0 | 1;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dryness: number | null;
  state: FieldState;
  /** True when this direction travels toward increasing point order (see
   * DIRECTION_TRAVEL assumption). */
  flowsForward: boolean;
  /** Dash-flow period, seconds: brisk when cars come quickly, a slow drift
   * through the void. Infinity = no flow (blind). */
  flowSeconds: number;
  /** The dash pattern's starting phase (display units, mod the pattern
   * cycle) so a subdivided stream flows as ONE continuous current — no
   * seams where the gradient steps. */
  phase: number;
}

/** How far each stream sits from the track centreline, in map units — thin
 * twin streams riding the track, a hairline of the base rail between them. */
export const STREAM_OFFSET = 1.15;
/** Stream stroke width (the base track is 4.5). */
export const STREAM_WIDTH = 1.8;
/** Long pieces subdivide at this many display units so the colour gradient
 * bends along the stretch instead of one flat colour vertex-to-vertex. */
export const SUBDIVIDE_UNITS = 24;
/** Subdivision cap per polyline piece — bounds element counts. */
export const MAX_SUBPIECES = 8;
/** The flow dash pattern's travel per animation cycle (display units); the
 * CSS keyframes shift by exactly this so the phase stays continuous. */
export const DASH_CYCLE = 28;

/** The travel-direction assumption (recorded honestly): the published edges
 * inherit their point order from the route's first — direction-0 — pattern,
 * so direction 0 streams flow toward increasing point order and direction 1
 * against it. Per-direction truth lives in the split itself; if an edge's
 * order ever disagrees, the two streams still flow oppositely and the
 * selected stop's card carries the ground truth. */
const DIRECTION_TRAVEL: Record<0 | 1, boolean> = { 0: true, 1: false };

/** Speed IS the service (the user's insight): fresh streams flow briskly —
 * cars come quickly here; the void drifts — the gap crawling along. */
const FLOW_SECONDS: Record<FieldState, number> = {
  fresh: 1.6,
  due: 2.8,
  void: 5.5,
  unmonitored: Infinity,
  collecting: Infinity,
};

/** A directional stop's position along its edge, carrying that direction's
 * field value — or blind if every direction is unmonitored/collecting. */
interface Anchor {
  distance: number;
  dryness: number | null;
  blind: boolean;
}

function anchorsOfEdge(
  edge: Edge,
  features: Feature[],
  statesByStop: ReadonlyMap<string, StopServiceState>,
  directionId: 0 | 1,
): Anchor[] {
  const anchors: Anchor[] = [];
  for (const feature of features) {
    if (feature.edgeId !== edge.id || feature.distanceAlongMetres === undefined) continue;
    // This direction's stops only: nearside platforms stop lying for each
    // other — a one-way void paints one stream, never both. Subway-only
    // stops never anchor (E7S7): the overlay is surface-only, enforced here
    // so no caller can forget the filter.
    const states = (feature.stopIds ?? [])
      .map((stopId) => statesByStop.get(stopId))
      .filter(
        (state): state is StopServiceState =>
          state !== undefined &&
          state.directionId === directionId &&
          !isSubwayOnlyStop(state),
      );
    if (states.length === 0) continue;
    // Only finite dryness paints — anything else (missing, NaN) degrades to
    // blind rather than painting a lie.
    const withDryness = states.filter(
      (state) => typeof state.dryness === 'number' && Number.isFinite(state.dryness),
    );
    if (withDryness.length > 0) {
      anchors.push({
        distance: feature.distanceAlongMetres,
        dryness: Math.max(...withDryness.map((state) => state.dryness as number)),
        blind: false,
      });
    } else {
      anchors.push({
        distance: feature.distanceAlongMetres,
        dryness: null,
        // Blind only when every one of this direction's stops is: one
        // visible stop is still the truth at that position.
        blind: states.every(
          (state) => state.state === 'unmonitored' || state.state === 'collecting',
        ),
      });
    }
  }
  anchors.sort((a, b) => a.distance - b.distance);
  return anchors;
}

/** The field at metre `t` along the edge: clamped at the ends, interpolated
 * between anchors; blind stretches hold the nearest visible value's side of
 * the boundary (a blind stop never fabricates a verdict for its neighbour). */
function sampleAt(
  anchors: Anchor[],
  t: number,
): { dryness: number | null; blind: boolean } {
  if (anchors.length === 0) return { dryness: null, blind: true };
  if (anchors.length === 1)
    return { dryness: anchors[0].dryness, blind: anchors[0].blind };
  if (t <= anchors[0].distance)
    return { dryness: anchors[0].dryness, blind: anchors[0].blind };
  const last = anchors[anchors.length - 1];
  if (t >= last.distance) return { dryness: last.dryness, blind: last.blind };
  let upper = 1;
  while (upper < anchors.length && anchors[upper].distance < t) upper += 1;
  const lower = anchors[upper - 1];
  const high = anchors[upper];
  const span = high.distance - lower.distance || 1;
  const u = (t - lower.distance) / span;
  if (lower.blind && high.blind) return { dryness: null, blind: true };
  if (lower.blind) return { dryness: high.dryness, blind: false };
  if (high.blind) return { dryness: lower.dryness, blind: false };
  // Smoothstep: the transition spends its change slowly near each stop, so
  // neighbouring colours blend instead of stepping (the softer gradient).
  const eased = u * u * (3 - 2 * u);
  return {
    dryness: (lower.dryness ?? 0) * (1 - eased) + (high.dryness ?? 0) * eased,
    blind: false,
  };
}

function stateOf(
  dryness: number | null,
  blind: boolean,
  config: ServiceConfig,
): FieldState {
  if (blind || dryness === null) return 'unmonitored';
  if (dryness >= config.voidDrynessRatio) return 'void';
  if (dryness < config.freshDrynessRatio) return 'fresh';
  return 'due';
}

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const mix = (a: string, b: string, t: number): string => {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
};

/** The continuous ramp the track paints with: fresh at r=0, amber at the
 * fresh/due boundary feel (r=1), full void red at the void horizon (r=2),
 * deepening slightly beyond. Null (blind/collecting) greys the stretch. */
export function drynessColor(dryness: number | null, state?: FieldState): string {
  if (state === 'collecting') return STATE_COLORS.collecting;
  if (dryness === null || state === 'unmonitored') return STATE_COLORS.unmonitored;
  if (dryness <= 0) return STATE_COLORS.fresh;
  if (dryness <= 1) return mix(STATE_COLORS.fresh, STATE_COLORS.due, dryness);
  if (dryness <= 2) return mix(STATE_COLORS.due, STATE_COLORS.void, dryness - 1);
  return mix(STATE_COLORS.void, '#8e2430', Math.min(1, (dryness - 2) / 1.5));
}

/** Paint the field along one edge, one stream per direction: split the
 * polyline at every vertex and colour each piece by that DIRECTION's
 * interpolated value at its midpoint. A direction with no anchored stops
 * paints nothing (no data, no opinion); a one-way void paints one stream
 * only — the other direction keeps its own truth. */
export function edgeServiceSegments(
  edge: Edge,
  features: Feature[],
  statesByStop: ReadonlyMap<string, StopServiceState>,
  config: ServiceConfig = serviceConfig(),
  maxPieceUnits: number = SUBDIVIDE_UNITS,
): TrackSegment[] {
  const points = edge.points;
  if (points.length < 2) return [];
  // Metres along the source polyline (field sampling)…
  const distances =
    edge.sourceDistances.length === points.length
      ? edge.sourceDistances
      : cumulative(edge.sourcePoints);
  // …and display units along the drawn polyline (subdivision + dash phase).
  const display = cumulative(points);
  const segments: TrackSegment[] = [];
  for (const directionId of [0, 1] as const) {
    const anchors = anchorsOfEdge(edge, features, statesByStop, directionId);
    if (anchors.length === 0) continue;
    for (let index = 1; index < points.length; index += 1) {
      const pieceDisplay = display[index] - display[index - 1];
      if (!(pieceDisplay > 0)) continue;
      const pieceMetres = distances[index] - distances[index - 1];
      const subPieces =
        maxPieceUnits > 0
          ? Math.min(MAX_SUBPIECES, Math.max(1, Math.ceil(pieceDisplay / maxPieceUnits)))
          : 1;
      const [ax, ay] = points[index - 1];
      const [bx, by] = points[index];
      for (let sub = 0; sub < subPieces; sub += 1) {
        const u0 = sub / subPieces;
        const u1 = (sub + 1) / subPieces;
        // Sample the field at the SUB-PIECE's midpoint (in metres), so the
        // gradient bends along the stretch instead of one colour per piece.
        const midMetres = distances[index - 1] + pieceMetres * ((u0 + u1) / 2);
        const sample = sampleAt(anchors, midMetres);
        const state = stateOf(sample.dryness, sample.blind, config);
        segments.push({
          directionId,
          x1: ax + (bx - ax) * u0,
          y1: ay + (by - ay) * u0,
          x2: ax + (bx - ax) * u1,
          y2: ay + (by - ay) * u1,
          dryness: sample.blind ? null : sample.dryness,
          state,
          flowsForward: DIRECTION_TRAVEL[directionId],
          flowSeconds: FLOW_SECONDS[state],
          phase: (display[index - 1] + pieceDisplay * u0) % DASH_CYCLE,
        });
      }
    }
  }
  return segments;
}

/** Route numbers of the subway lines (the live-status idiom). */
const RAPID_ROUTE = /^(1|2|4|5|6)$/;

/** A stop served ONLY by subway lines: the void overlay is disabled for all
 * subways (user decision, E7S7) — their states never anchor the field, so
 * subway tracks paint nothing, subway cars carry no tint, and selecting one
 * opens no card. A stop shared with a streetcar route still shows. */
export function isSubwayOnlyStop(state: StopServiceState): boolean {
  const routes = state.routeIds ?? [];
  return routes.length > 0 && routes.every((route) => RAPID_ROUTE.test(route));
}

/** The surface truth only: subway-only stops filtered out of the live map. */
export function surfaceStatesByStop(
  states: ReadonlyMap<string, StopServiceState>,
): Map<string, StopServiceState> {
  const surface = new Map<string, StopServiceState>();
  for (const [stopId, state] of states) {
    if (!isSubwayOnlyStop(state)) surface.set(stopId, state);
  }
  return surface;
}

/** The snail slime (E7S6): the green trail a matched, non-stale car drags
 * from its head back to the last stop it passed on ITS direction — honest,
 * because a car that just passed those stops has just serviced them; the
 * recorder will say the same next tick. This is what makes the clearing car
 * visible: it advances into the red with fresh green behind it. */
export function carTrailSegments(
  edge: Edge,
  car: {
    match?: { edgeId: string; direction: 1 | -1; distanceAlongMetres: number };
    stale: boolean;
  },
  features: Feature[],
  statesByStop: ReadonlyMap<string, StopServiceState>,
): TrackSegment[] {
  const match = car.match;
  if (!match || car.stale || match.edgeId !== edge.id) return [];
  const directionId: 0 | 1 = match.direction === 1 ? 0 : 1;
  const anchors = anchorsOfEdge(edge, features, statesByStop, directionId);
  if (anchors.length === 0) return [];
  const forward = DIRECTION_TRAVEL[directionId];
  const carAt = match.distanceAlongMetres;
  // The last stop BEHIND the car on its travel: smaller distances for a
  // forward car, larger for a reversed one.
  const behind = forward
    ? [...anchors].reverse().find((anchor) => anchor.distance < carAt)
    : anchors.find((anchor) => anchor.distance > carAt);
  if (!behind) return [];
  const from = forward ? behind.distance : carAt;
  const to = forward ? carAt : behind.distance;
  const points = edge.points;
  if (points.length < 2) return [];
  const distances =
    edge.sourceDistances.length === points.length
      ? edge.sourceDistances
      : cumulative(edge.sourcePoints);
  const display = cumulative(points);
  const segments: TrackSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const m0 = distances[index - 1];
    const m1 = distances[index];
    if (!(m1 > m0)) continue;
    const lo = Math.max(m0, from);
    const hi = Math.min(m1, to);
    if (!(hi > lo)) continue;
    const u0 = (lo - m0) / (m1 - m0);
    const u1 = (hi - m0) / (m1 - m0);
    const pieceDisplay = display[index] - display[index - 1];
    const [ax, ay] = points[index - 1];
    const [bx, by] = points[index];
    segments.push({
      directionId,
      x1: ax + (bx - ax) * u0,
      y1: ay + (by - ay) * u0,
      x2: ax + (bx - ax) * u1,
      y2: ay + (by - ay) * u1,
      dryness: 0,
      state: 'fresh',
      flowsForward: forward,
      flowSeconds: FLOW_SECONDS.fresh,
      phase: (display[index - 1] + pieceDisplay * u0) % DASH_CYCLE,
    });
  }
  return segments;
}

/** The perpendicular shift of one stream side, in map units, for a piece:
 * direction 0 rides one side of the rail, direction 1 the other, so twin
 * streams sit side by side on the same track and never overlap. */
export function streamOffset(
  segment: Pick<TrackSegment, 'x1' | 'y1' | 'x2' | 'y2' | 'directionId'>,
): { dx: number; dy: number } {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const length = Math.hypot(dx, dy) || 1;
  // Perpendicular of (dx, dy): (-dy, dx) — direction 0 on its left side.
  const sign = segment.directionId === 0 ? 1 : -1;
  return {
    dx: (-dy / length) * STREAM_OFFSET * sign,
    dy: (dx / length) * STREAM_OFFSET * sign,
  };
}

/** This direction's field colour at a metre position along its edge — the
 * car tint. Null when that direction has no anchors there (no data, no
 * opinion: the car keeps its route colour and stays centred). */
export function directionColorAlong(
  edge: Edge,
  directionId: 0 | 1,
  distanceAlongMetres: number,
  features: Feature[],
  statesByStop: ReadonlyMap<string, StopServiceState>,
  config: ServiceConfig = serviceConfig(),
): string | null {
  const anchors = anchorsOfEdge(edge, features, statesByStop, directionId);
  if (anchors.length === 0) return null;
  const sample = sampleAt(anchors, distanceAlongMetres);
  const state = stateOf(sample.dryness, sample.blind, config);
  return drynessColor(sample.blind ? null : sample.dryness, state);
}

function cumulative(points: Array<[number, number]>): number[] {
  const distances: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1];
    const [x2, y2] = points[index];
    distances.push(distances[index - 1] + Math.hypot(x2 - x1, y2 - y1));
  }
  return distances;
}

/** A cheap change-signature for the field's track anchors: the quantised
 * dryness (0.25 steps) and state per anchored stop. The track band recomputes
 * only when this string changes — the heartbeat advances every second, but
 * the paint shifts only when the field actually moves a visible step. */
export function trackFieldSignature(
  features: Feature[],
  statesByStop: ReadonlyMap<string, StopServiceState>,
): string {
  const parts: string[] = [];
  for (const feature of features) {
    for (const stopId of feature.stopIds ?? []) {
      const state = statesByStop.get(stopId);
      if (!state) continue;
      const dryness =
        state.dryness === null ? 'n' : (Math.round(state.dryness * 4) / 4).toFixed(2);
      parts.push(`${stopId}:${dryness}:${state.state}`);
    }
  }
  return parts.join('|');
}
