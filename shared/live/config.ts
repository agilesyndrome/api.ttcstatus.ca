/** One runtime setting controls both upstream caching and browser refreshes.
 * Set REALTIME_UPDATE_SECONDS in Wrangler (or the local preview environment). */
export const DEFAULT_LIVE_UPDATE_SECONDS = 30;
export const MIN_LIVE_UPDATE_SECONDS = 30;
export const MAX_LIVE_UPDATE_SECONDS = 300;

export function liveUpdateSeconds(value?: string | number | null): number {
  const seconds = Number(value);
  return Number.isInteger(seconds) &&
    seconds >= MIN_LIVE_UPDATE_SECONDS &&
    seconds <= MAX_LIVE_UPDATE_SECONDS
    ? seconds
    : DEFAULT_LIVE_UPDATE_SECONDS;
}

/** Live transport discovery (docs/optimize-transport.md change 1b). The
 * `live` block of `/api/v1/auth/config`: the *only* source of the live
 * host, cadence, and path template. Clients (including shipped native
 * binaries) fetch it once per launch — nothing is baked in, so hosts,
 * cadence, and paths migrate without an app update. Defaults mirror the
 * deployed wrangler vars; env fields override for staging. */
export const LIVE_DEFAULT_PUBLIC_BASE = 'https://live.ttcstatus.ca';
export const LIVE_DEFAULT_PATH_TEMPLATE = '/live/t/{tick}/vehicles.json';

export interface LiveTransportConfig {
  base: string;
  pathTemplate: string;
  updateSeconds: number;
}

export function liveTransportConfig(
  source: {
    LIVE_PUBLIC_BASE?: string;
    LIVE_PATH_TEMPLATE?: string;
    LIVE_UPDATE_SECONDS?: string;
  } = {},
): LiveTransportConfig {
  return {
    base: source.LIVE_PUBLIC_BASE ?? LIVE_DEFAULT_PUBLIC_BASE,
    pathTemplate: source.LIVE_PATH_TEMPLATE ?? LIVE_DEFAULT_PATH_TEMPLATE,
    updateSeconds: liveUpdateSeconds(source.LIVE_UPDATE_SECONDS),
  };
}

/** Substitute the tick id into the path template — the tick object URL is
 * always `{base}{pathTemplate with {tick} substituted}`. Broadcast data
 * only: the URL never carries identity, location, or query strings. */
export function liveTickPath(pathTemplate: string, tickId: number): string {
  return pathTemplate.replace('{tick}', String(tickId));
}

/** The shared tick grid: `floor(epochMs / (updateSeconds * 1000))`. Clients
 * derive the current tick from their own clock + config cadence; the
 * recorder derives it from its alarm schedule. Publishing and requesting
 * agree by construction — but if those two ever disagree, every client
 * 404s at once and the whole streetcar system has a goddam bad day. Do not
 * shift this grid. */
export function tickIdAt(epochMs: number, updateSeconds: number): number {
  return Math.floor(epochMs / (updateSeconds * 1000));
}

/** The overlay's tick-document path (docs/optimize-overlay.md E1S4): the
 * stops twin of the fleet path — the same tick grid, the same
 * immutability, its own path. Format variants are paths, never query
 * strings; the whole overlay is one path, one shape. */
export const LIVE_DEFAULT_SERVICE_PATH_TEMPLATE = '/live/t/{tick}/service-stops.json';

/** The `overlay` block of `/api/v1/auth/config` — the overlay's transport
 * discovery AND its rollout switch (docs/optimize-overlay.md E1S4):
 *  - `enabled` gates the *client* rollout only. The recorder publishes
 *    stops tick documents unconditionally, so flipping this var to true
 *    needs no warmup and no client release. Shipped default: false.
 *  - `pollSeconds` is the client's poll cadence. It may exceed the 30 s
 *    publish grid (clients then poll less often than ticks exist); tick
 *    *derivation* always stays on the grid, so a cadence change can never
 *    desynchronize publish and request. */
export interface OverlayTransportConfig {
  enabled: boolean;
  pathTemplate: string;
  pollSeconds: number;
}

export function overlayTransportConfig(
  source: {
    OVERLAY_ENABLED?: string;
    LIVE_SERVICE_PATH_TEMPLATE?: string;
    OVERLAY_POLL_SECONDS?: string;
  } = {},
): OverlayTransportConfig {
  return {
    enabled: source.OVERLAY_ENABLED === 'true',
    pathTemplate: source.LIVE_SERVICE_PATH_TEMPLATE ?? LIVE_DEFAULT_SERVICE_PATH_TEMPLATE,
    pollSeconds: liveUpdateSeconds(source.OVERLAY_POLL_SECONDS),
  };
}

/** Defensively parse the `overlay` block of `/api/v1/auth/config` — the
 * same tolerance rules as the `live` block: unknown extra fields ignored,
 * a missing or insane block throws before any overlay transport runs,
 * never a fallback URL. Signed-out users consume the same block; nothing
 * about the overlay is per-user. */
export function parseOverlayTransportConfig(value: unknown): OverlayTransportConfig {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid auth config');
  const overlay = (value as { overlay?: unknown }).overlay;
  if (typeof overlay !== 'object' || overlay === null)
    throw new Error('Auth config missing overlay block');
  const { enabled, pathTemplate } = overlay as Record<string, unknown>;
  if (typeof enabled !== 'boolean')
    throw new Error('Auth config overlay.enabled must be boolean');
  if (typeof pathTemplate !== 'string' || !/^\/live\/t\/\{tick\}\//.test(pathTemplate))
    throw new Error('Auth config overlay.pathTemplate must be an immutable tick path');
  const rawPoll = (overlay as { pollSeconds?: unknown }).pollSeconds;
  return {
    enabled,
    pathTemplate,
    pollSeconds: liveUpdateSeconds(
      typeof rawPoll === 'string' || typeof rawPoll === 'number'
        ? (rawPoll as string | number)
        : undefined,
    ),
  };
}

/** Defensively parse the `live` block of `/api/v1/auth/config` (the same
 * response feeds the React app, the standalone viewer, and future native
 * shells). Unknown extra fields are ignored; a missing or insane block
 * throws before any transport runs — never a fallback URL. */
export function parseLiveTransportConfig(value: unknown): LiveTransportConfig {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid auth config');
  const live = (value as { live?: unknown }).live;
  if (typeof live !== 'object' || live === null)
    throw new Error('Auth config missing live block');
  const { base, pathTemplate } = live as Record<string, unknown>;
  if (typeof base !== 'string') throw new Error('Auth config live.base must be a string');
  if (base !== '' && !/^https:\/\/[^/]+/.test(base))
    throw new Error('Live base must be HTTPS'); // '' = same-origin (local preview)
  if (typeof pathTemplate !== 'string' || !/^\/live\/t\/\{tick\}\//.test(pathTemplate))
    throw new Error('Auth config live.pathTemplate must be an immutable tick path');
  return {
    base,
    pathTemplate,
    updateSeconds: liveUpdateSeconds(
      typeof (live as { updateSeconds?: unknown }).updateSeconds === 'string' ||
        typeof (live as { updateSeconds?: unknown }).updateSeconds === 'number'
        ? ((live as { updateSeconds?: string | number }).updateSeconds as string | number)
        : undefined,
    ),
  };
}
