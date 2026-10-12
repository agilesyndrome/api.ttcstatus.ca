import type { Env } from '../env';
import { json } from '../http/responses';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { ifNoneMatchMatches } from '../../../../shared/http/etag';
import { liveUpdateSeconds } from '../../../../shared/live/config';
import { recorderFetch } from '../service/recorder-client';
import type { PublishedSnapshot } from '../service/published-snapshot';

/** The API distributes the recorder's public snapshot. It never acquires TTC
 * feeds itself, and every client receives the same fleet without GPS filters. */
export async function vehicleResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const updateSeconds = liveUpdateSeconds(env.REALTIME_UPDATE_SECONDS);
  const cache = (caches as unknown as { default: Cache }).default;
  // Config changes invalidate a POP's old envelope; the recorder independently
  // checks its persisted acquisition configuration after deployment/eviction.
  const config = JSON.stringify([
    env.REALTIME_VEHICLE_URL,
    env.REALTIME_SUBWAY_URL,
    env.SOURCE_ATTRIBUTION,
    env.SERVICE_SAMPLE_SECONDS,
    updateSeconds,
  ]);
  const key = new Request(
    `https://ttcstatus-cache.invalid/recorder-vehicles?config=${encodeURIComponent(config)}`,
  );
  const conditional = (response: Response) =>
    ifNoneMatchMatches(request.headers.get('if-none-match'), response.headers.get('etag'))
      ? new Response(null, { status: 304, headers: response.headers })
      : response;
  const cached = await cache.match(key);
  // A cache implementation should honor max-age; this additional guard prevents
  // stale cached fleets from masking an outage after their published next tick.
  if (
    cached &&
    Date.parse(cached.headers.get('x-live-next-update-at') ?? '') > Date.now()
  )
    return conditional(cached);
  try {
    const publication = await recorderFetch(env, '/snapshot');
    if (!publication.ok) throw new Error('recorder unavailable');
    const result = (await publication.json()) as PublishedSnapshot;
    if (
      !result.snapshot ||
      !result.etag ||
      !Number.isFinite(result.checkedAt) ||
      !Number.isFinite(result.nextUpdateAt) ||
      result.nextUpdateAt <= Date.now()
    ) {
      throw new Error('no current snapshot');
    }
    // Client polling cadence and recorder acquisition cadence are distinct. Edge
    // copies expire by the next acquisition so partial/outage states stay honest.
    const remainingSeconds = Math.max(
      0,
      Math.floor((result.nextUpdateAt - Date.now()) / 1000),
    );
    const response = json(result.snapshot, 200, {
      'cache-control': `public, max-age=${Math.min(updateSeconds, remainingSeconds)}`,
      etag: result.etag,
      'x-live-update-seconds': String(updateSeconds),
      'x-live-next-update-at': new Date(result.nextUpdateAt).toISOString(),
    });
    ctx.waitUntil(cache.put(key, response.clone()));
    return conditional(response);
  } catch {
    return json(
      {
        error: 'vehicles-unavailable',
        message: 'Live transit observations are temporarily unavailable.',
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
