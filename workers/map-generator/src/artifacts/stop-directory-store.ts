import type { StopDirectory } from '../../../../shared/transit/stop-directory';
import { sha256Hex } from '../../../shared/gtfs/hash';
import { chunkString } from '../../../shared/storage/chunks';
import type { MapGeneratorEnv } from '../types';

/** Publish only a complete directory, identified by its immutable map artifact. */
export async function storeStopDirectory(
  env: MapGeneratorEnv,
  artifactId: number,
  directory: StopDirectory,
) {
  const map = await env.DB.prepare('SELECT version_id FROM map_artifacts WHERE id = ?')
    .bind(artifactId)
    .first<{ version_id: number }>();
  if (!map || map.version_id !== directory.networkVersion)
    throw new Error('Stop directory must match its map network version');
  const existing = await env.DB.prepare(
    'SELECT artifact_id FROM map_stop_directories WHERE artifact_id = ?',
  )
    .bind(artifactId)
    .first();
  if (existing) return;
  const payload = JSON.stringify(directory);
  const chunks = chunkString(payload);
  // Incomplete staging chunks are invisible until the metadata row is published.
  await env.DB.prepare('DELETE FROM map_stop_directory_chunks WHERE artifact_id = ?')
    .bind(artifactId)
    .run();
  for (let offset = 0; offset < chunks.length; offset += 25) {
    await env.DB.batch(
      chunks
        .slice(offset, offset + 25)
        .map((chunk, index) =>
          env.DB.prepare(
            'INSERT INTO map_stop_directory_chunks (artifact_id, chunk_index, payload) VALUES (?, ?, ?)',
          ).bind(artifactId, offset + index, chunk),
        ),
    );
  }
  await env.DB.prepare(
    'INSERT INTO map_stop_directories (artifact_id, etag, chunk_count, schema_version) VALUES (?, ?, ?, 1)',
  )
    .bind(artifactId, await sha256Hex(payload), chunks.length)
    .run();
}
