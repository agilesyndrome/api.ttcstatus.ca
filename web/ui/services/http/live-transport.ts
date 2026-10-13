import { apiRequest } from './client';
import {
  parseLiveTransportConfig,
  parseOverlayTransportConfig,
} from '../../../../shared/live/config';
import type {
  LiveTransportConfig,
  OverlayTransportConfig,
} from '../../../../shared/live/config';

/** Transport discovery (docs/optimize-transport.md change 1b, story E2S1).
 *
 * `/api/v1/auth/config` is the *only* source of the live host, cadence, and
 * path template. It is fetched once per launch and cached in memory — a
 * shipped binary never bakes a live host, so hosts, cadences, and paths
 * migrate without an app update. No transport may proceed without it; a
 * failed fetch is retried on the next activation, never replaced by a
 * fallback URL (the no-fallback doctrine). Parsing itself lives in
 * shared/live/config.ts so the standalone viewer shares the same rules.
 *
 * The same single fetch also carries the void overlay's `overlay` block
 * (docs/optimize-overlay.md E2S1/E2S2): its stops tick path, poll cadence,
 * and the public rollout switch. */

interface ParsedConfig {
  live: LiveTransportConfig;
  overlay: OverlayTransportConfig;
}

let cached: Promise<ParsedConfig> | undefined;

/** Fetch + parse the auth config once per launch; later calls share the
 * in-flight or settled promise. A rejection clears the cache so the next
 * activation retries — never a fallback URL. */
function authConfig(request: typeof apiRequest = apiRequest): Promise<ParsedConfig> {
  cached ??= request('/api/v1/auth/config')
    .then((response) => {
      if (!response.ok) throw new Error(`Auth config returned HTTP ${response.status}`);
      return response.json();
    })
    .then((value) => ({
      live: parseLiveTransportConfig(value),
      overlay: parseOverlayTransportConfig(value),
    }));
  const pending = cached;
  return pending.catch((error) => {
    if (cached === pending) cached = undefined; // Retry on the next activation.
    throw error;
  });
}

/** The fleet transport (base URL, cadence, tick path) from the `live` block. */
export function liveTransport(
  request: typeof apiRequest = apiRequest,
): Promise<LiveTransportConfig> {
  return authConfig(request).then((config) => config.live);
}

export interface OverlayLaunch {
  /** Whether the void overlay is rolled out to this client — the public
   * config switch, never a per-user grant. Signed-out users read the same
   * value; the overlay is for everyone (docs/optimize-overlay.md E2S2). */
  enabled: boolean;
  /** The stops tick transport: the `live` block's host, the `overlay`
   * block's path and poll cadence, shaped exactly like a fleet transport
   * so the shared tick machinery (derivation, URL builder, three-case
   * contract) serves both documents unchanged. */
  transport: LiveTransportConfig;
}

/** The overlay's launch block: one shared config fetch yields the rollout
 * switch and the stops tick transport together. */
export function overlayLaunch(
  request: typeof apiRequest = apiRequest,
): Promise<OverlayLaunch> {
  return authConfig(request).then((config) => ({
    enabled: config.overlay.enabled,
    transport: {
      base: config.live.base,
      pathTemplate: config.overlay.pathTemplate,
      updateSeconds: config.overlay.pollSeconds,
    },
  }));
}
