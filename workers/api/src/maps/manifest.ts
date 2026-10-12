import type { Env } from '../env';
import { json } from '../http/responses';
import { resolveMapArtifact } from './artifacts';
import { mapSelector } from './selectors';
import { readDirectoryArtifact } from './stop-directory';

/** Resolve mutable tags once, then give clients paired immutable URLs. Cached
 * geometry and geography can be installed atomically, even if a tag changes. */
export async function manifestResponse(request: Request, env: Env): Promise<Response> {
  const selector = mapSelector(new URL(request.url));
  if (selector instanceof Response) return selector;
  const resolved = await resolveMapArtifact(env, selector.name, selector.tag);
  if (!resolved || resolved.error)
    return json({ error: 'map-not-ready' }, 503, { 'cache-control': 'no-store' });
  const artifact = resolved.artifact;
  const directory = await readDirectoryArtifact(env, artifact.id);
  return json(
    {
      format: 'ttc-release-manifest',
      schemaVersion: 1,
      networkVersion: artifact.version_id,
      artifactId: artifact.id,
      selectedBy: resolved.via,
      generatorVersion: artifact.generator_version,
      map: {
        name: artifact.name,
        format: artifact.name === 'streetcar' ? 'ttc-schematic-map' : 'ttc-viewer-map',
        schemaVersion: 1,
        etag: `"${artifact.etag}"`,
        url: `/api/v1/map/${artifact.name}?artifact=${artifact.id}`,
      },
      stops: directory
        ? {
            format: 'ttc-stop-directory',
            schemaVersion: directory.schema_version,
            etag: `"${directory.etag}"`,
            url: `/api/v1/stops?map=${artifact.name}&artifact=${artifact.id}`,
          }
        : null,
    },
    200,
    { 'cache-control': 'no-store' },
  );
}
