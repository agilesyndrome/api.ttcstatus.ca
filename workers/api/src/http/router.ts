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
import {
  serviceStopsResponse,
  serviceWaveResponse,
  serviceHistoryResponse,
} from '../service/responses';
import { feedStatusResponse } from '../diagnostics/feed-status';
import { analyticsEventResponse } from '../diagnostics/analytics';
import { versionResponse } from '../diagnostics/version';
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
    (url.pathname === '/api/v1/map/streetcar' ||
      url.pathname === '/api/v1/map/snake' ||
      url.pathname === '/api/v1/map/ttcstatus')
  ) {
    return mapResponse(request, env, ctx, url.pathname.split('/').at(-1));
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/network') {
    return networkResponse(env);
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/version') {
    return versionResponse(env);
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/event') {
    return analyticsEventResponse(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/vehicles/streetcar') {
    return vehicleResponse(request, env, ctx);
  }

  // Delivered-service endpoints (docs/sla.md stories 3.1/3.2): additive,
  // marked experimental in the README until the overlay is polished.
  if (request.method === 'GET' && url.pathname === '/api/v1/service/stops') {
    return serviceStopsResponse(request, env, ctx);
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/service/wave') {
    return serviceWaveResponse(request, env, ctx);
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/service/history') {
    return serviceHistoryResponse(request, env, ctx);
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/feed/status') {
    return feedStatusResponse(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/debug/map/streetcar.svg') {
    return debugMapResponse(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/admin/sync') {
    return manualSyncResponse(request, env);
  }

  return json({ error: 'not-found' }, 404, { 'cache-control': 'no-store' });
}
