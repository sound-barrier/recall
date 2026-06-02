-- Per-match review-status tag (self / coach). Presence of a row IS
-- the "reviewed" signal; absence means "not reviewed." Mirrors the
-- shape of hidden_matches — a thin association table keyed by
-- match_key. 3NF: reviewed_by + reviewed_at are non-key attributes
-- fully and only dependent on the PK.
CREATE TABLE IF NOT EXISTS match_reviews (
  match_key   TEXT PRIMARY KEY,
  reviewed_by TEXT NOT NULL CHECK (reviewed_by IN ('self', 'coach')),
  reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end
