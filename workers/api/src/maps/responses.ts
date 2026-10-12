import type { Env } from '../env';
import { cors, json } from '../http/responses';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { ifNoneMatchMatches } from '../../../../shared/http/etag';
import { mapSelector } from './selectors';

import { resolveMapArtifact, type ActiveArtifact } from './artifacts';
export { resolveMapArtifact } from './artifacts';

export async function mapResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
  name = 'streetcar',
): Promise<Response> {
  const selector = mapSelector(new URL(request.url), name);
  if (selector instanceof Response) return selector;
  const resolved = await resolveMapArtifact(env, name, selector.tag, selector.artifactId);
  const url = new URL(request.url);
  if (!resolved) {
    if (url.searchParams.has('artifact'))
      return json({ error: 'map-artifact-missing' }, 404, {
        'cache-control': 'no-store',
      });
    // Operator diagnostics: the latest streetcar generation job tells the
    // operator which of the three states the pipeline is in — not yet
    // started, still working, or started-but-failed. Only the 'running' case
    // claims the map is being prepared; every other state means the pipeline
    // needs operator action, and the payload says exactly which.
    const job = await env.DB.prepare(
      `SELECT status, started_at, completed_at, error FROM map_generation_jobs
       WHERE mode = 'streetcar'
       ORDER BY id DESC LIMIT 1`,
    ).first<{
      status: string;
      started_at: string | null;
      completed_at: string | null;
      error: string | null;
    }>();
    const phase = job?.status ?? 'not-started';
    const guidance = !job
      ? 'Map pipeline: not yet started. Run the sync: POST /api/v1/admin/sync (locally: make dev / make dev/new).'
      : job.status === 'running'
        ? `Map pipeline: still working (started ${job.started_at}). Wait for this job to finish; it activates the map when it completes.`
        : job.status === 'pending'
          ? 'Map pipeline: job queued but not started. Re-run the sync or check the map-generator Worker.'
          : job.status === 'failed'
            ? `Map pipeline: started but failed${job.completed_at ? ` at ${job.completed_at}` : ''}${job.error ? ` — ${job.error}` : ''}. Fix the cause, then re-run the sync.`
            : `Map pipeline: generation completed at ${job.completed_at ?? job.started_at} but activation never flipped an active artifact. Check for missing/incomplete snake or ttcstatus artifacts, then re-run the sync or npm run map:regenerate:remote to re-activate.`;
    return json(
      {
        error: job?.status === 'running' ? 'map-generating' : 'map-not-ready',
        phase,
        guidance,
      },
      503,
      { 'cache-control': 'no-store' },
    );
  }
  if (resolved.error)
    return json({ error: 'map-tag-missing', ...resolved.error }, 404, {
      'cache-control': 'no-store',
    });
  const artifact = resolved.artifact;
  const artifactHeaders = mapArtifactHeaders(artifact, resolved.via === 'artifact');

  const quotedEtag = `"${artifact.etag}"`;
  if (ifNoneMatchMatches(request.headers.get('if-none-match'), quotedEtag)) {
    return new Response(null, {
      status: 304,
      headers: cors(
        new Headers({
          etag: quotedEtag,
          ...artifactHeaders,
        }),
      ),
    });
  }

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(
    `https://ttcstatus-cache.invalid/api/v1/map/${name}?v=${artifact.version_id}&etag=${artifact.etag}`,
    { method: 'GET' },
  );
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = cors(new Headers(cached.headers));
    for (const [key, value] of Object.entries(artifactHeaders)) headers.set(key, value);
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
      ...artifactHeaders,
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

export function mapArtifactHeaders(
  artifact: ActiveArtifact,
  immutable = false,
): Record<string, string> {
  return {
    'cache-control': immutable
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600, stale-while-revalidate=86400',
    'x-network-version': String(artifact.version_id),
    'x-map-artifact': String(artifact.id),
    'x-map-generator': artifact.generator_version,
    'x-map-format':
      artifact.name === 'streetcar' ? 'ttc-schematic-map' : 'ttc-viewer-map',
    'x-schema-version': '1',
  };
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
