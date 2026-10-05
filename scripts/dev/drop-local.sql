PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS map_artifact_chunks;
DROP TABLE IF EXISTS map_artifacts;
DROP TABLE IF EXISTS map_generation_jobs;
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

PRAGMA foreign_keys = ON;
