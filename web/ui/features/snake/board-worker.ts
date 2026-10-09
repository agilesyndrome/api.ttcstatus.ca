import { buildSnakeMap } from '../../../../shared/map/game-map';
import type { ViewerData } from '../../../../shared/map/model';

/**
 * Board-derivation fallback worker. The published `/api/v1/map/snake`
 * artifact is the primary path (baked by the map generator at deploy time),
 * so this runs only when the artifact cannot be fetched. Deriving the collapsed
 * board is a whole-schematic graph rewrite; running it here keeps a cache
 * miss from stalling the main thread and dropping animation frames.
 */
self.onmessage = (event: MessageEvent<ViewerData>) => {
  try {
    (self as unknown as Worker).postMessage(buildSnakeMap(event.data).data);
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: String(error) });
  }
};
