/** Service-stops tick documents — the CDN-published overlay contract
 * (docs/optimize-overlay.md Epic 1; the stops twin of realtime/tick-doc.ts).
 *
 * One immutable JSON object per 30-second tick is published to the public
 * live R2 bucket beside the vehicles document, at
 * `live/t/<tickId>/service-stops.json`. The bytes are identical for every
 * user — broadcast data only: per-directional-stop delivered-service
 * states, never identity or location. Format variants are paths, never
 * query strings (optimize-transport.md change 1).
 *
 * The client's error contract is the document itself — the same three
 * cases as the fleet tick doc: 200 → use it; 404 → the tick is not
 * published yet → retry `tickId − 1` once → else keep last-good with age;
 * network error → offline → keep last-good. No 5xx parsing, no fallback
 * host.
 *
 * Honesty ladder, inherited from the recorder (sla.md §3.6):
 *   - A feed outage is NOT this document's outage. It surfaces as honest
 *     per-stop `unmonitored` state inside a normal document — a blind spot
 *     is never a void, and a blind network is never an outage doc.
 *   - `states: null` means the recorder itself could not assemble the
 *     field this tick — the *outage doc* `{ states: [], outage }`. It is
 *     still valid, cacheable broadcast data; publishing it keeps the CDN
 *     path honest through a recorder-side failure instead of silently
 *     serving a stale tick as fresh.
 *   - An empty states array (a window with nothing in it) is **not** an
 *     outage — it publishes as-is, without the `outage` field.
 *
 * This module is PURE: no I/O, no clock reads. The recorder supplies the
 * tick id it already derived from its alarm schedule, so publishing and
 * requesting agree on the grid by construction — the shared 30 s grid in
 * shared/live/config.ts, never shifted. Unit tests:
 * tests/service/stops-tick-doc.test.mjs. */

import type { StopServiceState, TouchEvent } from '../../../../shared/service/contracts';
// The shared tick grid lives in shared/live/config.ts (single source for
// recorder + clients); re-exported here for the tick-document test surface.
export { tickIdAt } from '../../../../shared/live/config';

/** `outage.since` is the start of the tick that could not assemble the
 * field — the finest honesty the 30 s grid can express. ISO timestamp. */
export interface StopsTickOutage {
  since: string;
  tickId: number;
}

/** The published per-tick stops document. `at` is the tick start (epoch
 * ms) — the same tick quantization the interim /states route always
 * served, so client heartbeat-advancement math is unchanged. */
export interface StopsTickDocument {
  schemaVersion: 1;
  at: number;
  tickId: number;
  states: StopServiceState[];
  outage?: StopsTickOutage;
}

/** Round the continuous fields for the wire: three decimals is far finer
 * than the 30 s sampling resolution, and it keeps worst-case payloads
 * (~3 k active stops) inside the fleet endpoint's size discipline. Pure —
 * the same rounding serves the published document and (until Epic 3
 * removes it) the interim /states response, so both paths ship identical
 * bytes. Idempotent on already-rounded values. */
export function wireReadyStopState(state: StopServiceState): StopServiceState {
  const round = (value: number | null, decimals: number): number | null =>
    value === null ? null : Number(value.toFixed(decimals));
  return {
    ...state,
    minutesSince: round(state.minutesSince, 3),
    medianHeadwayOwnSeconds: round(state.medianHeadwayOwnSeconds, 3),
    irregularity: round(state.irregularity, 4),
    expectedWaitSeconds: round(state.expectedWaitSeconds, 3),
    dryness: round(state.dryness, 4),
  };
}

/** The wire-ready payload for one tick (optimize-overlay.md E1S2): every
 * live stop state with its route ids merged from the two honest sources —
 * the window's own touches (what actually served the stop) and the
 * network's route membership (what the map's own stops say) — then rounded
 * once. Iteration follows the states map's own order, so the payload is
 * deterministic for a given window. Pure: the network is an injected
 * lookup, never a D1 read. */
export function assembleStopsPayload(
  states: ReadonlyMap<string, StopServiceState>,
  touches: readonly TouchEvent[],
  routesOfStop: (stopId: string) => readonly string[],
): StopServiceState[] {
  const routesByStop = new Map<string, Set<string>>();
  for (const touch of touches) {
    const bucket = routesByStop.get(touch.stopId) ?? new Set<string>();
    bucket.add(touch.routeId);
    routesByStop.set(touch.stopId, bucket);
  }
  const payload: StopServiceState[] = [];
  for (const state of states.values()) {
    const routes = new Set(routesByStop.get(state.stopId));
    for (const route of routesOfStop(state.stopId)) routes.add(route);
    payload.push(wireReadyStopState({ ...state, routeIds: [...routes].sort() }));
  }
  return payload;
}

/** Build one immutable stops tick document from the recorder's per-tick
 * payload assembly.
 *
 * `null` states (the recorder could not assemble the field at all) yields
 * an outage doc. An empty array (an empty window) is **not** an outage: it
 * publishes as-is, without the `outage` field. */
export function buildStopsTickDocument(
  states: StopServiceState[] | null,
  tickId: number,
  fallback: { tickMs?: number } = {},
): StopsTickDocument {
  const tickMs = fallback.tickMs ?? 30_000;
  const at = tickId * tickMs;
  if (states === null) {
    // Tick start is derivable from the grid, so the doc stays pure.
    const since = new Date(at).toISOString();
    return { schemaVersion: 1, at, tickId, states: [], outage: { since, tickId } };
  }
  return { schemaVersion: 1, at, tickId, states: states.map(wireReadyStopState) };
}
