import { BodyTooLargeError, readLimitedBytes } from '../../../shared/http/streams';
import type { Env } from '../env';
import { cors, json } from '../http/responses';
import { authorizedSync } from '../../../shared/http/admin-auth';
import { renderDebugMapSvg } from '../mapgen/rendering/debug-render';
import type { DebugMapBundle } from '../mapgen/rendering/debug-render';

/** Admin-gated debug SVG rendering (E7S4, docs/optimize-transport.md Epic 7):
 * calls `renderDebugMapSvg` in-process — the internal HTTP hop to the
 * generator worker is gone. The route's exact enforcement survives:
 * `authorizedSync`, the 2 MB body cap, the 413/400 error shapes, the CSP
 * header, and `nosniff`. This stays a debug surface; `/api/internal/generate`
 * gets no public route — its only callers are the sync path (a function call
 * since E7S3) and nothing else. */
export async function debugMapResponse(request: Request, env: Env): Promise<Response> {
  if (!env.SYNC_TOKEN)
    return json({ error: 'debug-render-disabled' }, 404, { 'cache-control': 'no-store' });
  if (!(await authorizedSync(request, env)))
    return json({ error: 'unauthorized' }, 401, { 'cache-control': 'no-store' });

  let body = '';
  try {
    if (request.body)
      body = new TextDecoder().decode(await readLimitedBytes(request.body, 2_000_000));
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return json({ error: 'map-json-too-large' }, 413, { 'cache-control': 'no-store' });
    throw error;
  }

  try {
    const bundle = JSON.parse(body) as DebugMapBundle;
    const svg = renderDebugMapSvg(bundle);
    // The exact response headers the generator route enforced (E7S4):
    // CSP + sandbox + nosniff, never cached.
    return new Response(svg, {
      headers: {
        ...cors(),
        'cache-control': 'no-store',
        'content-type': 'image/svg+xml; charset=utf-8',
        'content-disposition': 'inline; filename=streetcar-debug.svg',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return json({ error: 'map-json-too-large' }, 413, { 'cache-control': 'no-store' });
    const message = error instanceof Error ? error.message : 'invalid map JSON';
    return json({ error: 'invalid-map-json', message }, 400, {
      'cache-control': 'no-store',
    });
  }
}
