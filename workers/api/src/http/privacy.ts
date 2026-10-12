import { json } from './responses';

import {
  allowedApiQueries,
  hasUnsupportedApiQuery,
} from '../../../../shared/http/api-queries';

/** Reject accidental GPS/grid uploads before authentication, storage, or analytics.
 * Bodies are separately bounded and allowlisted by each owning endpoint. */
export function privacyQueryResponse(url: URL): Response | undefined {
  if (hasUnsupportedApiQuery(url)) {
    return json({ error: 'unsupported-query-parameter' }, 400, {
      'cache-control': 'no-store',
    });
  }
  return undefined;
}

/** Never log raw URLs, bodies, tokens, dynamic IDs, or exception messages: any of
 * those may contain a caller-supplied coordinate. Operators retain route + class. */
export function requestFailureContext(request: Request, error: unknown) {
  const path = new URL(request.url).pathname;
  const route = path.startsWith('/api/v1/me/')
    ? '/api/v1/me/:resource'
    : path.startsWith('/api/v1/profiles/')
      ? '/api/v1/profiles/:username'
      : knownRoutes.has(path)
        ? path
        : '/api/:unknown';
  return {
    method: request.method,
    route,
    errorType: error instanceof TypeError ? 'TypeError' : 'Error',
  };
}

const knownRoutes = new Set([
  ...Object.keys(allowedApiQueries),
  '/api/healthz',
  '/api/v1/auth/config',
  '/api/v1/version',
  '/api/v1/event',
  '/api/v1/vehicles/streetcar',
  '/api/v1/feed/status',
  '/api/v1/admin/sync',
  '/api/v1/debug/map/streetcar.svg',
  '/api/v1/openapi.json',
]);
