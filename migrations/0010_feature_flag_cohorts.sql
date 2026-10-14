-- Percentage cohorts for progressive feature rollout. A cohort is separate
-- from named grants so an operator can remove a rollout without touching the
-- audit trail for explicit users.
CREATE TABLE feature_flag_cohorts (
  flag TEXT PRIMARY KEY CHECK (length(flag) BETWEEN 1 AND 64),
  percentage INTEGER NOT NULL CHECK (percentage BETWEEN 0 AND 100),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 255)
);
