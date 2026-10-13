import { apiRequest } from './client';
import { parseLiveTransportConfig } from '../../../../shared/live/config';
import type { LiveTransportConfig } from '../../../../shared/live/config';

/** Transport discovery (docs/optimize-transport.md change 1b, story E2S1).
 *
 * `/api/v1/auth/config` is the *only* source of the live host, cadence, and
 * path template. It is fetched once per launch and cached in memory — a
 * shipped binary never bakes a live host, so hosts, cadence, and paths
 * migrate without an app update. No transport may proceed without it; a
 * failed fetch is retried on the next activation, never replaced by a
 * fallback URL (the no-fallback doctrine). Parsing itself lives in
 * shared/live/config.ts so the standalone viewer shares the same rules. */

let cached: Promise<LiveTransportConfig> | undefined;

/** Fetch the live transport config once per launch; later calls share the
 * in-flight or settled promise. A rejection clears the cache so the next
 * activation retries — never a fallback URL. */
export function liveTransport(request: typeof apiRequest = apiRequest): Promise<LiveTransportConfig> {
  cached ??= request('/api/v1/auth/config')
    .then((response) => {
      if (!response.ok) throw new Error(`Auth config returned HTTP ${response.status}`);
      return response.json();
    })
    .then(parseLiveTransportConfig);
  const pending = cached;
  return pending.catch((error) => {
    if (cached === pending) cached = undefined; // Retry on the next activation.
    throw error;
  });
}