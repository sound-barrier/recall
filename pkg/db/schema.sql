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
  map           TEXT NOT NULL DEFAULT '',
  map_raw       TEXT NOT NULL DEFAULT '',
  playlist          TEXT NOT NULL DEFAULT '',
  hero          TEXT NOT NULL DEFAULT '',
  hero_raw      TEXT NOT NULL DEFAULT '',
  result        TEXT NOT NULL DEFAULT '',
  final_score   TEXT NOT NULL DEFAULT '',
  date          TEXT NOT NULL DEFAULT '',
  finished_at   TEXT NOT NULL DEFAULT '',
  game_length   TEXT NOT NULL DEFAULT '',
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
  play_time       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (summary_screenshot_id, hero)
);
-- statement-end

CREATE TABLE IF NOT EXISTS teams_screenshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL UNIQUE,
  match_key     TEXT NOT NULL,
  parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs(id) ON DELETE RESTRICT,
  -- The in-game teams scoreboard is a combat-stats source only; match
  -- identity (map, playlist, hero, role) comes from the SUMMARY / RANK /
  -- PERSONAL screenshots and is merged in by correlation.
  eliminations  INTEGER NOT NULL DEFAULT 0,
  assists       INTEGER NOT NULL DEFAULT 0,
  deaths        INTEGER NOT NULL DEFAULT 0,
  damage        INTEGER NOT NULL DEFAULT 0,
  healing       INTEGER NOT NULL DEFAULT 0,
  mitigation    INTEGER NOT NULL DEFAULT 0,
  -- Queue format inferred from players-per-team on the teams:
  -- 'role' (5v5) or 'open' (6v6); '' when the count couldn't be read.
  -- A user-set match_queue annotation overrides this at read time.
  queue_type    TEXT NOT NULL DEFAULT ''
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_teams_match_key_parsed_at ON teams_screenshots(match_key, parsed_at);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_teams_ead ON teams_screenshots(eliminations, assists, deaths);
-- statement-end

CREATE TABLE IF NOT EXISTS teams_hero_stats (
  teams_screenshot_id INTEGER NOT NULL REFERENCES teams_screenshots(id) ON DELETE CASCADE,
  hero        TEXT NOT NULL,
  stat_key    TEXT NOT NULL,
  stat_value  INTEGER NOT NULL,
  PRIMARY KEY (teams_screenshot_id, hero, stat_key)
);
-- statement-end

CREATE TABLE IF NOT EXISTS personal_screenshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL UNIQUE,
  match_key     TEXT NOT NULL,
  parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs(id) ON DELETE RESTRICT,
  hero          TEXT NOT NULL DEFAULT '',
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
  rank            TEXT NOT NULL DEFAULT '',
  level           INTEGER NOT NULL DEFAULT 0,
  rank_progress   INTEGER NOT NULL DEFAULT 0,
  change_percent  INTEGER NOT NULL DEFAULT 0,
  result          TEXT NOT NULL DEFAULT ''
);
-- statement-end
CREATE INDEX IF NOT EXISTS idx_rank_match_key_parsed_at ON rank_screenshots(match_key, parsed_at);
-- statement-end

CREATE TABLE IF NOT EXISTS rank_modifiers (
  rank_screenshot_id INTEGER NOT NULL REFERENCES rank_screenshots(id) ON DELETE CASCADE,
  -- Vocabulary mirrors parser.knownModifiers + "demotion protection" (detected
  -- separately in parseRank). Keep in sync: a new modifier in pkg/parser must be
  -- added here too, or its insert fails. Mirrors the leaver/queue_type/play_mode
  -- /result enum CHECK constraints on the sibling tables.
  modifier TEXT NOT NULL CHECK (modifier IN (
    'expected', 'uphill battle', 'reversal', 'consolation',
    'win streak', 'loss streak', 'calibration', 'volatile',
    'new map', 'leaver compensation', 'victory', 'defeat', 'draw',
    'demotion protection'
  )),
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

-- Recognized-but-unstored skip list for the PERSONAL "All Heroes" aggregate
-- view. The parser classifies it ("all_heroes") but extracts nothing — its
-- combat totals duplicate the TEAMS screen and its card icons defeat the OCR.
-- Recording only the filename keeps the screen out of the next OCR run (like
-- ignored_screenshots) without a garbage match row or an Unknown-tab entry.
CREATE TABLE IF NOT EXISTS all_heroes_screenshots (
  filename      TEXT PRIMARY KEY,
  recognized_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end

-- User match-data override layer. The single source for BOTH features:
--   * editing an OCR match  -> a row with only the changed columns non-NULL
--   * a hand-entered match  -> a row + children with NO screenshot rows anywhere
-- Grafted over the OCR Data at read time by AttachUserData (pkg/aggregate),
-- mirroring the match_annotations / match_queue override pattern. Reset-to-OCR
-- and manual-delete both = DELETE the row (children cascade).
--
-- Every scalar may be NULL on purpose: NULL means "not overridden, use OCR",
-- so a user-entered damage of 0 (non-NULL) is distinct from "unset" (NULL).
-- queue_type / play_mode are NOT here — they keep their existing aux tables
-- (match_queue / match_play_mode); manual entry writes those directly.
CREATE TABLE IF NOT EXISTS user_match_data (
  match_key      TEXT PRIMARY KEY,
  map            TEXT,
  hero           TEXT,
  eliminations   INTEGER,
  assists        INTEGER,
  deaths         INTEGER,
  damage         INTEGER,
  healing        INTEGER,
  mitigation     INTEGER,
  result         TEXT CHECK (result IS NULL OR result IN ('victory','defeat','draw')),
  final_score    TEXT,
  date           TEXT,
  finished_at    TEXT,
  game_length    TEXT,
  rank           TEXT,
  level          INTEGER,
  rank_progress  INTEGER,
  change_percent INTEGER,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-end

-- Heroes-played list. position 0 = primary (drives card header + derived role,
-- matching the OCR "first in heroes_played is primary" rule). percent_played /
-- play_time may be NULL (manual entry has neither).
CREATE TABLE IF NOT EXISTS user_match_heroes (
  match_key      TEXT NOT NULL REFERENCES user_match_data(match_key) ON DELETE CASCADE,
  hero           TEXT NOT NULL,
  percent_played INTEGER,
  play_time      TEXT,
  position       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_key, hero)
);
-- statement-end

CREATE TABLE IF NOT EXISTS user_match_hero_stats (
  match_key   TEXT NOT NULL REFERENCES user_match_data(match_key) ON DELETE CASCADE,
  hero        TEXT NOT NULL,
  stat_key    TEXT NOT NULL,
  stat_value  INTEGER NOT NULL,
  PRIMARY KEY (match_key, hero, stat_key)
);
-- statement-end

CREATE TABLE IF NOT EXISTS user_match_sr (
  match_key   TEXT NOT NULL REFERENCES user_match_data(match_key) ON DELETE CASCADE,
  hero        TEXT NOT NULL,
  sr          INTEGER NOT NULL DEFAULT 0,
  change      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_key, hero)
);
-- statement-end

CREATE TABLE IF NOT EXISTS user_match_rank_modifiers (
  match_key   TEXT NOT NULL REFERENCES user_match_data(match_key) ON DELETE CASCADE,
  modifier    TEXT NOT NULL,
  PRIMARY KEY (match_key, modifier)
);
-- statement-end
