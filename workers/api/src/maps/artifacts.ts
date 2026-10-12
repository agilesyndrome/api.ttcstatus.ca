import type { Env } from '../env';

export interface ActiveArtifact {
  id: number;
  version_id: number;
  mode: string;
  style: string;
  name: string;
  generator_version: string;
  etag: string;
  byte_size: number;
  chunk_count: number;
  created_at: string;
}

const emptyArtifact = (name: string): ActiveArtifact => ({
  id: 0,
  version_id: 0,
  mode: '',
  style: '',
  name,
  generator_version: '',
  etag: '',
  byte_size: 0,
  chunk_count: 0,
  created_at: '',
});

const TAGGED_ARTIFACT_COLUMNS = `a.id, a.version_id, a.mode, a.style, a.name, a.generator_version,
  a.etag, a.byte_size, a.chunk_count, a.created_at`;

export interface ResolvedMap {
  artifact: ActiveArtifact;
  /** How this artifact was selected: a published tag, or the active pointer. */
  via: string;
  error?: { message: string };
}

/**
 * Resolve a named map to one immutable artifact.
 *
 * Tag precedence: an explicit `?tag=` must exist (or the request fails with a
 * hint, never a silent fallback). Without a tag, `stable` wins when a publisher
 * has pinned it, then the pipeline's `active` pointer (the nightly import) is
 * the last resort so the public map never disappears because nobody tagged it.
 */
export async function resolveMapArtifact(
  env: Env,
  name: string,
  tag?: string,
  artifactId?: number,
): Promise<ResolvedMap | null> {
  if (artifactId !== undefined) {
    const artifact = await env.DB.prepare(
      `SELECT ${TAGGED_ARTIFACT_COLUMNS} FROM map_artifacts a WHERE a.name = ? AND a.id = ?`,
    )
      .bind(name, artifactId)
      .first<ActiveArtifact>();
    return artifact ? { artifact, via: 'artifact' } : null;
  }
  if (tag) {
    const tagged = await env.DB.prepare(
      `SELECT ${TAGGED_ARTIFACT_COLUMNS}
       FROM map_tags t JOIN map_artifacts a ON a.id = t.artifact_id
       WHERE t.name = ? AND t.tag = ?`,
    )
      .bind(name, tag)
      .first<ActiveArtifact>();
    if (!tagged)
      return {
        artifact: emptyArtifact(name),
        via: tag,
        error: {
          message: `Map '${name}' has no tag '${tag}'. Set one with npm run map:tag.`,
        },
      };
    return { artifact: tagged, via: tag };
  }
  const stable = await env.DB.prepare(
    `SELECT ${TAGGED_ARTIFACT_COLUMNS}
     FROM map_tags t JOIN map_artifacts a ON a.id = t.artifact_id
     WHERE t.name = ? AND t.tag = 'stable'`,
  )
    .bind(name)
    .first<ActiveArtifact>();
  if (stable) return { artifact: stable, via: 'stable' };
  const active = await env.DB.prepare(
    `SELECT id, version_id, mode, style, name, generator_version, etag, byte_size, chunk_count, created_at
     FROM map_artifacts
     WHERE name = ? AND active = 1
     ORDER BY id DESC LIMIT 1`,
  )
    .bind(name)
    .first<ActiveArtifact>();
  return active ? { artifact: active, via: 'active' } : null;
}
