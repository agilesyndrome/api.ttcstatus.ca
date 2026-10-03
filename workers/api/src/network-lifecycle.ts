import { SOURCE_KEY, nowIso, type NetworkVersion, type SyncEnv } from "./sync-common";

/** Ask the separately deployed map Worker to precompute this network version. */
export async function requestMapGeneration(env: SyncEnv, versionId: number): Promise<number> {
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO map_generation_jobs (version_id, mode, generator, status, created_at)
     VALUES (?, 'streetcar', 'snake-v1', 'pending', ?)`,
  ).bind(versionId, createdAt).run();

  const response = await env.MAP_GENERATOR.fetch("https://map-generator.internal/api/internal/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId, mode: "streetcar", style: "snake-v1" }),
  });

  const payload = await response.json().catch(() => ({})) as { artifactId?: number; error?: string };
  if (!response.ok || !payload.artifactId) {
    throw new Error(payload.error || `Map generator returned HTTP ${response.status}`);
  }
  return payload.artifactId;
}

/**
 * Flip network + map pointers together only after both import and generation
 * succeed. Readers therefore never observe a half-published network version.
 */
export async function activateNetworkVersion(
  env: SyncEnv,
  version: NetworkVersion,
  artifactId: number,
): Promise<void> {
  const activatedAt = nowIso();

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE network_versions SET active = 0
       WHERE source_key = ? AND active = 1`,
    ).bind(SOURCE_KEY),
    env.DB.prepare(
      `UPDATE map_artifacts SET active = 0
       WHERE mode = 'streetcar' AND style = 'snake-v1' AND active = 1`,
    ),
    env.DB.prepare(
      `UPDATE network_versions
       SET active = 1, status = 'active', error = NULL, activated_at = ?
       WHERE id = ?`,
    ).bind(activatedAt, version.id),
    env.DB.prepare(`UPDATE map_artifacts SET active = 1 WHERE id = ?`).bind(artifactId),
    env.DB.prepare(
      `UPDATE source_state
       SET source_url = ?, source_etag = ?, source_last_modified = ?,
           source_content_length = ?, r2_etag = ?, r2_key = ?, active_version_id = ?,
           last_checked_at = ?, last_changed_at = ?, last_error = NULL
       WHERE source_key = ?`,
    ).bind(
      version.source_url,
      version.source_etag,
      version.source_last_modified,
      version.source_content_length,
      version.r2_etag,
      version.r2_key,
      version.id,
      activatedAt,
      activatedAt,
      SOURCE_KEY,
    ),
  ]);
}

/**
 * Cost-control policy: retain detailed materialization and raw R2 ZIPs for only
 * the two newest changed versions. Compact change events remain long-term.
 */
export async function pruneOldNetworkVersions(env: SyncEnv): Promise<void> {
  const versions = (await env.DB.prepare(
    `SELECT id, r2_key, raw_retained
     FROM network_versions
     WHERE source_key = ?
     ORDER BY id DESC`,
  ).bind(SOURCE_KEY).all<{ id: number; r2_key: string; raw_retained: number }>()).results;

  for (const version of versions.slice(2)) {
    if (version.raw_retained === 1) {
      await env.GTFS_BUCKET.delete(version.r2_key);
      await env.DB.prepare(
        `UPDATE network_versions SET raw_retained = 0 WHERE id = ?`,
      ).bind(version.id).run();
    }

    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM map_artifact_chunks
         WHERE artifact_id IN (SELECT id FROM map_artifacts WHERE version_id = ?)`,
      ).bind(version.id),
      env.DB.prepare(`DELETE FROM map_artifacts WHERE version_id = ?`).bind(version.id),
      env.DB.prepare(`DELETE FROM gtfs_pattern_stops WHERE version_id = ?`).bind(version.id),
      env.DB.prepare(`DELETE FROM gtfs_stops WHERE version_id = ?`).bind(version.id),
      env.DB.prepare(`DELETE FROM gtfs_shapes WHERE version_id = ?`).bind(version.id),
      env.DB.prepare(`DELETE FROM gtfs_patterns WHERE version_id = ?`).bind(version.id),
      env.DB.prepare(`DELETE FROM gtfs_routes WHERE version_id = ?`).bind(version.id),
    ]);
  }
}
