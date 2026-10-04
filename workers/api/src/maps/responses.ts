import type { Env } from '../env';
import { cors, json } from '../http/responses';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { ifNoneMatchMatches } from '../../../../shared/http/etag';

interface ActiveArtifact {
  id: number;
  version_id: number;
  mode: string;
  style: string;
  generator_version: string;
  etag: string;
  byte_size: number;
  chunk_count: number;
  created_at: string;
}

async function activeArtifact(env: Env): Promise<ActiveArtifact | null> {
  return env.DB.prepare(
    `SELECT id, version_id, mode, style, generator_version, etag, byte_size, chunk_count, created_at
     FROM map_artifacts
     WHERE mode = 'streetcar' AND style = 'snake-v1' AND active = 1
     ORDER BY id DESC LIMIT 1`,
  ).first<ActiveArtifact>();
}

export async function mapResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const artifact = await activeArtifact(env);
  if (!artifact) {
    return json(
      {
        error: 'map-not-ready',
        message:
          'No active streetcar map has been generated yet. Run the first static GTFS sync after provisioning D1/R2.',
      },
      503,
      { 'cache-control': 'no-store' },
    );
  }

  const quotedEtag = `"${artifact.etag}"`;
  if (ifNoneMatchMatches(request.headers.get('if-none-match'), quotedEtag)) {
    return new Response(null, {
      status: 304,
      headers: cors(
        new Headers({
          etag: quotedEtag,
          'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
          'x-network-version': String(artifact.version_id),
        }),
      ),
    });
  }

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(
    `https://ttcstatus-cache.invalid/api/v1/map/streetcar?v=${artifact.version_id}&etag=${artifact.etag}`,
    { method: 'GET' },
  );
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = cors(new Headers(cached.headers));
    headers.set('x-ttcstatus-cache', 'HIT');
    return new Response(request.method === 'HEAD' ? null : cached.body, {
      status: cached.status,
      headers,
    });
  }

  const chunks = (
    await env.DB.prepare(
      `SELECT payload FROM map_artifact_chunks
     WHERE artifact_id = ?
     ORDER BY chunk_index`,
    )
      .bind(artifact.id)
      .all<{ payload: string }>()
  ).results;

  if (chunks.length !== artifact.chunk_count) {
    return json(
      {
        error: 'map-artifact-incomplete',
        expectedChunks: artifact.chunk_count,
        actualChunks: chunks.length,
      },
      503,
      { 'cache-control': 'no-store' },
    );
  }

  const body = chunks.map((chunk) => chunk.payload).join('');
  const headers = cors(
    new Headers({
      'content-type': 'application/json; charset=utf-8',
      etag: quotedEtag,
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      'x-network-version': String(artifact.version_id),
      'x-map-generator': artifact.generator_version,
      'x-ttcstatus-cache': 'MISS',
    }),
  );
  const response = new Response(body, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function networkResponse(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, source_url, source_etag, source_last_modified, fetched_at, imported_at,
            activated_at, route_count, pattern_count, shape_count, stop_count,
            pattern_stop_count, r2_etag
     FROM network_versions
     WHERE source_key = 'ttc-surface-gtfs' AND active = 1
     ORDER BY id DESC LIMIT 1`,
  ).first<Record<string, unknown>>();

  if (!row)
    return json({ error: 'network-not-ready' }, 503, { 'cache-control': 'no-store' });
  return json(
    {
      mode: 'streetcar',
      version: row,
      attribution: env.SOURCE_ATTRIBUTION,
    },
    200,
    { 'cache-control': 'public, max-age=300' },
  );
}
