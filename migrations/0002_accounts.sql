-- Clerk owns identity; these tables contain only TTCstatus application data.
CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  public_badges INTEGER NOT NULL DEFAULT 0 CHECK (public_badges IN (0, 1))
);
CREATE TABLE user_journals (
  user_id TEXT PRIMARY KEY,
  entries TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(entries)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
