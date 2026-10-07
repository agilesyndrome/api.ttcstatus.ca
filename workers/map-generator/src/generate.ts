import { buildViewerData, type ViewerSource } from '../../../shared/map/model';
import { buildSnakeMap } from '../../../shared/map/game-map';
import { storeMapArtifact } from './artifacts/artifact-store';
import { buildStreetcarMapBundle } from './layout/build-map';
import { SNAKE_BOARD_STYLE, SNAKE_MAP_NAME } from './config';
import { loadMapSourceData } from './source/repository';
import type { MapGeneratorEnv } from './types';

export type { MapGeneratorEnv } from './types';

/**
 * Map generation orchestration deliberately stays tiny:
 *   D1 normalized data -> pure bundle builder -> D1 artifact store.
 *
 * Keeping IO at the edges makes the geometry code independently reviewable and
 * gives us a clean seam for the future topology-aware generator. Each imported
 * network version publishes the schematic map ('streetcar') and the snake game
 * board ('snake') as two named immutable artifacts.
 */
export async function generateStreetcarMap(
  env: MapGeneratorEnv,
  versionId: number,
): Promise<{ artifactId: number; snakeArtifactId: number }> {
  const source = await loadMapSourceData(env, versionId);
  const bundle = buildStreetcarMapBundle(source, env.SOURCE_ATTRIBUTION);
  const artifactId = await storeMapArtifact(env, versionId, bundle);

  // Validate the exact React contract before deriving the second artifact.
  // The bundle is opaque to its builder, but its public shape is this source.
  const viewer = buildViewerData(bundle as ViewerSource);
  const snake = buildSnakeMap(viewer).data;
  const snakeArtifactId = await storeMapArtifact(env, versionId, snake, {
    name: SNAKE_MAP_NAME,
    style: SNAKE_BOARD_STYLE,
  });
  return { artifactId, snakeArtifactId };
}
