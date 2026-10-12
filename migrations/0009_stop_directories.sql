-- One precomputed directory per map artifact: original geography and the exact
-- display-cluster mapping travel together. Public endpoints never ingest GPS.
CREATE TABLE IF NOT EXISTS map_stop_directories (
  artifact_id INTEGER PRIMARY KEY REFERENCES map_artifacts(id) ON DELETE CASCADE,
  etag TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1
);

-- Staging chunks reference the map, so metadata can be published only after all
-- chunks exist. A failed generation never exposes a partly written directory.
CREATE TABLE IF NOT EXISTS map_stop_directory_chunks (
  artifact_id INTEGER NOT NULL REFERENCES map_artifacts(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (artifact_id, chunk_index)
);
