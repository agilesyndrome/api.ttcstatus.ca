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
import {
  drynessColour,
  fieldPalette,
  type ColourMode,
  type FieldState,
  type FieldTheme,
} from '../../../../shared/map/field-palette';

// The state names live in the shared palette beside the colours that paint
// them; re-exported for every existing browser consumer.
export type { FieldState };

/** The state ramp — calm green through amber to red, grey for the blind
 * spots. Colour is never the only channel, but the ramp is tuned to read at
 * a glance and survive colour weakness: fresh/void differ in lightness as
 * well as hue. */
/** Backwards-compatible light standard swatches for non-reactive consumers. */
export const STATE_COLORS: Record<FieldState, string> = fieldPalette('light', 'standard');

const fmt = (value: number, decimals = 1) =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : value;

/** Plain language for a stop's state — the grandma test. Every phrase is
 * backed by a number the API serves; nothing editorialises beyond the math. */
export function stopSentence(stop: StopServiceState, name?: string): string {
  // No name → no prefix: the card's title bar already says the stop, and the
  // sentence shouldn't repeat it (the street test).
  const label = name !== undefined ? `${name}: ` : '';
  const med =
    stop.medianHeadwayOwnSeconds !== null ? stop.medianHeadwayOwnSeconds / 60 : null;
  const waited = stop.minutesSince;
  const est = stop.expectedWaitSeconds !== null ? stop.expectedWaitSeconds / 60 : null;
  const usual = med !== null ? ` Cars here usually run every ${fmt(med)} min.` : '';
  switch (stop.state) {
    case 'fresh':
      return `${label}just serviced.${usual}`;
    case 'due':
      return `${label}you've waited ${fmt(waited ?? 0)} min — usually every ${fmt(med ?? 0)} min (${fmt((waited ?? 0) / (med ?? 1))}× the usual).${est !== null ? ` Next car ≈ ${fmt(est)} min, given recent gaps.` : ''}`;
    case 'void':
      return `${label}${fmt(waited ?? 0)} min without a car — usually every ${fmt(med ?? 0)} min (${fmt(stop.dryness ?? 0)}× the usual).${est !== null ? ` Next car ≈ ${fmt(est)} min, given how gaps have been running.` : ''}`;
    case 'unmonitored':
      return `${label}we can't see this stop right now (${stop.coverage?.kind ?? 'outage'}). No verdict — never a void.`;
    case 'collecting':
      return `${label}still collecting this stop's rhythm before it speaks.`;
  }
}

// ——— The two switchers: Route first, then Direction —————————————————————
// A platform can serve several day routes, and an intersection can host
// several corridors (Queen crosses Spadina). The popup offers Route first
// (a switcher only when switching changes what you'd land on — corridors
// that share the platform share its numbers, so they read as text), then
// Direction (the sibling platform across the street).
//
// Night 3xx routes ("305 Dundas") fold into their 5xx day twins ("505
// Dundas") everywhere on this screen — day and night share the same
// platforms and the same state, so a bare "305" at noon is the same data
// wearing a costume we never show (model.ts's displayNumber rule).

/** The day twin of a 3xx night route number ("305" → "505"); day passes. */
export function dayRouteNumber(number: string): string {
  return /^3\d\d$/.test(number) ? String(Number(number) + 200) : number;
}

export interface RouteBadge {
  /** A raw route id (day id when the platform serves both twins). */
  id: string;
  /** The day display number — night twins never appear. */
  number: string;
  name: string;
}

/** Day-deduped routes serving one platform, stable day-number order. */
export function platformRoutes(
  routeIds: readonly string[],
  routes: ReadonlyArray<{ id: string; number?: string; name?: string }>,
): RouteBadge[] {
  const byNumber = new Map<string, RouteBadge>();
  for (const id of routeIds) {
    const route = routes.find((entry) => entry.id === id);
    const number = dayRouteNumber(route?.number ?? id);
    if (!byNumber.has(number))
      byNumber.set(number, {
        id: route?.id ?? id,
        number,
        name: route?.name ?? '',
      });
  }
  return [...byNumber.values()].sort((a, b) => a.number.localeCompare(b.number));
}

const SIDE_WORD = /\s+(east|west|north|south)\s+side$/i;
const normName = (name: string) => name.replace(/\s+/g, ' ').trim();

/** The intersection a stop name speaks of: the sorted street pair, so
 * "Spadina Ave at Queen St West" and "Queen St West at Spadina Ave" hash
 * alike (whitespace and the platform's "… Side" suffix never count). Null
 * for names without a cross street (terminals, loops). */
export function intersectionStreets(name: string): [string, string] | null {
  const cleaned = normName(name).replace(SIDE_WORD, '').toLowerCase();
  const parts = cleaned.split(/\s+at\s+/);
  if (parts.length !== 2) return null;
  return [parts[0], parts[1]].sort() as [string, string];
}

const sameIntersection = (a: string, b: string): boolean => {
  const ka = intersectionStreets(a);
  const kb = intersectionStreets(b);
  return ka !== null && kb !== null && ka[0] === kb[0] && ka[1] === kb[1];
};

/** The monitored platforms at the selected platform's intersection — the
 * candidates for both switchers. Includes the selected feature's own
 * paired stopIds and any cross-street sibling features. */
function intersectionStates(
  selected: StopServiceState,
  features: Feature[],
  statesByStop: Map<string, StopServiceState>,
): StopServiceState[] {
  const feature = features.find((entry) => entry.stopIds?.includes(selected.stopId));
  if (!feature) return [];
  const states: StopServiceState[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    const state = statesByStop.get(id);
    if (state && !seen.has(id)) {
      seen.add(id);
      states.push(state);
    }
  };
  for (const id of feature.stopIds ?? []) push(id);
  // Cross-street siblings: features whose names speak of the same
  // intersection — "King St West at John St West Side" pairs with "… East
  // Side", and (for the route switch) a crossing corridor pairs with its
  // own name for the same corner.
  for (const other of features)
    if (other !== feature && sameIntersection(other.name, feature.name))
      for (const id of other.stopIds ?? []) push(id);
  return states;
}

export interface RouteOption extends RouteBadge {
  /** The platform this route lands on at the intersection — the current
   * platform when the route shares it, the route's own platform otherwise
   * (same directionId preferred). Null when the intersection has no
   * monitored platform for the route. */
  stopId: string | null;
}

/** Day routes across the selected platform's whole intersection, each with
 * the platform you'd land on. A switcher-worthy list is one where some
 * route lands elsewhere; shared-platform routes read as text. */
export function routeOptions(
  selected: StopServiceState,
  features: Feature[],
  statesByStop: Map<string, StopServiceState>,
  routes: ReadonlyArray<{ id: string; number?: string; name?: string }>,
): RouteOption[] {
  const atIntersection = intersectionStates(selected, features, statesByStop);
  const byNumber = new Map<string, RouteOption>();
  for (const state of atIntersection) {
    for (const badge of platformRoutes(state.routeIds, routes)) {
      const existing = byNumber.get(badge.number);
      // Prefer the platform that keeps the rider's direction…
      const better =
        existing === undefined ||
        (state.directionId === selected.directionId &&
          existing.stopId !== selected.stopId) ||
        state.stopId === selected.stopId;
      if (!better) continue;
      byNumber.set(badge.number, { ...badge, stopId: state.stopId });
    }
  }
  return [...byNumber.values()].sort((a, b) => a.number.localeCompare(b.number));
}

export interface DirectionOption {
  stopId: string;
  /** Compass words with an honest arrow ("→ East") when the map's own
   * coordinates allow the bearing; the pattern headsign otherwise. */
  label: string;
}

export interface CompassLabel {
  text: string;
  arrow: string;
}

const ARROWS: readonly CompassLabel[] = [
  { text: 'North', arrow: '↑' },
  { text: 'East', arrow: '→' },
  { text: 'South', arrow: '↓' },
  { text: 'West', arrow: '←' },
];

/** A travel bearing (0=N, 90=E) snapped to the four-compass words. */
function compassOf(deg: number): CompassLabel {
  const a = ((deg % 360) + 360) % 360;
  return ARROWS[Math.round(a / 90) % 4]!;
}

/** The platform's travel direction in compass words, from the route's own
 * geography: the bearing from this platform to a distant stop later along
 * its pattern (the pattern's stop order IS the travel direction). Null
 * without coordinates or a pattern — callers fall back, never guess. */
export function platformCompass(
  stop: StopServiceState,
  features: Feature[],
  patterns: ReadonlyArray<{ stopIds: string[]; directionId?: 0 | 1 }>,
): CompassLabel | null {
  const geoOf = (id: string): [number, number] | null => {
    for (const feature of features)
      for (const point of feature.geographicPoints ?? [])
        if (point.stopId === id) return [point.latitude, point.longitude];
    return null;
  };
  const here = geoOf(stop.stopId);
  if (!here) return null;
  const pattern = patterns.find(
    (candidate) =>
      candidate.stopIds.includes(stop.stopId) &&
      (candidate.directionId === undefined || candidate.directionId === stop.directionId),
  );
  if (!pattern) return null;
  const order = pattern.stopIds.indexOf(stop.stopId);
  const bearingDeg = (to: [number, number]) => {
    const [lat1, lon1] = here;
    const [lat2, lon2] = to;
    const dy = lat2 - lat1;
    const dx = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
    return (Math.atan2(dx, dy) * 180) / Math.PI;
  };
  let best: { deg: number; km: number } | null = null;
  // Later stops give the travel bearing directly; if none carries geo far
  // enough to be honest (≥ 0.3 km), a distant earlier stop gives it too,
  // reversed — the pattern's order is the only truth here.
  for (const [earlier, sign] of [
    [false, 1],
    [true, -1],
  ] as const) {
    for (const [index, id] of pattern.stopIds.entries()) {
      if (index === order || earlier !== index < order) continue;
      const there = geoOf(id);
      if (!there) continue;
      const [lat1, lon1] = here;
      const [lat2, lon2] = there;
      const km = Math.hypot(
        (lat2 - lat1) * 111,
        (lon2 - lon1) * 111 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180),
      );
      if (km < 0.3) continue;
      if (!best || km > best.km) best = { deg: sign * bearingDeg(there), km };
    }
    if (best) break;
  }
  return best ? compassOf(best.deg) : null;
}

/** A leading compass word ("West - 306 Carlton…") in headsign words —
 * real TTC headsigns carry it, and it is simpler than the whole headsign. */
const WORD_COMPASS: Record<string, CompassLabel> = {
  east: { text: 'East', arrow: '→' },
  west: { text: 'West', arrow: '←' },
  north: { text: 'North', arrow: '↑' },
  south: { text: 'South', arrow: '↓' },
};

/** The headsign that speaks for one platform: the exact direction's
 * pattern first, any pattern of the stop second, '' never a guess. */
function headsignOf(
  stop: StopServiceState,
  patterns: ReadonlyArray<{ stopIds: string[]; headsign: string; directionId?: 0 | 1 }>,
): string {
  return (
    patterns.find(
      (candidate) =>
        candidate.stopIds.includes(stop.stopId) &&
        (candidate.directionId === undefined ||
          candidate.directionId === stop.directionId),
    ) ??
    patterns.find((candidate) => candidate.stopIds.includes(stop.stopId)) ?? {
      headsign: '',
    }
  ).headsign;
}

/** The simple direction label for one platform ("→ East"), from the most
 * honest source available: measured bearings first, the headsign's own
 * compass word second — never the raw headsign (it embeds route numbers,
 * night twins included). Pure. */
export function platformDirectionLabel(
  stop: StopServiceState,
  features: Feature[],
  patterns: ReadonlyArray<{
    stopIds: string[];
    headsign: string;
    directionId?: 0 | 1;
  }> = [],
): string {
  const compass = platformCompass(stop, features, patterns);
  if (compass) return `${compass.arrow} ${compass.text}`;
  const lead = /^\s*(east|west|north|south)\b/i.exec(headsignOf(stop, patterns));
  if (lead) {
    const word = WORD_COMPASS[lead[1]!.toLowerCase()]!;
    return `${word.arrow} ${word.text}`;
  }
  return `direction ${stop.directionId}`;
}

export type CompassKey = 'north' | 'east' | 'south' | 'west';

/** The platform's compass quadrant key — the same honesty ladder as
 * platformDirectionLabel (bearing, then the headsign's own word), but
 * the key the rose places buttons by. Null when neither source speaks. */
export function platformCompassKey(
  stop: StopServiceState,
  features: Feature[],
  patterns: ReadonlyArray<{
    stopIds: string[];
    headsign: string;
    directionId?: 0 | 1;
  }> = [],
): CompassKey | null {
  const compass = platformCompass(stop, features, patterns);
  if (compass) return compass.text.toLowerCase() as CompassKey;
  const lead = /^\s*(east|west|north|south)\b/i.exec(headsignOf(stop, patterns));
  return lead ? (lead[1]!.toLowerCase() as CompassKey) : null;
}

/** The opposite-direction platform(s) of the SELECTED ROUTE at the
 * selected platform's intersection: siblings must share a day route
 * number with the selection, so switching route in the box above
 * switches the rose's options with it — a rider who picked 504 must
 * never be offered 510's northbound platform as a "direction". */
export function directionSiblings(
  selected: StopServiceState,
  features: Feature[],
  statesByStop: Map<string, StopServiceState>,
): StopServiceState[] {
  const ownRoutes = new Set(
    platformRoutes(selected.routeIds, []).map((route) => route.number),
  );
  return intersectionStates(selected, features, statesByStop).filter(
    (state) =>
      state.stopId !== selected.stopId &&
      state.directionId !== selected.directionId &&
      platformRoutes(state.routeIds, []).some((route) => ownRoutes.has(route.number)),
  );
}

/** The sibling boarding direction(s) of the selected platform (see
 * directionSiblings), labeled in compass words when the coordinates
 * allow, headsign words otherwise. Empty when this stop rides alone. */
export function directionOptions(
  selected: StopServiceState,
  features: Feature[],
  statesByStop: Map<string, StopServiceState>,
  patterns: ReadonlyArray<{
    stopIds: string[];
    headsign: string;
    directionId?: 0 | 1;
  }> = [],
): DirectionOption[] {
  return directionSiblings(selected, features, statesByStop).map((state) => ({
    stopId: state.stopId,
    label: platformDirectionLabel(state, features, patterns),
  }));
}

/** The worse of two platforms — the field's shared-position rule: where
 * two directions share one dot, the eye should find the pain, and the
 * merged card headlines it. Monitored states rank by elapsed minutes (null
 * only for blind spots, which lose to any verdict); ties keep the first.
 * Deterministic; tests hold it to it. */
export function worstPlatform(
  a: StopServiceState,
  b: StopServiceState,
): StopServiceState {
  const rank = (state: StopServiceState) => state.minutesSince ?? -1;
  return rank(b) > rank(a) ? b : a;
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
export const STREAM_WIDTH = 1.25;
/** Keeps service streams at least three CSS pixels at corridor zoom. */
export function streamWidth(scale: number): number {
  return Math.max(STREAM_WIDTH, scale > 0 ? 3 / scale : STREAM_WIDTH);
}

export interface DisplayPoint {
  x: number;
  y: number;
  angle: number;
}

/** Returns screen-independent geometry at a display-space distance. */
export function pointAtDisplayDistance(
  segment: Pick<TrackSegment, 'x1' | 'y1' | 'x2' | 'y2' | 'flowsForward'>,
  distance: number,
): DisplayPoint {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const length = Math.hypot(dx, dy) || 1;
  const ratio = Math.max(0, Math.min(1, distance / length));
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    x: segment.x1 + dx * ratio,
    y: segment.y1 + dy * ratio,
    angle: segment.flowsForward ? angle : angle + 180,
  };
}

export interface SeverityCrossing extends DisplayPoint {
  kind: 'fresh-due' | 'due-void';
}

/** Finds severity-front positions between adjacent painted pieces. */
export function severityCrossings(
  segments: readonly TrackSegment[],
  config: ServiceConfig = serviceConfig(),
): SeverityCrossing[] {
  const crossings: SeverityCrossing[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const before = segments[index - 1]!;
    const after = segments[index]!;
    if (before.directionId !== after.directionId) continue;
    if (before.dryness === null || after.dryness === null) continue;
    for (const [threshold, kind] of [
      [config.freshDrynessRatio, 'fresh-due'],
      [config.voidDrynessRatio, 'due-void'],
    ] as const) {
      if (before.dryness < threshold === after.dryness < threshold) continue;
      const span = after.dryness - before.dryness || 1;
      const amount = (threshold - before.dryness) / span;
      const beforeMid = pointAtDisplayDistance(
        before,
        Math.hypot(before.x2 - before.x1, before.y2 - before.y1) / 2,
      );
      const afterMid = pointAtDisplayDistance(
        after,
        Math.hypot(after.x2 - after.x1, after.y2 - after.y1) / 2,
      );
      const x = beforeMid.x + (afterMid.x - beforeMid.x) * amount;
      const y = beforeMid.y + (afterMid.y - beforeMid.y) * amount;
      crossings.push({
        ...pointAtDisplayDistance(
          { ...before, x1: beforeMid.x, y1: beforeMid.y, x2: afterMid.x, y2: afterMid.y },
          0,
        ),
        x,
        y,
        kind,
      });
    }
  }
  return crossings;
}
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
  /** Synthetic edge anchor that holds the inner value only up to the cap. */
  hold?: boolean;
}

export interface EdgeSeamValue {
  directionId: 0 | 1;
  at: 'start' | 'end';
  dryness: number;
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
        // A null value is blind even if the state payload is inconsistent.
        // It must never become a fresh value through numeric coercion.
        blind: true,
      });
    }
  }
  anchors.sort((a, b) => a.distance - b.distance);
  return anchors;
}

/** The nearest measured boundary value, used only to continue a paint field
 * across a route-continuous edge seam. Blind boundaries are intentionally not
 * returned: a seam may borrow a real value, never another blind value. */
export function edgeBoundaryAnchors(
  edge: Edge,
  features: Feature[],
  statesByStop: ReadonlyMap<string, StopServiceState>,
): EdgeSeamValue[] {
  const values: EdgeSeamValue[] = [];
  for (const directionId of [0, 1] as const) {
    const anchors = anchorsOfEdge(edge, features, statesByStop, directionId).filter(
      (anchor) => !anchor.blind && anchor.dryness !== null,
    );
    if (anchors.length === 0) continue;
    values.push(
      { directionId, at: 'start', dryness: anchors[0]!.dryness! },
      { directionId, at: 'end', dryness: anchors.at(-1)!.dryness! },
    );
  }
  return values;
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
  if (lower.blind)
    return lower.hold && high.dryness !== null
      ? { dryness: high.dryness, blind: false }
      : { dryness: null, blind: true };
  if (high.blind)
    return high.hold && lower.dryness !== null
      ? { dryness: lower.dryness, blind: false }
      : { dryness: null, blind: true };
  // Smoothstep: the transition spends its change slowly near each stop, so
  // neighbouring colours blend instead of stepping (the softer gradient).
  const eased = u * u * (3 - 2 * u);
  if (lower.dryness === null || high.dryness === null)
    return { dryness: null, blind: true };
  return { dryness: lower.dryness * (1 - eased) + high.dryness * eased, blind: false };
}

/**
 * Applies the paint-only smoothing contract. A single blind anchor may be
 * treated as a local interpolation point; refused runs remain genuinely grey.
 * Synthetic edge anchors implement the one-sided cap without changing source
 * data or the stop state machine.
 */
function paintAnchors(anchors: Anchor[], config: ServiceConfig): Anchor[] {
  const visible = anchors.filter((anchor) => !anchor.blind && anchor.dryness !== null);
  if (visible.length === 0) return anchors;
  const result = anchors.map((anchor) => ({ ...anchor }));
  for (let index = 0; index < result.length; index += 1) {
    if (!result[index]!.blind) continue;
    let end = index;
    while (end + 1 < result.length && result[end + 1]!.blind) end += 1;
    const before = result[index - 1];
    const after = result[end + 1];
    if (before && after && !before.blind && !after.blind) {
      const blindCount = end - index + 1;
      const span = after.distance - before.distance;
      const voidAdjacent =
        (before.dryness ?? 0) >= config.voidDrynessRatio ||
        (after.dryness ?? 0) >= config.voidDrynessRatio;
      const cap = voidAdjacent ? config.voidBridgeMaxMetres : config.bridgeMaxMetres;
      if (blindCount === 1 && span <= cap) {
        const ratio = (result[index]!.distance - before.distance) / (span || 1);
        result[index] = {
          ...result[index]!,
          dryness: before.dryness! + (after.dryness! - before.dryness!) * ratio,
          blind: false,
        };
      }
    } else if (index === 0 && after && !after.blind) {
      const voidAdjacent = (after.dryness ?? 0) >= config.voidDrynessRatio;
      result.unshift({
        distance:
          after.distance -
          (voidAdjacent ? config.voidBridgeMaxMetres : config.bridgeMaxMetres),
        dryness: null,
        blind: true,
        hold: true,
      });
      for (let blindIndex = 1; blindIndex <= end + 1; blindIndex += 1)
        result[blindIndex] = { ...result[blindIndex]!, hold: true };
      index += 1;
      end += 1;
    } else if (end === result.length - 1 && before && !before.blind) {
      const voidAdjacent = (before.dryness ?? 0) >= config.voidDrynessRatio;
      for (let blindIndex = index; blindIndex <= end; blindIndex += 1)
        result[blindIndex] = { ...result[blindIndex]!, hold: true };
      result.push({
        distance:
          before.distance +
          (voidAdjacent ? config.voidBridgeMaxMetres : config.bridgeMaxMetres),
        dryness: null,
        blind: true,
        hold: true,
      });
    }
    index = end;
  }
  return result.sort((a, b) => a.distance - b.distance);
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

/** The continuous ramp the track paints with: fresh at r=0, amber at the
 * fresh/due boundary feel (r=1), full void red at the void horizon (r=2),
 * deepening slightly beyond. Null (blind/collecting) greys the stretch. */
export function drynessColor(
  dryness: number | null,
  state?: FieldState,
  theme: FieldTheme = 'light',
  colourMode: ColourMode = 'standard',
): string {
  return drynessColour(dryness, state, theme, colourMode);
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
  seamValues: readonly EdgeSeamValue[] = [],
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
    const rawAnchors = anchorsOfEdge(edge, features, statesByStop, directionId);
    const distancesAtEnds = [distances[0]!, distances.at(-1)!];
    const seams = seamValues.filter((seam) => seam.directionId === directionId);
    for (const seam of seams) {
      const atStart = seam.at === 'start';
      const boundary = atStart ? rawAnchors[0] : rawAnchors.at(-1);
      if (!boundary?.blind) continue;
      rawAnchors.push({
        distance: atStart ? distancesAtEnds[0] : distancesAtEnds[1],
        dryness: seam.dryness,
        blind: false,
      });
    }
    rawAnchors.sort((a, b) => a.distance - b.distance);
    const anchors = paintAnchors(rawAnchors, config);
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

/** Indexes physical edge neighbours that can form a route-continuous seam. */
export function edgeNeighboursByRoute(
  edges: ReadonlyArray<Pick<Edge, 'id' | 'a' | 'b' | 'routeIds'>>,
): Map<string, string[]> {
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) neighbours.set(edge.id, []);
  for (let left = 0; left < edges.length; left += 1) {
    for (let right = left + 1; right < edges.length; right += 1) {
      const a = edges[left]!;
      const b = edges[right]!;
      const sharedRoute = a.routeIds.some((route) => b.routeIds.includes(route));
      const sharedEndpoint = a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b;
      if (!sharedRoute || !sharedEndpoint) continue;
      neighbours.get(a.id)!.push(b.id);
      neighbours.get(b.id)!.push(a.id);
    }
  }
  for (const ids of neighbours.values()) ids.sort();
  return neighbours;
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
  theme: FieldTheme = 'light',
  colourMode: ColourMode = 'standard',
): string | null {
  const anchors = anchorsOfEdge(edge, features, statesByStop, directionId);
  if (anchors.length === 0) return null;
  const sample = sampleAt(anchors, distanceAlongMetres);
  const state = stateOf(sample.dryness, sample.blind, config);
  return drynessColor(sample.blind ? null : sample.dryness, state, theme, colourMode);
}

/** Cumulative display distances along a polyline. Geometry is static per
 * map version (the same `points` array object every repaint), so results
 * are memoised by array identity (E4S5, docs/optimize-overlay.md): the old
 * per-recall recompute rebuilt every edge's distances on every repaint. */
const cumulativeCache = new WeakMap<object, number[]>();

function cumulative(points: Array<[number, number]>): number[] {
  const cached = cumulativeCache.get(points);
  if (cached) return cached;
  const distances: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1];
    const [x2, y2] = points[index];
    distances.push(distances[index - 1] + Math.hypot(x2 - x1, y2 - y1));
  }
  cumulativeCache.set(points, distances);
  return distances;
}

// ---------------------------------------------------------------------------
// The engine (docs/optimize-overlay.md E4S2): wake on truth, not on a timer.
// Dryness grows one second per second, so a stop's next *visible* change is
// computable exactly — the heartbeat schedules at the earliest actual change
// instead of sampling at 1 Hz. Fewer wakes than a clock AND transitions land
// at the true moment, not the next tick of an interval.
// ---------------------------------------------------------------------------

/** The quantisation the field's paint and signature work in (0.25 dryness
 * steps — see trackFieldSignature): the finest change a wake can serve. */
export const DRYNESS_STEP = 0.25;

/** The selected stop's card shows elapsed minutes to one decimal, so its
 * label crossing is a visible change too — the one per-stop cadence the
 * deadline engine honours beyond the shared steps (bounded to a single
 * stop: the card, not the whole map). */
const CARD_MINUTE_STEP = 0.1;

/** The ms until this stop's next *visible* change — the exact inverse of
 * `advanceStopState`: the earliest of the next 0.25-quantised dryness step
 * (the repaint gate), the next state boundary the colour ramp speaks in
 * (fresh→due at freshDrynessRatio, due→void at voidDrynessRatio), and the
 * void-absolute crossing (minutes, not ratio). A stop whose card is open
 * also wakes at its next 0.1-minute label crossing. The math is relative —
 * elapsed grows one second per second from the state itself — so there is
 * no clock input. Blind and collecting stops never change between ticks —
 * a blind spot never advances into a verdict — so they never schedule
 * (Infinity). */
export function nextStopChangeMs(
  stop: StopServiceState,
  config: ServiceConfig = serviceConfig(),
  cardOpen = false,
): number {
  if (stop.state === 'unmonitored' || stop.state === 'collecting') return Infinity;
  const medianSeconds = stop.medianHeadwayOwnSeconds;
  if (stop.minutesSince === null || medianSeconds === null || stop.dryness === null) {
    return Infinity;
  }
  // dryness = minutesSince·60 / medianSeconds ⇒ every candidate below is
  // (target − dryness)·medianSeconds·1000 ms away.
  const dryness = stop.dryness;
  // The repaint gate flips when the SIGNATURE'S quantisation moves:
  // Math.round(dryness / DRYNESS_STEP) increments at the half-steps
  // (…, 1.125, 1.375 …), not at the 0.25 multiples — schedule at the midpoints.
  const step = (Math.round(dryness / DRYNESS_STEP) + 0.5) * DRYNESS_STEP;
  let earliest = (step - dryness) * medianSeconds * 1000;
  // The state boundary the ramp speaks in — whichever it is heading toward.
  const boundary =
    stop.state === 'fresh'
      ? config.freshDrynessRatio
      : stop.state === 'due'
        ? config.voidDrynessRatio
        : null;
  if (boundary !== null && boundary > dryness) {
    earliest = Math.min(earliest, (boundary - dryness) * medianSeconds * 1000);
  }
  // The absolute void horizon can fire before the ratio does (a long
  // headway route left waiting past voidAbsoluteMinutes) — and only then.
  if (stop.state !== 'void') {
    const untilAbsolute = (config.voidAbsoluteMinutes - stop.minutesSince) * 60_000;
    if (untilAbsolute > 0) earliest = Math.min(earliest, untilAbsolute);
  }
  if (cardOpen) {
    const label =
      (Math.floor(stop.minutesSince / CARD_MINUTE_STEP) + 1) * CARD_MINUTE_STEP;
    const untilLabel = (label - stop.minutesSince) * 60_000;
    if (untilLabel > 0) earliest = Math.min(earliest, untilLabel);
  }
  return earliest;
}

/** The earliest next visible change across the stops that matter to the
 * renderer — the wake deadline the scheduler clamps (≥ 250 ms so a step
 * never lands early, ≤ 5 s as the safety re-check: camera moves, selection
 * changes and feed ticks all reschedule sooner). Infinity when nothing can
 * change (no live stops) — the caller's safety clamp owns that case.
 * `visibleStopIds` (E4S1) narrows the engine to the on-screen stops —
 * off-screen anchors are tick-stable by construction (E4S5: they are not
 * advanced between ticks), so scheduling for them is pure waste; the
 * selected stop always stays in (its card speaks even from off-screen). */
export function earliestDeadlineMs(
  states: ReadonlyMap<string, StopServiceState>,
  options: {
    selectedStopId?: string | null;
    visibleStopIds?: ReadonlySet<string> | null;
    config?: ServiceConfig;
  } = {},
): number {
  let earliest = Infinity;
  for (const [stopId, stop] of states) {
    if (options.visibleStopIds && !options.visibleStopIds.has(stopId)) {
      if (stopId !== options.selectedStopId) continue;
    }
    const ms = nextStopChangeMs(
      stop,
      options.config ?? serviceConfig(),
      stopId === options.selectedStopId,
    );
    if (ms < earliest) earliest = ms;
  }
  return earliest;
}

/** A cheap change-signature for the field's track anchors: the quantised
 * dryness (0.25 steps) and state per anchored stop. The track band recomputes
 * only when this value changes — the heartbeat advances, but the paint
 * shifts only when the field actually moves a visible step.
 *
 * E4S5 (docs/optimize-overlay.md): the value is a NUMBER — a 32-bit FNV-1a
 * over exactly the fields the old string carried (stop id, quantised
 * dryness, state), computed with zero per-stop string allocations: the old
 * O(stops) string join ran on every wake. A collision costs one missed
 * repaint until the next visible change — benign, and vanishingly rare
 * against a 32-bit mix. */
const STATE_HASH_INDEX: Record<StopServiceState['state'], number> = {
  fresh: 1,
  due: 2,
  void: 3,
  unmonitored: 4,
  collecting: 5,
};

export function trackFieldSignature(
  features: Feature[],
  statesByStop: ReadonlyMap<string, StopServiceState>,
): number {
  let hash = 2166136261;
  for (const feature of features) {
    for (const stopId of feature.stopIds ?? []) {
      const state = statesByStop.get(stopId);
      if (!state) continue;
      for (let index = 0; index < stopId.length; index += 1) {
        hash ^= stopId.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      const dryness =
        state.dryness === null ? -1 : Math.round(state.dryness / DRYNESS_STEP);
      hash = Math.imul(hash ^ dryness, 16777619);
      hash = Math.imul(hash ^ STATE_HASH_INDEX[state.state], 16777619);
    }
  }
  return hash;
}

/** The stops whose boarding points sit inside (or near) the camera — the
 * set the engine advances and schedules for (docs/optimize-overlay.md
 * E4S1). `camera` is the map's viewBox: the visible world rect itself.
 * `margin` grows the rect by that fraction of its size on every side, so a
 * fast pan keeps the field painted past the screen edge until the settled
 * camera recomputes. Pure; no per-frame state. */
export function visibleStopsOf(
  features: Feature[],
  camera: { x: number; y: number; width: number; height: number },
  margin = 0.5,
): ReadonlySet<string> {
  const growX = camera.width * margin;
  const growY = camera.height * margin;
  const left = camera.x - growX;
  const right = camera.x + camera.width + growX;
  const top = camera.y - growY;
  const bottom = camera.y + camera.height + growY;
  const visible = new Set<string>();
  for (const feature of features) {
    const [x, y] = feature.point;
    if (x >= left && x <= right && y >= top && y <= bottom) {
      for (const stopId of feature.stopIds ?? []) visible.add(stopId);
    }
  }
  return visible;
}

/** The edges whose geometry comes anywhere near the camera — the cull set
 * for the painted field (docs/optimize-overlay.md E5S1). Conservative by
 * construction: an edge qualifies when its bounding box intersects the
 * margin-grown rect, so a diagonal stretch whose endpoints both sit outside
 * still paints (over-inclusion costs a few extra static lines; under-
 * inclusion would leave a hole in the field). O(edge points) per call, and
 * it only runs when the camera settles — never per frame. */
export function visibleEdgesOf(
  edges: ReadonlyArray<{ id: string; points: ReadonlyArray<readonly [number, number]> }>,
  camera: { x: number; y: number; width: number; height: number },
  margin = 0.5,
): ReadonlySet<string> {
  const growX = camera.width * margin;
  const growY = camera.height * margin;
  const left = camera.x - growX;
  const right = camera.x + camera.width + growX;
  const top = camera.y - growY;
  const bottom = camera.y + camera.height + growY;
  const visible = new Set<string>();
  for (const edge of edges) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of edge.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX >= left && minX <= right && maxY >= top && minY <= bottom) {
      visible.add(edge.id);
    }
  }
  return visible;
}
