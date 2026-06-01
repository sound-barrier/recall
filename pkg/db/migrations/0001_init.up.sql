-- Baseline schema (migration 0001). Statements are separated by
-- `-- statement-end`. The migration runner splits on that token and
-- executes each piece via a single Exec call, so a syntax error
-- points at exactly one statement.

CREATE TABLE IF NOT EXISTS screenshots_dirs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT NOT NULL UNIQUE,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end

CREATE TABLE IF NOT EXISTS summary_screenshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL UNIQUE,
  match_key     TEXT NOT NULL,
  parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  screenshots_dir_id INTEGER REFERENCES screenshots_dirs(id) ON DELETE SET NULL,
  map           TEXT,
  mode          TEXT,
  hero          TEXT,
  result        TEXT,
  final_score   TEXT,
  date          TEXT,
  finished_at   TEXT,
  game_length   TEXT,
  perf_elim_total            INTEGER NOT NULL DEFAULT 0,
  perf_elim_avg_per_10min    REAL    NOT NULL DEFAULT 0,
  perf_assists_total         INTEGER NOT NULL DEFAULT 0,
  perf_assists_avg_per_10min REAL    NOT NULL DEFAULT 0,
  perf_deaths_total          INTEGER NOT NULL DEFAULT 0,
  perf_deaths_avg_per_10min  REAL    NOT NULL DEFAULT 0
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_summary_match_key ON summary_screenshots(match_key);
-- statement-end

CREATE TABLE IF NOT EXISTS summary_heroes_played (
  summary_screenshot_id INTEGER NOT NULL REFERENCES summary_screenshots(id) ON DELETE CASCADE,
  hero            TEXT NOT NULL,
  percent_played  INTEGER NOT NULL DEFAULT 0,
  play_time       TEXT,
  PRIMARY KEY (summary_screenshot_id, hero)
);
-- statement-end

CREATE TABLE IF NOT EXISTS scoreboard_screenshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL UNIQUE,
  match_key     TEXT NOT NULL,
  parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  screenshots_dir_id INTEGER REFERENCES screenshots_dirs(id) ON DELETE SET NULL,
  map           TEXT,
  mode          TEXT,
  hero          TEXT,
  eliminations  INTEGER NOT NULL DEFAULT 0,
  assists       INTEGER NOT NULL DEFAULT 0,
  deaths        INTEGER NOT NULL DEFAULT 0,
  damage        INTEGER NOT NULL DEFAULT 0,
  healing       INTEGER NOT NULL DEFAULT 0,
  mitigation    INTEGER NOT NULL DEFAULT 0
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_scoreboard_match_key ON scoreboard_screenshots(match_key);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_scoreboard_ead       ON scoreboard_screenshots(eliminations, assists, deaths);
-- statement-end

CREATE TABLE IF NOT EXISTS scoreboard_hero_stats (
  scoreboard_screenshot_id INTEGER NOT NULL REFERENCES scoreboard_screenshots(id) ON DELETE CASCADE,
  hero        TEXT NOT NULL,
  stat_key    TEXT NOT NULL,
  stat_value  INTEGER NOT NULL,
  PRIMARY KEY (scoreboard_screenshot_id, hero, stat_key)
);
-- statement-end

CREATE TABLE IF NOT EXISTS personal_screenshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL UNIQUE,
  match_key     TEXT NOT NULL,
  parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  screenshots_dir_id INTEGER REFERENCES screenshots_dirs(id) ON DELETE SET NULL,
  hero          TEXT
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_personal_match_key ON personal_screenshots(match_key);
-- statement-end

CREATE TABLE IF NOT EXISTS personal_hero_stats (
  personal_screenshot_id INTEGER NOT NULL REFERENCES personal_screenshots(id) ON DELETE CASCADE,
  hero        TEXT NOT NULL,
  stat_key    TEXT NOT NULL,
  stat_value  INTEGER NOT NULL,
  PRIMARY KEY (personal_screenshot_id, hero, stat_key)
);
-- statement-end

CREATE TABLE IF NOT EXISTS rank_screenshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  filename        TEXT NOT NULL UNIQUE,
  match_key       TEXT NOT NULL,
  parsed_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  screenshots_dir_id INTEGER REFERENCES screenshots_dirs(id) ON DELETE SET NULL,
  rank            TEXT,
  level           INTEGER NOT NULL DEFAULT 0,
  rank_progress   INTEGER NOT NULL DEFAULT 0,
  change_percent  INTEGER NOT NULL DEFAULT 0,
  result          TEXT
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_rank_match_key ON rank_screenshots(match_key);
-- statement-end

CREATE TABLE IF NOT EXISTS rank_modifiers (
  rank_screenshot_id INTEGER NOT NULL REFERENCES rank_screenshots(id) ON DELETE CASCADE,
  modifier TEXT NOT NULL,
  PRIMARY KEY (rank_screenshot_id, modifier)
);
-- statement-end

CREATE TABLE IF NOT EXISTS rank_sr (
  rank_screenshot_id INTEGER NOT NULL REFERENCES rank_screenshots(id) ON DELETE CASCADE,
  hero      TEXT NOT NULL,
  sr        INTEGER NOT NULL DEFAULT 0,
  change    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rank_screenshot_id, hero)
);
-- statement-end

CREATE TABLE IF NOT EXISTS match_annotations (
  match_key    TEXT PRIMARY KEY,
  leaver       TEXT CHECK (leaver IS NULL OR leaver IN ('self','team','enemy')),
  note         TEXT,
  replay_code  TEXT,
  annotated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- statement-end

CREATE TABLE IF NOT EXISTS match_annotation_members (
  match_key TEXT NOT NULL,
  member    TEXT NOT NULL,
  PRIMARY KEY (match_key, member),
  FOREIGN KEY (match_key) REFERENCES match_annotations(match_key) ON DELETE CASCADE
);
-- statement-end

CREATE TABLE IF NOT EXISTS match_annotation_tags (
  match_key TEXT NOT NULL,
  tag       TEXT NOT NULL,
  PRIMARY KEY (match_key, tag),
  FOREIGN KEY (match_key) REFERENCES match_annotations(match_key) ON DELETE CASCADE
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_match_annotation_tags_tag ON match_annotation_tags(tag);
-- statement-end

CREATE TABLE IF NOT EXISTS hidden_matches (
  match_key TEXT PRIMARY KEY,
  hidden_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- statement-end

CREATE TABLE IF NOT EXISTS unknown_screenshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL UNIQUE,
  match_key   TEXT NOT NULL,
  parsed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  screenshots_dir_id INTEGER REFERENCES screenshots_dirs(id) ON DELETE SET NULL
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_unknown_match_key ON unknown_screenshots(match_key);
-- statement-end

CREATE TABLE IF NOT EXISTS ambiguous_candidates (
  filename     TEXT NOT NULL,
  match_key    TEXT NOT NULL,
  distance_s   INTEGER NOT NULL,
  PRIMARY KEY (filename, match_key)
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_ambig_cand_match_key ON ambiguous_candidates(match_key);
-- statement-end
