-- Saved stops follow the journal pattern: Clerk owns identity, D1 owns data.
CREATE TABLE user_saved_stops (
  user_id TEXT PRIMARY KEY,
  stop_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(stop_ids)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);