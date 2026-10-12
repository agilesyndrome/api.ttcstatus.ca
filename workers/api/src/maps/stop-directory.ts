import type { Env } from '../env';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { cors, json } from '../http/responses';
import { ifNoneMatchMatches } from '../../../../shared/http/etag';
import { mapArtifactHeaders } from './responses';
import { resolveMapArtifact } from './artifacts';
import { mapSelector } from './selectors';

export interface DirectoryArtifact {
  etag: string;
  chunk_count: number;
  schema_version: number;
}

export function readDirectoryArtifact(env: Env, artifactId: number) {
  return env.DB.prepare(
    'SELECT etag, chunk_count, schema_version FROM map_stop_directories WHERE artifact_id = ?',
  )
    .bind(artifactId)
    .first<DirectoryArtifact>();
}

/** Cached, precomputed public data. The entire city directory is identical for
 * every client; nearest-stop decisions never require a server query. */
export async function stopDirectoryResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const selector = mapSelector(new URL(request.url));
  if (selector instanceof Response) return selector;
  const resolved = await resolveMapArtifact(
    env,
    selector.name,
    selector.tag,
    selector.artifactId,
  );
  if (!resolved || resolved.error)
    return json({ error: 'map-artifact-missing' }, 404, { 'cache-control': 'no-store' });
  const directory = await readDirectoryArtifact(env, resolved.artifact.id);
  if (!directory)
    return json(
      {
        error: 'stop-directory-not-ready',
        guidance:
          'Regenerate this map with the current generator to publish original boarding geography.',
      },
      503,
      { 'cache-control': 'no-store' },
    );
  const headers = cors(
    new Headers({
      ...mapArtifactHeaders(resolved.artifact, selector.artifactId !== undefined),
      'content-type': 'application/json; charset=utf-8',
      'x-map-format': 'ttc-stop-directory',
      'x-schema-version': String(directory.schema_version),
      etag: `"${directory.etag}"`,
    }),
  );
  if (ifNoneMatchMatches(request.headers.get('if-none-match'), headers.get('etag')))
    return new Response(null, { status: 304, headers });
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(
    `https://ttcstatus-cache.invalid/stops?artifact=${resolved.artifact.id}&etag=${directory.etag}`,
  );
  const cached = await cache.match(key);
  if (cached)
    return new Response(request.method === 'HEAD' ? null : cached.body, { headers });
  const chunks = (
    await env.DB.prepare(
      'SELECT payload FROM map_stop_directory_chunks WHERE artifact_id = ? ORDER BY chunk_index',
    )
      .bind(resolved.artifact.id)
      .all<{ payload: string }>()
  ).results;
  if (chunks.length !== directory.chunk_count)
    return json({ error: 'stop-directory-incomplete' }, 503, {
      'cache-control': 'no-store',
    });
  const response = new Response(chunks.map((chunk) => chunk.payload).join(''), {
    headers,
  });
  ctx.waitUntil(cache.put(key, response.clone()));
  return request.method === 'HEAD' ? new Response(null, { headers }) : response;
}
