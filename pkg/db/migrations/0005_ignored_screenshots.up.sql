-- Per-file ignore-list for the "Delete forever" affordance on the
-- Unknown tab's unmatched section. Presence of a row IS the "ignored"
-- signal; absence means "fair game for parse." Mirrors the shape of
-- hidden_matches + match_reviews — a thin lookup table keyed by the
-- screenshot's filename. The parse pipeline loads this set once per
-- run and skips any file whose name is in it, so the user can
-- permanently dismiss a screenshot without deleting the file on disk.
CREATE TABLE IF NOT EXISTS ignored_screenshots (
  filename   TEXT PRIMARY KEY,
  ignored_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end
