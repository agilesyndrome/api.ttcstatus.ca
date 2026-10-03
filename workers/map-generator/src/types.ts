/** D1 row shapes and map-generator domain types. Keep SQL naming at this edge. */
import type { D1Database } from "../../shared/cloudflare";

export interface MapGeneratorEnv {
  DB: D1Database;
  SOURCE_ATTRIBUTION: string;
  SYNC_TOKEN?: string;
}

export interface VersionRow {
  id: number;
  source_url: string;
  source_etag: string | null;
  source_last_modified: string | null;
  fetched_at: string;
  imported_at: string | null;
  route_count: number;
  pattern_count: number;
  shape_count: number;
  stop_count: number;
}

export interface RouteRow {
  route_id: string;
  short_name: string;
  long_name: string;
  route_type: number;
  color: string;
  text_color: string;
}

export interface PatternRow {
  pattern_id: string;
  route_id: string;
  direction_id: number;
  shape_id: string;
  headsign: string;
  trip_count: number;
}

export interface ShapeRow {
  shape_id: string;
  points_json: string;
}

export interface StopRow {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  location_type: number;
  parent_station: string;
  wheelchair_boarding: number;
}

export interface PatternStopRow {
  pattern_id: string;
  stop_id: string;
  stop_sequence: number;
}

export interface OverlayRow {
  id: string;
  name: string;
  kind: string;
  scheduled_service: number;
  points_json: string;
  source_note: string;
  verified_at: string | null;
}

export interface MapSourceData {
  version: VersionRow;
  routes: RouteRow[];
  patterns: PatternRow[];
  shapes: ShapeRow[];
  stops: StopRow[];
  patternStops: PatternStopRow[];
  overlays: OverlayRow[];
}

export type LatLon = [number, number];
export type XY = [number, number];
