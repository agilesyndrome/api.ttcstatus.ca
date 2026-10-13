-- Drop in FK-safe order (children before parents). workerd's D1 does not
-- honor PRAGMA foreign_keys from an execute file, so child tables that
-- reference parents must be dropped first or the DROP fails with
-- SQLITE_CONSTRAINT_FOREIGNKEY. Keep this in sync with migrations/.

DROP TABLE IF EXISTS map_stop_directory_chunks;
DROP TABLE IF EXISTS map_stop_directories;
DROP TABLE IF EXISTS map_tags;
DROP TABLE IF EXISTS map_artifact_chunks;
DROP TABLE IF EXISTS map_artifacts;
DROP TABLE IF EXISTS map_generation_jobs;
DROP TABLE IF EXISTS sla_fold_meta;
DROP TABLE IF EXISTS sla_weekly;
DROP TABLE IF EXISTS sla_daily;
DROP TABLE IF EXISTS sla_route_targets;
DROP TABLE IF EXISTS sla_schedule_targets;
DROP TABLE IF EXISTS sla_schedule_dates;
DROP TABLE IF EXISTS service_rollups;
DROP TABLE IF EXISTS feature_flags;
DROP TABLE IF EXISTS user_saved_stops;
DROP TABLE IF EXISTS feed_change_events;
DROP TABLE IF EXISTS gtfs_pattern_stops;
DROP TABLE IF EXISTS gtfs_patterns;
DROP TABLE IF EXISTS gtfs_shapes;
DROP TABLE IF EXISTS gtfs_stops;
DROP TABLE IF EXISTS gtfs_routes;
DROP TABLE IF EXISTS network_versions;
DROP TABLE IF EXISTS source_state;
DROP TABLE IF EXISTS infrastructure_overlays;
DROP TABLE IF EXISTS user_journals;
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS d1_migrations;
