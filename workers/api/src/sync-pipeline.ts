import { recordFeedDelta } from "./feed-delta";
import { importNetworkVersion } from "./import-version";
import {
  activateNetworkVersion,
  pruneOldNetworkVersions,
  requestMapGeneration,
} from "./network-lifecycle";
import { ensureState, nowIso, type NetworkVersion, type SyncEnv, type SyncResult } from "./sync-common";

/**
 * Advance one downloaded/reusable source version through the publish pipeline.
 *
 * Stages are deliberately obvious and ordered:
 *   1. parse cached R2 source -> normalized D1 rows
 *   2. generate immutable Snake map artifact
 *   3. record compact source delta
 *   4. atomically-ish flip active pointers
 *   5. prune expensive old materializations
 *
 * The previously active version remains untouched until stage 4 succeeds.
 */
export async function processVersion(env: SyncEnv, version: NetworkVersion): Promise<SyncResult> {
  const previousVersionId = (await ensureState(env)).active_version_id;

  try {
    if (["downloaded", "failed_import", "importing"].includes(version.status)) {
      await importNetworkVersion(env, version);
    }

    await env.DB.prepare(
      `UPDATE network_versions SET status = 'generating_map', error = NULL WHERE id = ?`,
    ).bind(version.id).run();
    version.status = "generating_map";

    const artifactId = await requestMapGeneration(env, version.id);
    await recordFeedDelta(env, previousVersionId, version.id);
    await activateNetworkVersion(env, version, artifactId);
    await pruneOldNetworkVersions(env);

    return {
      status: "updated",
      reason: "new-static-gtfs-activated",
      versionId: version.id,
      sourceCheckedAt: nowIso(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = version.status === "generating_map" ? "map_failed" : "failed_import";
    await env.DB.prepare(
      `UPDATE network_versions SET status = ?, error = ? WHERE id = ?`,
    ).bind(status, message.slice(0, 2000), version.id).run();
    throw error;
  }
}
