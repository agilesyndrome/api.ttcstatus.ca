/**
 * Stable knobs for the current Snake map format.
 *
 * Keep these together so a reviewer can see exactly which values change the
 * generated public artifact. Bump GENERATOR_VERSION whenever a change here can
 * alter output geometry or the bundle schema.
 */
export const GENERATOR_VERSION = "snake-v1.2.0";
export const MAP_STYLE = "snake-v1";
export const MAP_MODE = "streetcar";

export const DISPLAY_WIDTH = 1600;
export const DISPLAY_HEIGHT = 1100;
export const DISPLAY_PADDING = 70;

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
export const REFERENCE_LATITUDE = 43.65;
export const REFERENCE_LONGITUDE = -79.38;
