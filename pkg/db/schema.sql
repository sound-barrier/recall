-- Consolidated schema applied by NewSQLStore. Statements are
-- separated by `-- statement-end`; the runner splits on that token
-- and executes each piece via a single Exec so a syntax error
-- points at exactly one statement.
--
-- Pre-1.0 the project is "wipe + relaunch" when the schema changes;
-- there is no migration framework and no `schema_version` table.
-- Every CREATE uses `IF NOT EXISTS` so re-opening an existing DB is
-- safe but a structurally drifted DB is the operator's signal to
-- wipe (see CONTRIBUTING.md).
--
-- Conventions baked into this schema:
--
--   - Identifiers are snake_case throughout. The HTTP surface
--     mirrors this — REST path params + JSON keys are snake_case
--     end-to-end; see `.claude/rules/database.md` +
--     `.claude/rules/api-design.md`.
--   - `screenshots_dir_id` FKs use `ON DELETE RESTRICT` to forbid
--     deleting a `screenshots_dirs` row that any screenshot still
--     references. Drop dependent rows first to free the dir.
--   - Parent tables carry a composite `(match_key, parsed_at)`
--     index. The leading `match_key` covers single-column queries;
--     the trailing `parsed_at` removes the sort step in
--     `aggregateAll`'s bulk load + group.
--   - `hero_raw` / `map_raw` preserve the OCR'd string when the
--     parser's canonical matcher rejects the candidate. UI surfaces
--     "Unknown hero (miyazaki?)" / "Unknown map (X?)" chips by
--     reading data.hero == '' AND data.hero_raw != '' (same for
--     map). After a YAML release adds a new hero/map, App.Startup's
--     boot re-aggregate walks WHERE hero='' AND hero_raw != '' and
--     re-runs the matcher against the current roster.

CREATE TABLE IF NOT EXISTS screenshots_dirs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT NOT NULL UNIQUE,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end
-- Sentinel row at id=1 for "dir unset" — referenced by every parent
-- row that lacks a real screenshots dir (test fixtures, legacy
-- pre-1.0 imports). `EnsureScreenshotsDir("")` returns 1, so the
-- foreign key always points at a real row and `screenshots_dir_id`
-- can be `NOT NULL`.
INSERT OR IGNORE INTO screenshots_dirs (id, path) VALUES (1, '');
-- statement-end

CREATE TABLE IF NOT EXISTS summary_screenshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL UNIQUE,
  match_key     TEXT NOT NULL,
  parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs(id) ON DELETE RESTRICT,
  map           TEXT,
  map_raw       TEXT NOT NULL DEFAULT '',
  mode          TEXT,
  hero          TEXT,
  hero_raw      TEXT NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_summary_match_key_parsed_at ON summary_screenshots(match_key, parsed_at);
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
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs(id) ON DELETE RESTRICT,
  map           TEXT,
  map_raw       TEXT NOT NULL DEFAULT '',
  mode          TEXT,
  hero          TEXT,
  hero_raw      TEXT NOT NULL DEFAULT '',
  eliminations  INTEGER NOT NULL DEFAULT 0,
  assists       INTEGER NOT NULL DEFAULT 0,
  deaths        INTEGER NOT NULL DEFAULT 0,
  damage        INTEGER NOT NULL DEFAULT 0,
  healing       INTEGER NOT NULL DEFAULT 0,
  mitigation    INTEGER NOT NULL DEFAULT 0
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_scoreboard_match_key_parsed_at ON scoreboard_screenshots(match_key, parsed_at);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_scoreboard_ead ON scoreboard_screenshots(eliminations, assists, deaths);
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
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs(id) ON DELETE RESTRICT,
  hero          TEXT,
  hero_raw      TEXT NOT NULL DEFAULT ''
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_personal_match_key_parsed_at ON personal_screenshots(match_key, parsed_at);
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
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs(id) ON DELETE RESTRICT,
  rank            TEXT,
  level           INTEGER NOT NULL DEFAULT 0,
  rank_progress   INTEGER NOT NULL DEFAULT 0,
  change_percent  INTEGER NOT NULL DEFAULT 0,
  result          TEXT
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_rank_match_key_parsed_at ON rank_screenshots(match_key, parsed_at);
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
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs(id) ON DELETE RESTRICT
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_unknown_match_key_parsed_at ON unknown_screenshots(match_key, parsed_at);
-- statement-end

CREATE TABLE IF NOT EXISTS ambiguous_candidates (
  filename         TEXT NOT NULL,
  match_key        TEXT NOT NULL,
  distance_seconds INTEGER NOT NULL,
  PRIMARY KEY (filename, match_key)
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_ambig_cand_match_key ON ambiguous_candidates(match_key);
-- statement-end

CREATE TABLE IF NOT EXISTS match_reviews (
  match_key   TEXT PRIMARY KEY,
  reviewed_by TEXT NOT NULL CHECK (reviewed_by IN ('self', 'coach')),
  reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end

CREATE TABLE IF NOT EXISTS match_queue (
  match_key     TEXT PRIMARY KEY,
  queue_type    TEXT NOT NULL CHECK (queue_type IN ('role', 'open')),
  overridden_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end

CREATE TABLE IF NOT EXISTS match_play_mode (
  match_key     TEXT PRIMARY KEY,
  play_mode     TEXT NOT NULL CHECK (play_mode IN ('quickplay', 'competitive')),
  overridden_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end

CREATE TABLE IF NOT EXISTS ignored_screenshots (
  filename   TEXT PRIMARY KEY,
  ignored_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end
