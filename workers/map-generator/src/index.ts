import { authorizedSync } from '../../shared/http/admin-auth';
import { BodyTooLargeError, readLimitedBytes } from '../../shared/http/streams';
import type { D1Database, ExecutionContextLike } from '../../shared/cloudflare/bindings';
import { renderDebugMapSvg, type DebugMapBundle } from './rendering/debug-render';
import { generateStreetcarMap, type MapGeneratorEnv } from './generate';

interface Env extends MapGeneratorEnv {
  DB: D1Database;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

async function debugRender(request: Request, env: Env): Promise<Response> {
  if (!env.SYNC_TOKEN) return json({ error: 'debug-render-disabled' }, 404);
  if (!(await authorizedSync(request, env))) return json({ error: 'unauthorized' }, 401);

  try {
    const body = request.body
      ? new TextDecoder().decode(await readLimitedBytes(request.body, 2_000_000))
      : '';

    const bundle = JSON.parse(body) as DebugMapBundle;
    const svg = renderDebugMapSvg(bundle);
    return new Response(svg, {
      headers: {
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
      return json({ error: 'map-json-too-large' }, 413);
    const message = error instanceof Error ? error.message : 'invalid map JSON';
    return json({ error: 'invalid-map-json', message }, 400);
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/healthz') {
      return json({ ok: true, worker: 'ttcstatus-map-generator' });
    }

    if (request.method === 'POST' && url.pathname === '/api/debug/render') {
      return debugRender(request, env);
    }

    if (request.method !== 'POST' || url.pathname !== '/api/internal/generate') {
      return json({ error: 'not-found' }, 404);
    }
    if (!env.SYNC_TOKEN) return json({ error: 'generation-disabled' }, 404);
    if (!(await authorizedSync(request, env)))
      return json({ error: 'unauthorized' }, 401);

    let versionId: number | undefined;
    try {
      const body = (await request.json()) as {
        versionId?: number;
        mode?: string;
        style?: string;
      };
      versionId = Number(body.versionId);
      if (!Number.isInteger(versionId) || versionId <= 0)
        return json({ error: 'invalid-version-id' }, 400);
      if (body.mode && body.mode !== 'streetcar')
        return json({ error: 'unsupported-mode' }, 400);
      if (body.style && body.style !== 'snake-v1')
        return json({ error: 'unsupported-style' }, 400);

      await env.DB.prepare(
        `UPDATE map_generation_jobs
         SET status = 'running', started_at = ?, error = NULL
         WHERE id = (
           SELECT id FROM map_generation_jobs
           WHERE version_id = ? AND mode = 'streetcar'
           ORDER BY id DESC LIMIT 1
         )`,
      )
        .bind(new Date().toISOString(), versionId)
        .run();

      const artifactId = await generateStreetcarMap(env, versionId);
      return json({ ok: true, artifactId, versionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (versionId) {
        await env.DB.prepare(
          `UPDATE map_generation_jobs
           SET status = 'failed', completed_at = ?, error = ?
           WHERE id = (
             SELECT id FROM map_generation_jobs
             WHERE version_id = ? AND mode = 'streetcar'
             ORDER BY id DESC LIMIT 1
           )`,
        )
          .bind(new Date().toISOString(), message.slice(0, 2000), versionId)
          .run();
      }
      return json({ error: message }, 500);
    }
  },
};
