import type { Env } from '../env';
import { json } from '../http/responses';
import { authorizedSync } from '../../../shared/http/admin-auth';
import { syncStaticGtfs } from './sync';

/**
 * Run the complete static-import pipeline inside this request and report the
 * real outcome.
 *
 * A fetch event has unlimited wall time while the caller stays connected,
 * which the full download -> import -> map generation -> activation pass needs.
 * Continuing with `ctx.waitUntil` after returning `202 Accepted` is not an
 * option: the runtime caps background continuation at roughly 30 seconds past
 * the response. That window covers the ordinary unchanged nightly check, but a
 * changed feed needs about a minute, so the deferred pipeline was silently
 * killed mid-import with no recorded error and the map was only produced by
 * the next scheduled run. The Cron Trigger keeps its 15-minute budget and
 * remains the normal production path; this endpoint now answers with the
 * pipeline result so operators see import and generation failures directly.
 */
export async function manualSyncResponse(request: Request, env: Env): Promise<Response> {
  if (!env.SYNC_TOKEN)
    return json({ error: 'manual-sync-disabled' }, 404, { 'cache-control': 'no-store' });
  if (!(await authorizedSync(request, env)))
    return json({ error: 'unauthorized' }, 401, { 'cache-control': 'no-store' });
  try {
    const result = await syncStaticGtfs(env);
    return json(result, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500, { 'cache-control': 'no-store' });
  }
}
