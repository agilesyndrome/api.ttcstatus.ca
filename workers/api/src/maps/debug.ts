import { BodyTooLargeError, readLimitedBytes } from '../../../shared/http/streams';
import type { Env } from '../env';
import { cors, json } from '../http/responses';
import { authorizedSync } from '../../../shared/http/admin-auth';

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
  const response = await env.MAP_GENERATOR.fetch(
    'https://map-generator.internal/api/debug/render',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.SYNC_TOKEN}`,
        'content-type': request.headers.get('content-type') ?? 'application/json',
      },
      body,
    },
  );

  const headers = cors(new Headers(response.headers));
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}
