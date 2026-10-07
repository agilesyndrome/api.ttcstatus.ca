import { sha256Hex } from '../../../shared/gtfs/hash';
import {
  ARTIFACT_CHUNK_CHARACTERS,
  GENERATOR_VERSION,
  MAP_MODE,
  MAP_STYLE,
  STREETCAR_MAP_NAME,
} from '../config';
import type { MapGeneratorEnv } from '../types';

export interface ArtifactOptions {
  /** Published map name (its public API path), e.g. 'streetcar' or 'snake'. */
  name?: string;
  style?: string;
  generatorVersion?: string;
  mode?: string;
}

function chunkString(value: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < value.length) {
    let end = Math.min(value.length, start + ARTIFACT_CHUNK_CHARACTERS);
    // Do not split a UTF-16 surrogate pair across D1 rows.
    if (end < value.length) {
      const last = value.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

/** Persist a complete immutable map artifact and mark its generation job done. */
export async function storeMapArtifact(
  env: MapGeneratorEnv,
  versionId: number,
  bundle: unknown,
  options: ArtifactOptions = {},
): Promise<number> {
  const name = options.name ?? STREETCAR_MAP_NAME;
  const mode = options.mode ?? MAP_MODE;
  const style = options.style ?? MAP_STYLE;
  const generatorVersion = options.generatorVersion ?? GENERATOR_VERSION;
  const json = JSON.stringify(bundle);
  const etag = await sha256Hex(json);
  const chunks = chunkString(json);
  const createdAt = new Date().toISOString();
  const byteSize = new TextEncoder().encode(json).byteLength;

  const existing = await env.DB.prepare(
    `SELECT id FROM map_artifacts
     WHERE version_id = ? AND mode = ? AND style = ? AND generator_version = ?
     LIMIT 1`,
  )
    .bind(versionId, mode, style, generatorVersion)
    .first<{ id: number }>();

  let artifactId: number;
  if (existing) {
    artifactId = existing.id;
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM map_artifact_chunks WHERE artifact_id = ?`).bind(
        artifactId,
      ),
      env.DB.prepare(
        `UPDATE map_artifacts
         SET etag = ?, byte_size = ?, chunk_count = ?, created_at = ?
         WHERE id = ?`,
      ).bind(etag, byteSize, chunks.length, createdAt, artifactId),
    ]);
  } else {
    await env.DB.prepare(
      `INSERT INTO map_artifacts (
         version_id, mode, style, generator_version, name, etag, byte_size, chunk_count, created_at, active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
      .bind(
        versionId,
        mode,
        style,
        generatorVersion,
        name,
        etag,
        byteSize,
        chunks.length,
        createdAt,
      )
      .run();

    const inserted = await env.DB.prepare(
      `SELECT id FROM map_artifacts
       WHERE version_id = ? AND mode = ? AND style = ? AND generator_version = ?
       LIMIT 1`,
    )
      .bind(versionId, mode, style, generatorVersion)
      .first<{ id: number }>();
    if (!inserted)
      throw new Error('Map artifact insert succeeded but could not be read back');
    artifactId = inserted.id;
  }

  const statements = chunks.map((payload, index) =>
    env.DB.prepare(
      `INSERT INTO map_artifact_chunks (artifact_id, chunk_index, payload)
     VALUES (?, ?, ?)`,
    ).bind(artifactId, index, payload),
  );

  // Small batches keep individual D1 requests predictable and readable.
  for (let i = 0; i < statements.length; i += 25) {
    await env.DB.batch(statements.slice(i, i + 25));
  }

  await env.DB.prepare(
    `UPDATE map_generation_jobs
     SET status = 'completed', completed_at = ?, error = NULL
     WHERE id = (
       SELECT id FROM map_generation_jobs
       WHERE version_id = ? AND mode = ?
       ORDER BY id DESC LIMIT 1
     )`,
  )
    .bind(createdAt, versionId, MAP_MODE)
    .run();

  return artifactId;
}
