import type { Env } from '../env';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { json } from '../http/responses';
import { authorizedSync } from '../../../shared/http/admin-auth';
import { syncStaticGtfs } from './sync';

export async function manualSyncResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  if (!env.SYNC_TOKEN)
    return json({ error: 'manual-sync-disabled' }, 404, { 'cache-control': 'no-store' });
  if (!(await authorizedSync(request, env)))
    return json({ error: 'unauthorized' }, 401, { 'cache-control': 'no-store' });
  ctx.waitUntil(
    syncStaticGtfs(env)
      .then((result) => console.log('manual static GTFS sync result', result))
      .catch((error) => console.error('manual static GTFS sync failed', error)),
  );
  return json({ status: 'accepted', reason: 'static-sync-started' }, 202, {
    'cache-control': 'no-store',
  });
}
