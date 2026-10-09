import { buildViewerData, type ViewerSource } from '../../../shared/map/model';
import { buildSnakeMap } from '../../../shared/map/game-map';
import { storeMapArtifact } from './artifacts/artifact-store';
import { buildStreetcarMapBundle } from './layout/build-map';
import {
  SNAKE_BOARD_STYLE,
  SNAKE_MAP_NAME,
  TTCSTATUS_BOARD_STYLE,
  TTCSTATUS_MAP_NAME,
} from './config';
import { loadMapSourceData } from './source/repository';
import type { MapGeneratorEnv } from './types';

export type { MapGeneratorEnv } from './types';

/**
 * Map generation orchestration deliberately stays tiny:
 *   D1 normalized data -> pure bundle builder -> D1 artifact store.
 *
 * Keeping IO at the edges makes the geometry code independently reviewable and
 * gives us a clean seam for the future topology-aware generator. Each imported
 * network version publishes the schematic map ('streetcar') and the derived
 * board twice: as the snake game board ('snake') and as the stable site map
 * ('ttcstatus') the main ttcstatus.ca homepage consumes. The two board names
 * share one payload today but separate lifecycles: future snake-game changes
 * land on 'snake' only, never on the production 'ttcstatus' map.
 */
export async function generateStreetcarMap(
  env: MapGeneratorEnv,
  versionId: number,
): Promise<{
  artifactId: number;
  snakeArtifactId: number;
  ttcstatusArtifactId: number;
}> {
  const source = await loadMapSourceData(env, versionId);
  const bundle = buildStreetcarMapBundle(source, env.SOURCE_ATTRIBUTION);
  const artifactId = await storeMapArtifact(env, versionId, bundle);

  // Validate the exact React contract before deriving the board artifacts.
  // The bundle is opaque to its builder, but its public shape is this source.
  const viewer = buildViewerData(bundle as ViewerSource);
  const board = buildSnakeMap(viewer).data;
  const snakeArtifactId = await storeMapArtifact(env, versionId, board, {
    name: SNAKE_MAP_NAME,
    style: SNAKE_BOARD_STYLE,
  });
  // The stable site map is the same derived board published under its own
  // immutable name so the homepage never depends on the snake game artifact.
  const ttcstatusArtifactId = await storeMapArtifact(env, versionId, board, {
    name: TTCSTATUS_MAP_NAME,
    style: TTCSTATUS_BOARD_STYLE,
  });
  return { artifactId, snakeArtifactId, ttcstatusArtifactId };
}
