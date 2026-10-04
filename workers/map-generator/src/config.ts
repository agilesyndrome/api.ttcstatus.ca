/**
 * Stable knobs for the current Snake map format.
 *
 * Keep these together so a reviewer can see exactly which values change the
 * generated public artifact. Bump GENERATOR_VERSION whenever a change here can
 * alter output geometry or the bundle schema.
 */
export const GENERATOR_VERSION = 'snake-v1.4.0';
export const MAP_STYLE = 'snake-v1';
export const MAP_MODE = 'streetcar';

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
