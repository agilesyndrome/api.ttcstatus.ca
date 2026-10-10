/** The recorder core (sla.md stories 1.3, 1.4, 1.6): a pure state machine —
 * (snapshot, state) → (touches, coverage updates, state). No I/O, ever; the
 * DO shell does the fetching and persisting. Streetcar fixes are matched to
 * the track (reuse of matchGpsToTrack with previous-edge continuity), subway
 * touches fire when a train's first upcoming station advances past a station,
 * and dwell dedupe keeps a terminal layover to one service. Direction is a
 * first-class dimension (§3.8): a confident fix is never credited to the
 * wrong direction's stop, and an unresolvable fix is flagged `ambiguous`
 * rather than silently guessed. */

import type {
  CoverageInterval,
  ServiceMode,
  TouchEvent,
} from '../../../../shared/service/contracts';
import type { ServiceConfig } from '../../../../shared/service/config';
import { matchGpsToTrack } from '../../../../shared/map/projection';
import { metresBetween, projectToLocalMetres } from '../../../../shared/map/geometry';
import { vehicleIsStale, type VehicleSnapshot } from '../../../../shared/live/vehicles';
import type { RecorderNetwork } from './network';

export interface CoverageRun {
  kind: 'observable' | 'outage' | 'no-reports';
  from: number;
}

export interface RecorderCounters {
  streetcarTouches: number;
  subwayTouches: number;
  outageTicks: number;
  noReportTicks: number;
}

export interface RecorderState {
  /** Per-vehicle last matched edge id — continuity for matchGpsToTrack. */
  lastEdgeByVehicle: Map<string, string>;
  /** Dwell dedupe: `${vehicleId}|${stopId}` → last touch time (epoch ms). */
  lastTouchAt: Map<string, number>;
  /** Subway: train id → the station currently reported as first upcoming. */
  subwayUpcoming: Map<
    string,
    { stopId: string; sequence: number; arrivalAt: number | null }
  >;
  /** Subway idempotency: `${trainId}|${stationId}` already touched. */
  subwayTouched: Set<string>;
  /** The still-open coverage run per mode. */
  coverageRuns: { streetcar: CoverageRun | null; subway: CoverageRun | null };
}

export function initialRecorderState(): RecorderState {
  return {
    lastEdgeByVehicle: new Map(),
    lastTouchAt: new Map(),
    subwayUpcoming: new Map(),
    subwayTouched: new Set(),
    coverageRuns: { streetcar: null, subway: null },
  };
}

export interface TickInput {
  now: number;
  config: ServiceConfig;
  /** Null before the network bootstrap completes — detection waits, coverage
   * does not. */
  network: RecorderNetwork | null;
  /** Null when both feeds were down (an outage — never fabricated). */
  snapshot: VehicleSnapshot | null;
  state: RecorderState;
}

export interface TickOutput {
  touches: TouchEvent[];
  /** Coverage runs that ended this tick (persisted as intervals). */
  coverageClosed: CoverageInterval[];
  counters: RecorderCounters;
  state: RecorderState;
}

/** Serialize/deserialize the state for DO storage (Maps/Sets → JSON). */
export function serializeRecorderState(state: RecorderState): string {
  return JSON.stringify({
    lastEdgeByVehicle: [...state.lastEdgeByVehicle.entries()],
    lastTouchAt: [...state.lastTouchAt.entries()],
    subwayUpcoming: [...state.subwayUpcoming.entries()],
    subwayTouched: [...state.subwayTouched.values()],
    coverageRuns: state.coverageRuns,
  });
}

export function deserializeRecorderState(text: string | null | undefined): RecorderState {
  if (!text) return initialRecorderState();
  const raw = JSON.parse(text) as {
    lastEdgeByVehicle: Array<[string, string]>;
    lastTouchAt: Array<[string, number]>;
    subwayUpcoming: Array<
      [string, { stopId: string; sequence: number; arrivalAt: number | null }]
    >;
    subwayTouched: string[];
    coverageRuns: { streetcar: CoverageRun | null; subway: CoverageRun | null };
  };
  return {
    lastEdgeByVehicle: new Map(raw.lastEdgeByVehicle ?? []),
    lastTouchAt: new Map(raw.lastTouchAt ?? []),
    subwayUpcoming: new Map(raw.subwayUpcoming ?? []),
    subwayTouched: new Set(raw.subwayTouched ?? []),
    coverageRuns: raw.coverageRuns ?? { streetcar: null, subway: null },
  };
}

/** One acquisition cycle, pure. `snapshot` null means both feeds were down:
 * coverage records the outage; no touch is ever fabricated. */
export function processTick(input: TickInput): TickOutput {
  const state = input.state;
  const touches: TouchEvent[] = [];
  const counters: RecorderCounters = {
    streetcarTouches: 0,
    subwayTouches: 0,
    outageTicks: 0,
    noReportTicks: 0,
  };
  const streetcarKind =
    input.snapshot?.surfaceStatus === 'available' ? 'observable' : 'outage';
  const subwayKind = subwayCoverageKind(input.snapshot);
  if (streetcarKind === 'outage' && subwayKind === 'outage') counters.outageTicks += 1;
  if (subwayKind === 'no-reports') counters.noReportTicks += 1;

  if (input.snapshot && input.network) {
    if (streetcarKind === 'observable') {
      const emitted = streetcarTouches(input, state);
      counters.streetcarTouches = emitted.length;
      touches.push(...emitted);
    }
    if (subwayKind !== 'outage') {
      const emitted = subwayTouches(input, state);
      counters.subwayTouches = emitted.length;
      touches.push(...emitted);
    }
  }

  const coverageClosed = updateCoverageRuns(state, input.now, {
    streetcar: streetcarKind,
    subway: subwayKind,
  });
  return { touches, coverageClosed, counters, state };
}

/** Streetcar detection (stories 1.3 + 1.4): fresh fixes only, matched to the
 * route's edges with continuity, direction corroborated by the matched edge's
 * pattern, dwell-deduped per (vehicle, stop). */
function streetcarTouches(input: TickInput, state: RecorderState): TouchEvent[] {
  const { config, network, snapshot, now } = input;
  if (!network) return [];
  const sampleMs = config.sampleSeconds * 1000;
  // Interval-censored to the 30 s sample: the touch happened inside this tick.
  const touchedAt = Math.floor(now / sampleMs) * sampleMs;
  const touches: TouchEvent[] = [];
  for (const vehicle of snapshot?.vehicles ?? []) {
    if (vehicleIsStale(vehicle, snapshot!, now)) continue; // §4.6 rule 3
    if (vehicle.mode === 'subway') continue; // predictions, not GPS
    const routeId = vehicle.routeId;
    const edges = (routeId && network.edgesByRoute.get(routeId)) || [];
    if (
      edges.length === 0 ||
      !Number.isFinite(vehicle.latitude) ||
      !Number.isFinite(vehicle.longitude)
    )
      continue;
    const match = matchGpsToTrack(edges, vehicle.latitude, vehicle.longitude, {
      routeId,
      bearing: vehicle.bearing,
      previousEdgeId: state.lastEdgeByVehicle.get(vehicle.id),
      maxDistanceMetres: 100,
    });
    if (!match) continue;
    state.lastEdgeByVehicle.set(vehicle.id, match.edgeId);
    const pattern = [...network.patterns.values()].find(
      (entry) => entry.edgeId === match.edgeId,
    );
    const edgeDirection = pattern?.directionId ?? null;
    const fixLocal = projectToLocalMetres([vehicle.latitude, vehicle.longitude]);
    const candidates = (network.stopsByRoute.get(routeId!) ?? [])
      .map((stopId) => network.stops.get(stopId))
      .filter((stop): stop is NonNullable<typeof stop> => Boolean(stop))
      .map((stop) => ({ stop, distance: metresBetween(fixLocal, stop.local) }))
      .filter((candidate) => candidate.distance <= config.touchRadiusMetres)
      .sort((a, b) => a.distance - b.distance);
    if (candidates.length === 0) continue;
    // Direction corroboration (§3.8): the matched edge's pattern direction
    // picks the platform. Confident when the directions agree — never credit
    // the wrong direction's stop then. Otherwise record the nearest candidate
    // with the honest `ambiguous` diagnostic instead of a silent guess.
    const confident = candidates.find(
      (candidate) => candidate.stop.directionId === edgeDirection,
    );
    const ambiguous = !confident;
    const target = confident ?? candidates[0];
    const key = `${vehicle.id}|${target.stop.stopId}`;
    const last = state.lastTouchAt.get(key);
    if (last !== undefined && now - last < config.dwellDedupeSeconds * 1000) continue; // one service, not five
    state.lastTouchAt.set(key, touchedAt);
    const touch: TouchEvent = {
      t: touchedAt,
      stopId: target.stop.stopId,
      directionId: target.stop.directionId ?? 0,
      mode: 'streetcar',
      vehicleId: vehicle.id,
      routeId: routeId!,
    };
    if (ambiguous) touch.ambiguous = true;
    touches.push(touch);
  }
  return touches;
}

/** Subway detection (story 1.4): prediction-aging touches (sla.md §4.4). A
 * touch for station X fires when the train's first upcoming station advances
 * past X; idempotent per (train, station); never fabricated for stations
 * passed before first sight; direction follows the reported station sequence
 * order. */
function subwayTouches(input: TickInput, state: RecorderState): TouchEvent[] {
  const { network, now } = input;
  if (!network) return [];
  const predictions = input.snapshot?.subwayPredictions ?? [];
  const touches: TouchEvent[] = [];
  for (const prediction of [...predictions].sort((a, b) => a.id.localeCompare(b.id))) {
    const stops = [...prediction.stops].sort((a, b) => a.sequence - b.sequence);
    if (stops.length === 0) continue;
    const upcoming = {
      stopId: stops[0].stopId,
      sequence: stops[0].sequence,
      arrivalAt: stops[0].arrivalAt,
    };
    const previous = state.subwayUpcoming.get(prediction.id);
    state.subwayUpcoming.set(prediction.id, {
      stopId: upcoming.stopId,
      sequence: upcoming.sequence,
      arrivalAt: parseTime(upcoming.arrivalAt),
    });
    if (!previous) continue; // first sight mid-route: no fabricated pre-sight touches
    if (previous.stopId === upcoming.stopId) continue; // nothing advanced
    // The upcoming list is sequence-ordered, so if the previous first-upcoming
    // is still listed while another station is first, the prediction flapped
    // backwards — no touch. (A real advance consumes the station instead.)
    const stillListed = stops.find((stop) => stop.stopId === previous.stopId);
    if (stillListed) continue;
    const key = `${prediction.id}|${previous.stopId}`;
    if (state.subwayTouched.has(key)) continue; // flapping never double-counts
    state.subwayTouched.add(key);
    const observedAt = parseTime(prediction.observedAt);
    const arrivalAt = previous.arrivalAt;
    const timestamp =
      arrivalAt !== null && observedAt !== null
        ? Math.max(arrivalAt, observedAt)
        : (arrivalAt ?? observedAt ?? now);
    const direction = subwayDirection(network, previous.stopId, upcoming.stopId);
    const touch: TouchEvent = {
      t: timestamp,
      stopId: previous.stopId,
      directionId: direction.directionId,
      mode: 'subway',
      vehicleId: prediction.id,
      routeId: prediction.routeId,
    };
    if (direction.ambiguous) touch.ambiguous = true;
    touches.push(touch);
  }
  return touches;
}

/** Direction from the reported station sequence order (§3.8): the travel pair
 * X → Y matches exactly one directional pattern's order; if no pattern
 * contains both, the assignment is honestly ambiguous. */
function subwayDirection(
  network: RecorderNetwork,
  fromStopId: string,
  toStopId: string,
): { directionId: 0 | 1; ambiguous: boolean } {
  for (const pattern of network.patterns.values()) {
    const fromIndex = pattern.stopIds.indexOf(fromStopId);
    if (fromIndex < 0) continue;
    const toIndex = pattern.stopIds.indexOf(toStopId);
    if (toIndex > fromIndex)
      return { directionId: pattern.directionId, ambiguous: false };
  }
  return { directionId: 0, ambiguous: true };
}

/** Feed up, zero reports: a silent subway feed is `no-reports` — a coverage
 * gap, not evidence of anything (sla.md §4.6 rule 2). */
function subwayCoverageKind(snapshot: VehicleSnapshot | null): CoverageRun['kind'] {
  if (!snapshot || snapshot.subwayStatus !== 'available') return 'outage';
  return (snapshot.subwayPredictions?.length ?? 0) === 0 ? 'no-reports' : 'observable';
}

/** Close coverage runs when the kind flips; open the new run at `now`. */
function updateCoverageRuns(
  state: RecorderState,
  now: number,
  desired: Record<ServiceMode, CoverageRun['kind']>,
): CoverageInterval[] {
  const closed: CoverageInterval[] = [];
  for (const mode of ['streetcar', 'subway'] as const) {
    const want = desired[mode];
    const run = state.coverageRuns[mode];
    if (run && run.kind !== want) {
      closed.push({ from: run.from, to: now, mode, kind: run.kind });
      state.coverageRuns[mode] = { kind: want, from: now };
    } else if (!run) {
      state.coverageRuns[mode] = { kind: want, from: now };
    }
  }
  return closed;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
