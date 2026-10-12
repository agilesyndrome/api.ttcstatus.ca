/** Tick documents — the CDN-published fleet snapshot contract
 * (docs/optimize-transport.md change 1/2; stories E1S2, E1S3).
 *
 * One immutable JSON object per 30-second tick is published to the public
 * live R2 bucket at `live/t/<tickId>/vehicles.json` and served to every
 * browser by Cloudflare's cache. The bytes are identical for every user —
 * broadcast data only, never identity or location (see the TRANSPORT
 * CONTRACT in shared/live).
 *
 * The client's entire error contract is the document itself:
 *   - HTTP 200 → use the document. An outage is a *body field*, never a
 *     status: `vehicles: []` plus `outage.since` renders the honest
 *     "service unavailable" state, and `fetchedAt`/`tickId` keep staleness
 *     honest ("never serve stale as fresh" survives the move off 5xx).
 *   - HTTP 404 → the tick is not published yet (device clock ahead of
 *     publish) → retry `tickId − 1` once → else keep last-good with age.
 *   - network error → offline → keep last-good with age.
 * There is no 5xx parsing and no fallback host (the no-fallback doctrine).
 *
 * This module is PURE: no I/O, no clock reads. The recorder supplies the
 * tick id it already derived from its alarm schedule, so publishing and
 * requesting agree on the grid by construction. Unit tests live in
 * tests/live/tick-doc.test.mjs. */

import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
// The shared tick grid lives in shared/live/config.ts (single source for
// recorder + clients); re-exported here for the tick-document test surface.
export { tickIdAt } from '../../../../shared/live/config';

/** `outage.since` is the start of the tick that observed total upstream
 * failure — the finest honesty the 30 s grid can express. ISO timestamp. */
export interface TickOutage {
  since: string;
  tickId: number;
}

/** The published tick document. Superset of the public vehicle response
 * shape (kept byte-compatible for existing clients) plus `tickId`, plus
 * `outage` when the whole upstream was down. */
export interface TickDocument extends VehicleSnapshot {
  tickId: number;
  outage?: TickOutage;
}

/** Build one immutable tick document from the recorder's published snapshot.
 *
 * A `null` snapshot (total upstream failure — the same degradation the
 * recorder already records) yields an *outage doc*: `{ vehicles: [],
 * outage: { since, tickId } }`. It is still valid, cacheable broadcast data;
 * publishing it every tick keeps the CDN path honest through an outage
 * instead of silently serving a stale tick as fresh.
 *
 * An empty-but-valid fleet snapshot (feed up, zero cars) is **not** an
 * outage — it publishes as-is, without the `outage` field. */
export function buildTickDocument(
  snapshot: VehicleSnapshot | null,
  tickId: number,
  fallback: { tickMs?: number; source?: string; attribution?: string } = {},
): TickDocument {
  if (snapshot === null) {
    // Tick start is derivable from the grid, so the doc stays pure.
    const since = new Date(tickId * (fallback.tickMs ?? 30_000)).toISOString();
    return {
      schemaVersion: 1,
      fetchedAt: since,
      feedTimestamp: null,
      // Outage docs keep the source/attribution so clients render the
      // existing attribution instead of a bare error.
      source: fallback.source ?? '',
      attribution: fallback.attribution ?? '',
      vehicles: [],
      invalidPositions: 0,
      outage: { since, tickId },
      tickId,
    };
  }
  return { ...snapshot, tickId };
}