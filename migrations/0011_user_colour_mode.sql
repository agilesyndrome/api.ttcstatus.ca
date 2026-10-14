-- Colour vision is a user preference, not a service measurement. Keep the
-- default backwards-compatible so existing profile rows need no backfill.
ALTER TABLE user_profiles ADD COLUMN color_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK (color_mode IN ('standard', 'redgreen', 'full'));
