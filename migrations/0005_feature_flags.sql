-- Per-user feature flags (sla-epics.md §0B; sla.md §4.7): Clerk owns identity,
-- D1 owns grants. The server can only verify the Clerk user id server-side
-- (spike outcome, E5S1), so the subject is the user id — emails churn, user ids
-- don't. The operator CLI accepts either and resolves emails to user ids
-- before granting. Gating scaffolding per user keeps "shipped" from meaning
-- "visible to everyone".
CREATE TABLE feature_flags (
  flag TEXT NOT NULL CHECK (length(flag) BETWEEN 1 AND 64),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  granted_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL CHECK (length(granted_by) BETWEEN 1 AND 255),
  PRIMARY KEY (flag, subject)
);
