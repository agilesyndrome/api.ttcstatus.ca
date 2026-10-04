import type { Env } from '../env';
import { json } from '../http/responses';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { ifNoneMatchMatches } from '../../../../shared/http/etag';

import { DEFAULT_VEHICLE_FEED_URL } from './realtime';
import { VehicleSnapshotCache } from './vehicle-snapshot-cache';
import { liveUpdateSeconds } from '../../../../shared/live/config';

// Keep only the current configuration in an isolate; edge caching is shared
// within a Cloudflare location, not a global single-poller guarantee.
let vehicleStore: { key: string; cache: VehicleSnapshotCache } | undefined;
export async function vehicleResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const source = env.REALTIME_VEHICLE_URL ?? DEFAULT_VEHICLE_FEED_URL;
  const updateSeconds = liveUpdateSeconds(env.REALTIME_UPDATE_SECONDS);
  const cache = (caches as unknown as { default: Cache }).default;
  const storeKey = JSON.stringify([source, env.SOURCE_ATTRIBUTION, updateSeconds]);
  const key = new Request(
    `https://ttcstatus-cache.invalid/api/v1/vehicles/streetcar?config=${encodeURIComponent(storeKey)}`,
  );
  const cached = await cache.match(key);
  const conditional = (response: Response) =>
    ifNoneMatchMatches(request.headers.get('if-none-match'), response.headers.get('etag'))
      ? new Response(null, { status: 304, headers: response.headers })
      : response;
  if (cached) return conditional(cached);
  try {
    if (vehicleStore?.key !== storeKey)
      vehicleStore = {
        key: storeKey,
        cache: new VehicleSnapshotCache(source, env.SOURCE_ATTRIBUTION, updateSeconds),
      };
    const result = await vehicleStore.cache.get();
    const remainingSeconds = Math.max(
      0,
      Math.floor((result.nextUpdateAt - Date.now()) / 1000),
    );
    const response = json(result.snapshot, 200, {
      'cache-control': `public, max-age=${remainingSeconds}`,
      etag: result.etag,
      'x-live-update-seconds': String(updateSeconds),
      'x-live-next-update-at': new Date(result.nextUpdateAt).toISOString(),
    });
    ctx.waitUntil(cache.put(key, response.clone()));
    return conditional(response);
  } catch (error) {
    console.error('Streetcar snapshot failed', error);
    return json(
      {
        error: 'vehicles-unavailable',
        message: 'Live streetcar positions are temporarily unavailable.',
      },
      503,
      {
        'cache-control': 'no-store',
        'x-live-update-seconds': String(updateSeconds),
        'retry-after': String(updateSeconds),
      },
    );
  }
}
