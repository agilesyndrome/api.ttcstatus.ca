import { storeMapArtifact } from "./artifact-store";
import { buildStreetcarMapBundle } from "./build-map";
import { loadMapSourceData } from "./repository";
import type { MapGeneratorEnv } from "./types";

export type { MapGeneratorEnv } from "./types";

/**
 * Map generation orchestration deliberately stays tiny:
 *   D1 normalized data -> pure bundle builder -> D1 artifact store.
 *
 * Keeping IO at the edges makes the geometry code independently reviewable and
 * gives us a clean seam for the future topology-aware generator.
 */
export async function generateStreetcarMap(
  env: MapGeneratorEnv,
  versionId: number,
): Promise<number> {
  const source = await loadMapSourceData(env, versionId);
  const bundle = buildStreetcarMapBundle(source, env.SOURCE_ATTRIBUTION);
  return storeMapArtifact(env, versionId, bundle);
}
