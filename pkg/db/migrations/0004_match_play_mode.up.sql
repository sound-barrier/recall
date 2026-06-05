-- Per-match play-mode tag (quickplay / competitive). Presence of a
-- row IS the user-set override; absence means "fall back to whatever
-- the parser captured in data.mode (or rank-row presence)." Mirrors
-- the shape of match_queue — a thin association table keyed by
-- match_key. 3NF: play_mode + set_at are non-key attributes fully
-- and only dependent on the PK.
CREATE TABLE IF NOT EXISTS match_play_mode (
  match_key TEXT PRIMARY KEY,
  play_mode TEXT NOT NULL CHECK (play_mode IN ('quickplay', 'competitive')),
  set_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end
