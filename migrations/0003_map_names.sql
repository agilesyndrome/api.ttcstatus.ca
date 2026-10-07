-- Named map artifacts: every published map has a name (its public API path),
-- and arbitrary tags (e.g. latest, stable) point a name at one artifact id.
-- Existing schematic rows were all published under the streetcar name.

ALTER TABLE map_artifacts ADD COLUMN name TEXT NOT NULL DEFAULT 'streetcar';

CREATE TABLE IF NOT EXISTS map_tags (
  name TEXT NOT NULL,
  tag TEXT NOT NULL,
  artifact_id INTEGER NOT NULL REFERENCES map_artifacts(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(name, tag)
);

CREATE INDEX IF NOT EXISTS idx_map_tags_artifact ON map_tags(artifact_id);
CREATE INDEX IF NOT EXISTS idx_map_artifacts_name_active
  ON map_artifacts(name, active, id DESC);