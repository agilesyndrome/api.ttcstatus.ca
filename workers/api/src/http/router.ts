import type { Env } from '../env';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { cors, json } from './responses';
import {
  authenticateAccount,
  authConfig,
  ownedAccountResponse,
  publicProfileResponse,
} from '../accounts';
import { mapResponse, networkResponse } from '../maps/responses';
import { debugMapResponse } from '../maps/debug';
import { vehicleResponse } from '../realtime/response';
import { feedStatusResponse } from '../diagnostics/feed-status';
import { manualSyncResponse } from '../sync/manual-sync';

export async function routeRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/auth/config') {
    return json(authConfig(env), 200, { 'cache-control': 'no-store' });
  }
  if (url.pathname.startsWith('/api/v1/me/')) {
    const identity = await authenticateAccount(request, env);
    if (identity instanceof Response) return identity;
    return ownedAccountResponse(request, env, identity);
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/v1/profiles/')) {
    return publicProfileResponse(env, url.pathname.slice('/api/v1/profiles/'.length));
  }

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    url.pathname === '/api/healthz'
  ) {
    return request.method === 'HEAD'
      ? new Response(null, { status: 200, headers: cors() })
      : json({ ok: true, worker: 'ttcstatus-api' }, 200, { 'cache-control': 'no-store' });
  }

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    url.pathname === '/api/v1/map/streetcar'
  ) {
    return mapResponse(request, env, ctx);
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/network') {
    return networkResponse(env);
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/vehicles/streetcar') {
    return vehicleResponse(request, env, ctx);
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/feed/status') {
    return feedStatusResponse(env);
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/debug/map/streetcar.svg') {
    return debugMapResponse(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/admin/sync') {
    return manualSyncResponse(request, env, ctx);
  }

  return json({ error: 'not-found' }, 404, { 'cache-control': 'no-store' });
}
