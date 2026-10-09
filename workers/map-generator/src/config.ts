/**
 * Stable knobs for the current Snake map format.
 *
 * Keep these together so a reviewer can see exactly which values change the
 * generated public artifact. Bump GENERATOR_VERSION whenever a change here can
 * alter output geometry or the bundle schema.
 */
export const GENERATOR_VERSION = 'snake-v1.4.2';
export const MAP_STYLE = 'snake-v1';
export const MAP_MODE = 'streetcar';

// Published map names (their public API paths) and the snake game-board style.
// The schematic map keeps its historical style name 'snake-v1'; the game-board
// artifact of the same network is a distinct style so artifact rows never
// collide on the (version_id, mode, style) uniqueness key.
export const STREETCAR_MAP_NAME = 'streetcar';
export const SNAKE_MAP_NAME = 'snake';
export const SNAKE_BOARD_STYLE = 'snake-board-v1';
// The main ttcstatus.ca map is the published snake-derived board under its own
// immutable name, frozen here as the stable site map. The snake game's 'snake'
// artifact can then evolve freely (gameplay, performance, board geometry)
// without touching the production status map: same payload today, decoupled
// lifecycles tomorrow.
export const TTCSTATUS_MAP_NAME = 'ttcstatus';
export const TTCSTATUS_BOARD_STYLE = 'ttcstatus-board-v1';

// Conservative v1 simplification. Future topology-aware generation should
// replace raw RDP, but this keeps the present implementation inexpensive.
export const RDP_TOLERANCE_METRES = 18;
export const STOP_CLUSTER_METRES = 34;
export const TRACK_SNAP_METRES = 12;
export const STREET_GRID_DEGREES = 16;

// D1 has a 2 MB row limit. Keep map chunks far below it to leave headroom for
// encoding/SQLite overhead and future schema growth.
export const ARTIFACT_CHUNK_CHARACTERS = 300_000;

// Local planar reference point used only for short-distance map math in Toronto.

export {
  DISPLAY_WIDTH,
  DISPLAY_HEIGHT,
  DISPLAY_PADDING,
  REFERENCE_LATITUDE,
  REFERENCE_LONGITUDE,
} from '../../../shared/map/config';
