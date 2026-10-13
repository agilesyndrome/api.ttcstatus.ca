import type { Env } from '../env';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { cors, json } from './responses';
import {
  authenticateAccount,
  authConfig,
  ownedAccountResponse,
  publicProfileResponse,
} from '../accounts';
import { verifySession } from '../accounts/verify';
import { mapResponse, networkResponse } from '../maps/responses';
import { debugMapResponse } from '../maps/debug';
import { serviceWaveResponse, serviceHistoryResponse } from '../service/responses';
import { slaReportResponse } from '../sla/responses';
import { feedStatusResponse } from '../diagnostics/feed-status';
import { analyticsEventResponse } from '../diagnostics/analytics';
import { versionResponse } from '../diagnostics/version';
import { manualSyncResponse } from '../sync/manual-sync';
import { privacyQueryResponse } from './privacy';
import { stopDirectoryResponse } from '../maps/stop-directory';
import { manifestResponse } from '../maps/manifest';
import { openApiDocument } from '../contracts/openapi';

export async function routeRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }
  const privacyError = privacyQueryResponse(url);
  if (privacyError) return privacyError;
  if (request.method === 'GET' && url.pathname === '/api/v1/openapi.json') {
    return json(openApiDocument, 200, { 'cache-control': 'public, max-age=300' });
  }
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    url.pathname === '/api/v1/stops'
  ) {
    return stopDirectoryResponse(request, env, ctx);
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/manifest') {
    return manifestResponse(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/auth/config') {
    // Edge-cacheable (optimize-transport.md change 1b): every field is
    // public by design, and an uncached fetch per launch would bill ~60M
    // Worker requests/month at scale for nothing. A stale `enabled` flip
    // costs ≤ 5 minutes.
    return json(authConfig(env), 200, { 'cache-control': 'public, max-age=300' });
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

  // Delivered-service endpoints (docs/optimize-overlay.md Epic 3): the
  // overlay's live stops data is public broadcast bytes from the live
  // bucket — nothing here serves it. What remains on the Worker:
  //  - `/api/v1/service/history` — per-stop expanded details, broadcast
  //    (identical per stop for every caller) and edge-cached; the selected
  //    stop's card needs it and the overlay is for every visitor, so it is
  //    public, no session. The narrowing-filter requirement stays.
  //  - `/api/v1/service/wave` — the members-only replay (the E4S5 /sla
  //    decision): a verified session, no per-user grant — the `voidOverlay`
  //    flag is gone for everyone. Identity comes exclusively from the
  //    verified token, never from query parameters.
  // No `/api/v1/service/stops`: the public vehicle-style deletion, not a
  // flag (the no-fallback doctrine) — the live tick path is the only
  // transport for the stops payload, and nothing here can read the
  // recorder's states per request.
  if (request.method === 'GET' && url.pathname === '/api/v1/service/history') {
    return serviceHistoryResponse(request, env, ctx);
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/service/wave') {
    const identity = await verifySession(request, env);
    if (identity instanceof Response) return identity;
    return serviceWaveResponse(request, env);
  }

  // The SLA report (docs/sla-stories.md Epic 8, E8S4): precomputed-only —
  // additive, marked experimental in the README. The report is a
  // members-only surface while it is in beta: the router places it behind
  // the same verified-session gate as /me/*, so neither the report nor its
  // edge cache entry is reachable signed out. The page mirrors this with its
  // own sign-in gate.
  if (request.method === 'GET' && url.pathname === '/api/v1/sla/report') {
    const identity = await authenticateAccount(request, env);
    if (identity instanceof Response) return identity;
    return slaReportResponse(request, env, ctx);
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
