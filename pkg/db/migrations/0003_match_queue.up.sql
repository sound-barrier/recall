-- Per-match queue-type tag (role / open). Presence of a row IS the
-- "queue known" signal; absence means "queue not set." Mirrors the
-- shape of match_reviews — a thin association table keyed by
-- match_key. 3NF: queue_type + overridden_at are non-key attributes
-- fully and only dependent on the PK. Real value comes from the user
-- toggling the radiogroup in the right-panel detail view; a future
-- parser update will also write here when it can count team rows
-- on a scoreboard screenshot (5 per team = role, 6 per team = open).
CREATE TABLE IF NOT EXISTS match_queue (
  match_key     TEXT PRIMARY KEY,
  queue_type    TEXT NOT NULL CHECK (queue_type IN ('role', 'open')),
  overridden_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end
