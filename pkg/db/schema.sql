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
--   - Every table is declared STRICT: SQLite enforces each column's
--     declared datatype on write (a value that can't losslessly
--     convert raises SQLITE_CONSTRAINT_DATATYPE) instead of applying
--     loose type affinity. STRICT permits only
--     INT/INTEGER/REAL/TEXT/BLOB/ANY — notably NOT `DATETIME`.
--   - Timestamps are therefore TEXT holding an explicit RFC3339 UTC
--     string, stamped by `strftime('%Y-%m-%dT%H:%M:%SZ','now')` rather
--     than `CURRENT_TIMESTAMP` (whose space-separated output isn't
--     RFC3339). This keeps the on-disk value self-describing and
--     byte-identical to the RFC3339 the Go loaders scan — the former
--     `DATETIME` affinity used to synthesize that via a driver
--     time.Time round-trip, which STRICT/TEXT no longer triggers.
--     Matches `played_at_utc`, already TEXT RFC3339.
--   - Identifiers are snake_case throughout. The HTTP surface
--     mirrors this — REST path params + JSON keys are snake_case
--     end-to-end; see `.claude/rules/database.md` +
--     `.claude/rules/api-design.md`.
--   - `screenshots_dir_id` FKs use `ON DELETE RESTRICT` to forbid
--     deleting a `screenshots_dirs` row that any screenshot still
--     references. Drop dependent rows first to free the dir.
--   - Parent tables carry a composite `(match_key, parsed_at)`
--     index. The leading `match_key` covers the single-column
--     by-key queries (hard delete, ambiguous resolution). The
--     trailing `parsed_at` is currently unexploited headroom: the
--     bulk loads read `ORDER BY id` and the aggregator sorts each
--     match group in memory.
--   - `hero_raw` / `map_raw` preserve the OCR'd string when the
--     parser's canonical matcher rejects the candidate. UI surfaces
--     "Unknown hero (miyazaki?)" / "Unknown map (X?)" chips by
--     reading data.hero == '' AND data.hero_raw != '' (same for
--     map). After a YAML release adds a new hero/map, App.Startup's
--     boot re-aggregate walks WHERE hero='' AND hero_raw != '' and
--     re-runs the matcher against the current roster.

CREATE TABLE IF NOT EXISTS screenshots_dirs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  first_seen_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end
-- Sentinel row at id=1 for "dir unset" — referenced by every parent
-- row that lacks a real screenshots dir (test fixtures, legacy
-- pre-1.0 imports). `EnsureScreenshotsDir("")` returns 1, so the
-- foreign key always points at a real row and `screenshots_dir_id`
-- can be `NOT NULL`.
INSERT OR IGNORE INTO screenshots_dirs (id, path) VALUES (1, '');
-- statement-end

CREATE TABLE IF NOT EXISTS summary_screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  match_key TEXT NOT NULL,
  parsed_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs (id) ON DELETE RESTRICT,
  map TEXT NOT NULL DEFAULT '',
  map_raw TEXT NOT NULL DEFAULT '',
  playlist TEXT NOT NULL DEFAULT '',
  hero TEXT NOT NULL DEFAULT '',
  hero_raw TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  final_score TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  game_length TEXT NOT NULL DEFAULT '',
  -- Canonical UTC instant of the match, derived at parse time by applying the
  -- machine's timezone identity to the naive local date+finished_at (DST-correct
  -- per match date). NULL when date/finished_at are absent/unparseable. The
  -- naive date/finished_at + match_key stay naive-local on purpose — the
  -- correlator (corroborated()) compares them against the naive filename axis;
  -- played_at_utc is an ADDITIVE canonical value, never a re-encoding.
  -- TEXT RFC3339 (like every timestamp here — see the header note); UTC
  -- RFC3339 sorts lexicographically.
  played_at_utc TEXT,
  perf_elim_total INTEGER NOT NULL DEFAULT 0,
  perf_elim_avg_per_10min REAL NOT NULL DEFAULT 0,
  perf_assists_total INTEGER NOT NULL DEFAULT 0,
  perf_assists_avg_per_10min REAL NOT NULL DEFAULT 0,
  perf_deaths_total INTEGER NOT NULL DEFAULT 0,
  perf_deaths_avg_per_10min REAL NOT NULL DEFAULT 0,
  -- Parser output vintage that produced this row (parser.Generation). NULL =
  -- written before the column existed, which is stale by definition. Drives the
  -- "these matches would gain data from a Re-parse All" count; see
  -- parser.Generation for when to bump it.
  parser_generation INTEGER
) STRICT;
-- statement-end
CREATE INDEX IF NOT EXISTS idx_summary_match_key_parsed_at ON summary_screenshots (match_key, parsed_at);
-- statement-end

CREATE TABLE IF NOT EXISTS summary_heroes_played (
  summary_screenshot_id INTEGER NOT NULL REFERENCES summary_screenshots (id) ON DELETE CASCADE,
  hero TEXT NOT NULL,
  percent_played INTEGER NOT NULL DEFAULT 0,
  play_time TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (summary_screenshot_id, hero)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS teams_screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  match_key TEXT NOT NULL,
  parsed_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs (id) ON DELETE RESTRICT,
  -- The in-game teams scoreboard is a combat-stats source only; match
  -- identity (map, playlist, hero, role) comes from the SUMMARY / RANK /
  -- PERSONAL screenshots and is merged in by correlation.
  eliminations INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  damage INTEGER NOT NULL DEFAULT 0,
  healing INTEGER NOT NULL DEFAULT 0,
  mitigation INTEGER NOT NULL DEFAULT 0,
  -- Queue format inferred from players-per-team on the teams:
  -- 'role' (5v5) or 'open' (6v6); '' when the count couldn't be read.
  -- A user-set match_queue annotation overrides this at read time.
  queue_type TEXT NOT NULL DEFAULT '',
  -- Parser output vintage that produced this row (parser.Generation). NULL =
  -- written before the column existed, which is stale by definition. Drives the
  -- "these matches would gain data from a Re-parse All" count; see
  -- parser.Generation for when to bump it.
  parser_generation INTEGER
) STRICT;
-- statement-end
CREATE INDEX IF NOT EXISTS idx_teams_match_key_parsed_at ON teams_screenshots (match_key, parsed_at);
-- statement-end

CREATE TABLE IF NOT EXISTS teams_hero_stats (
  teams_screenshot_id INTEGER NOT NULL REFERENCES teams_screenshots (id) ON DELETE CASCADE,
  hero TEXT NOT NULL,
  stat_key TEXT NOT NULL,
  stat_value INTEGER NOT NULL,
  PRIMARY KEY (teams_screenshot_id, hero, stat_key)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS personal_screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  match_key TEXT NOT NULL,
  parsed_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs (id) ON DELETE RESTRICT,
  hero TEXT NOT NULL DEFAULT '',
  hero_raw TEXT NOT NULL DEFAULT '',
  -- Parser output vintage that produced this row (parser.Generation). NULL =
  -- written before the column existed, which is stale by definition. Drives the
  -- "these matches would gain data from a Re-parse All" count; see
  -- parser.Generation for when to bump it.
  parser_generation INTEGER
) STRICT;
-- statement-end
CREATE INDEX IF NOT EXISTS idx_personal_match_key_parsed_at ON personal_screenshots (match_key, parsed_at);
-- statement-end

CREATE TABLE IF NOT EXISTS personal_hero_stats (
  personal_screenshot_id INTEGER NOT NULL REFERENCES personal_screenshots (id) ON DELETE CASCADE,
  hero TEXT NOT NULL,
  stat_key TEXT NOT NULL,
  stat_value INTEGER NOT NULL,
  PRIMARY KEY (personal_screenshot_id, hero, stat_key)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS rank_screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  match_key TEXT NOT NULL,
  parsed_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs (id) ON DELETE RESTRICT,
  rank TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 0,
  -- NULLABLE, and that is a correction: both were NOT NULL DEFAULT 0, which
  -- gave "the caption did not read" and a real reading of 0 the same
  -- representation. It was not hypothetical — 21 of 44 rank captures in the
  -- corpus stored change_percent = 0 because the movement pill was never
  -- recovered, so every consumer was told those matches moved the rank exactly
  -- nowhere. 0 is meanwhile legitimate for both: the bottom of a division, and
  -- a match that genuinely moved nothing.
  rank_progress INTEGER,
  change_percent INTEGER,
  result TEXT NOT NULL DEFAULT '',
  -- Modifier-row text this release's vocabulary could not account for.
  --
  -- ONE COLUMN, not a child table, which bends "a new repeating-group dimension
  -- gets its own CREATE TABLE" in .claude/rules/database.md. The deviation is
  -- deliberate: there is no chip ENTITY to key rows on. The detector matches
  -- [A-Z]{5,} at WORD level, so "UPHILL BATTLE" is two tokens and the documented
  -- false positive "ENDORSEMENT RECEIVED" is two more — a (rank_screenshot_id,
  -- chip) primary key would normalize word fragments, not chips. rank_modifiers
  -- earns its table because three consumers query per-modifier (the narrow
  -- facets, the dossier counts, the user-override twin); this text feeds none of
  -- them by design, and a table with no join is speculative generality.
  --
  -- The trigger that EARNS the split: the first feature that wants to group by
  -- this value — "count matches by unrecognized chip", or a facet the user can
  -- filter on. At that point the tokenizer needs to emit whole chips too.
  --
  -- It has DELIBERATELY no CHECK: the rank_modifiers CHECK below IS the vocabulary, so
  -- a value that belongs here can never satisfy it — routing this text there
  -- would be a guaranteed constraint violation, which UpsertRank's log-and-skip
  -- would then turn into a guaranteed silent drop. That is this column's own bug
  -- moved one layer down.
  modifiers_raw TEXT NOT NULL DEFAULT '',
  -- Season-4 "HIGHER RANKED THAN 57% OF PLAYERS". Nullable for the same reason
  -- as the two above, which it predates: the caption is absent on every
  -- placement screen and on every capture before season 4, and 0 would assert
  -- the player is ranked above nobody rather than "not reported".
  -- Nullable is also what ensureAdditiveColumns can add to an existing DB.
  rank_percentile INTEGER,
  -- Parser output vintage that produced this row (parser.Generation). NULL =
  -- written before the column existed, which is stale by definition. Drives the
  -- "these matches would gain data from a Re-parse All" count; see
  -- parser.Generation for when to bump it.
  parser_generation INTEGER
) STRICT;
-- statement-end
CREATE INDEX IF NOT EXISTS idx_rank_match_key_parsed_at ON rank_screenshots (match_key, parsed_at);
-- statement-end

CREATE TABLE IF NOT EXISTS rank_modifiers (
  rank_screenshot_id INTEGER NOT NULL REFERENCES rank_screenshots (id) ON DELETE CASCADE,
  -- Vocabulary mirrors parser.StorableModifiers(), i.e. pkg/parser/modifiers.yaml
  -- plus "demotion protection" (detected separately in parseRank). This list is
  -- ASSERTED against the parser by TestSchemaModifierCheck_MatchesTheParserVocabulary
  -- -- it is no longer kept in sync by this comment alone, because that failed:
  -- 'winning trend' / 'losing trend' reached the parser and never reached here,
  -- and UpsertRank writes parent and children in ONE transaction, so every rank
  -- row carrying either chip was discarded whole. Mirrors the
  -- leaver/queue_type/play_mode/result enum constraints on the sibling tables.
  modifier TEXT NOT NULL CHECK (modifier IN (
    'expected', 'uphill battle', 'reversal', 'consolation',
    'win streak', 'loss streak', 'calibration', 'volatile', 'variance',
    'winning trend', 'losing trend',
    'new map', 'leaver compensation', 'victory', 'defeat', 'draw',
    'demotion protection'
  )),
  PRIMARY KEY (rank_screenshot_id, modifier)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS rank_sr (
  rank_screenshot_id INTEGER NOT NULL REFERENCES rank_screenshots (id) ON DELETE CASCADE,
  hero TEXT NOT NULL,
  sr INTEGER NOT NULL DEFAULT 0,
  change INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rank_screenshot_id, hero)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS match_annotations (
  match_key TEXT PRIMARY KEY,
  note TEXT,
  replay_code TEXT,
  annotated_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

-- The PLAYER's own timestamped moments — a self-review that can point at
-- seconds the same way a coach's can. Sibling of match_annotations rather than
-- a column on it: several share a match, which is the whole point, and the
-- annotation is a single row by design.
--
-- Deliberately NOT the same table as the coach's received moments. These are
-- the player's own words about their own match; folding both into one list
-- would make "who said this" a column instead of a boundary, and the coach
-- layer's rule is that a coach speaks in their own block.
CREATE TABLE IF NOT EXISTS match_moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id TEXT NOT NULL UNIQUE,
  match_key TEXT NOT NULL,
  match_clock TEXT NOT NULL,
  text TEXT NOT NULL,
  -- Same vocabulary as coach_note_focus_tags, plus '' for an untagged
  -- moment. The player and their coach file a match under the same words,
  -- which is most of what makes a review legible side by side. Unlike the
  -- received-note tables, this one is written straight from the API, so the
  -- CHECK is the last thing between a client and an unreadable tag.
  focus_tag TEXT NOT NULL DEFAULT '' CHECK (focus_tag IN (
    '', 'positioning', 'ult_economy', 'target_priority', 'cooldowns',
    'hero_pick', 'comms', 'mechanics', 'mental'
  )),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

CREATE INDEX IF NOT EXISTS idx_match_moments_match_key
  ON match_moments (match_key, match_clock, sort_order);
-- statement-end

-- Who disrupted the match, per side. Two sibling set tables rather than a
-- scalar column: a match can carry a thrower on BOTH teams at once, and
-- "a teammate left, then I left" needs two leaver sides on one match.
CREATE TABLE IF NOT EXISTS match_annotation_leavers (
  match_key TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('self', 'team', 'enemy')),
  PRIMARY KEY (match_key, side),
  FOREIGN KEY (match_key) REFERENCES match_annotations (match_key) ON DELETE CASCADE
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS match_annotation_throwers (
  match_key TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('self', 'team', 'enemy')),
  PRIMARY KEY (match_key, side),
  FOREIGN KEY (match_key) REFERENCES match_annotations (match_key) ON DELETE CASCADE
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS match_annotation_members (
  match_key TEXT NOT NULL,
  member TEXT NOT NULL,
  PRIMARY KEY (match_key, member),
  FOREIGN KEY (match_key) REFERENCES match_annotations (match_key) ON DELETE CASCADE
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS match_annotation_tags (
  match_key TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (match_key, tag),
  FOREIGN KEY (match_key) REFERENCES match_annotations (match_key) ON DELETE CASCADE
) STRICT;
-- statement-end
CREATE INDEX IF NOT EXISTS idx_match_annotation_tags_tag ON match_annotation_tags (tag);
-- statement-end

-- User-curated pins: presence IS the pinned state (the hidden_matches
-- pattern). Pinned matches render in a dedicated section above the
-- date groups.
CREATE TABLE IF NOT EXISTS pinned_matches (
  match_key TEXT PRIMARY KEY,
  pinned_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS hidden_matches (
  match_key TEXT PRIMARY KEY,
  hidden_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS unknown_screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  match_key TEXT NOT NULL,
  parsed_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- references screenshots_dirs(id); RESTRICT prevents orphan rows
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs (id) ON DELETE RESTRICT,
  -- Parser output vintage that produced this row (parser.Generation). NULL =
  -- written before the column existed, which is stale by definition. Drives the
  -- "these matches would gain data from a Re-parse All" count; see
  -- parser.Generation for when to bump it.
  parser_generation INTEGER
) STRICT;
-- statement-end
CREATE INDEX IF NOT EXISTS idx_unknown_match_key_parsed_at ON unknown_screenshots (match_key, parsed_at);
-- statement-end

-- Candidate rows come from two producers: the per-file resolver
-- (EAD-bridge / timestamp-window ambiguity, distances <= 30 min) and
-- the end-of-parse duplicate sweep (identical TEAMS stat line, 30 min
-- to 7 days). No reason column on purpose — the producer is derivable
-- from distance_seconds (correlate.CandidateReason).
CREATE TABLE IF NOT EXISTS ambiguous_candidates (
  filename TEXT NOT NULL,
  match_key TEXT NOT NULL,
  distance_seconds INTEGER NOT NULL,
  PRIMARY KEY (filename, match_key)
) STRICT;
-- statement-end
CREATE INDEX IF NOT EXISTS idx_ambig_cand_match_key ON ambiguous_candidates (match_key);
-- statement-end

CREATE TABLE IF NOT EXISTS match_reviews (
  match_key TEXT PRIMARY KEY,
  reviewed_by TEXT NOT NULL CHECK (reviewed_by IN ('self', 'coach')),
  reviewed_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS match_queue (
  match_key TEXT PRIMARY KEY,
  queue_type TEXT NOT NULL CHECK (queue_type IN ('role', 'open')),
  overridden_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS match_play_mode (
  match_key TEXT PRIMARY KEY,
  play_mode TEXT NOT NULL CHECK (play_mode IN ('quickplay', 'competitive')),
  overridden_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

-- Content-hash registry for every image the parse loop has examined.
-- duplicate_of names the canonical filename when this file was a
-- byte-identical copy (skipped before OCR); '' for originals. Lets a
-- Steam+system-shortcut double-save cost zero Tesseract time and zero
-- duplicate rows. Only files ingested after this table shipped carry
-- hashes — older history simply never matches.
CREATE TABLE IF NOT EXISTS ingested_files (
  filename TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  duplicate_of TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end
CREATE INDEX IF NOT EXISTS idx_ingested_files_hash ON ingested_files (content_hash);
-- statement-end

CREATE TABLE IF NOT EXISTS ignored_screenshots (
  filename TEXT PRIMARY KEY,
  ignored_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

-- Per-file OCR failure ledger backing the Unknown tab's "Failed to read"
-- triage section. A row exists while the file's most recent parse attempt
-- failed; a later successful parse deletes it, and "Delete forever"
-- (ignored_screenshots) deletes it. Deliberately NOT a skip list — failed
-- files are re-attempted on every parse run; ignoring is the user's
-- suppression lever. screenshots_dir_id lets the diagnostic bundle resolve
-- the on-disk path later (PruneScreenshotsDirs unions this table so a dir
-- referenced only here survives the startup GC).
CREATE TABLE IF NOT EXISTS failed_files (
  filename TEXT PRIMARY KEY,
  screenshots_dir_id INTEGER NOT NULL DEFAULT 1 REFERENCES screenshots_dirs (id) ON DELETE RESTRICT,
  error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 1,
  first_failed_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_failed_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

-- Recognized-but-unstored skip list for the PERSONAL "All Heroes" aggregate
-- view. The parser classifies it ("all_heroes") but extracts nothing — its
-- combat totals duplicate the TEAMS screen and its card icons defeat the OCR.
-- Recording only the filename keeps the screen out of the next OCR run (like
-- ignored_screenshots) without a garbage match row or an Unknown-tab entry.
CREATE TABLE IF NOT EXISTS all_heroes_screenshots (
  filename TEXT PRIMARY KEY,
  recognized_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
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
  match_key TEXT PRIMARY KEY,
  map TEXT,
  hero TEXT,
  eliminations INTEGER,
  assists INTEGER,
  deaths INTEGER,
  damage INTEGER,
  healing INTEGER,
  mitigation INTEGER,
  result TEXT CHECK (result IS NULL OR result IN ('victory', 'defeat', 'draw')),
  final_score TEXT,
  date TEXT,
  finished_at TEXT,
  game_length TEXT,
  -- Canonical UTC instant (see summary_screenshots.played_at_utc). Manual
  -- entries carry an offset on the wire so this is exact; the naive
  -- date/finished_at/key stay naive-local for axis consistency with OCR rows.
  played_at_utc TEXT,
  rank TEXT,
  level INTEGER,
  rank_progress INTEGER,
  change_percent INTEGER,
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

-- Heroes-played list. position 0 = primary (drives card header + derived role,
-- matching the OCR "first in heroes_played is primary" rule). percent_played /
-- play_time may be NULL (manual entry has neither).
CREATE TABLE IF NOT EXISTS user_match_heroes (
  match_key TEXT NOT NULL REFERENCES user_match_data (match_key) ON DELETE CASCADE,
  hero TEXT NOT NULL,
  percent_played INTEGER,
  play_time TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_key, hero)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS user_match_hero_stats (
  match_key TEXT NOT NULL REFERENCES user_match_data (match_key) ON DELETE CASCADE,
  hero TEXT NOT NULL,
  stat_key TEXT NOT NULL,
  stat_value INTEGER NOT NULL,
  PRIMARY KEY (match_key, hero, stat_key)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS user_match_sr (
  match_key TEXT NOT NULL REFERENCES user_match_data (match_key) ON DELETE CASCADE,
  hero TEXT NOT NULL,
  sr INTEGER NOT NULL DEFAULT 0,
  change INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_key, hero)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS user_match_rank_modifiers (
  match_key TEXT NOT NULL REFERENCES user_match_data (match_key) ON DELETE CASCADE,
  -- Same vocabulary as the OCR twin rank_modifiers above, and asserted against
  -- the parser by the same test — a modifier the parser accepts must not be
  -- unenterable as a user edit (and vice versa).
  modifier TEXT NOT NULL CHECK (modifier IN (
    'expected', 'uphill battle', 'reversal', 'consolation',
    'win streak', 'loss streak', 'calibration', 'volatile', 'variance',
    'winning trend', 'losing trend',
    'new map', 'leaver compensation', 'victory', 'defeat', 'draw',
    'demotion protection'
  )),
  PRIMARY KEY (match_key, modifier)
) STRICT;
-- statement-end

-- ── Coaching and review ─────────────────────────────────────────────────
--
-- Three families that one machine may carry at once (a user can be both a
-- coach and a player, and a player reviews their own games):
--
--   * coach-AUTHORED (coach_players / coach_notes / coach_session_summaries)
--     — what THIS user wrote about someone else's matches during a coaching
--     session. Keyed by the player, never by a local match_key; Clear() and
--     HardDeleteMatch() leave this family alone.
--   * coach-RECEIVED (match_coach_notes / coach_returns) — notes another
--     coach wrote about THIS user's matches, staged as a return and accepted
--     per note. Keyed by local match_key like every other sidecar, so
--     HardDeleteMatch / Clear / profiles.Move treat it as match history.
--   * player-AUTHORED SELF REVIEW (self_reviews and its self_review_*
--     children, at the end of this file) — a saved session in which THIS
--     user sat down with a set of their OWN matches and reviewed them the
--     way a coach would: per-match notes with focus tags, timestamped
--     moments, a set-level summary. Match history like the received family
--     (HardDeleteMatch removes a match from its reviews; Clear wipes them;
--     profiles.Move carries a review whole or refuses), but its own tables,
--     not rows in match_coach_notes with a nullable review id: the received
--     block travels field-for-field into bundles and profile moves, and an
--     integer review id in a target database either fails the import or
--     attaches the note to whichever unrelated review holds that id.

-- player_id is the UUID a "share with a coach" export mints on the player's
-- side; NULL for anonymous/older bundles, where the case-insensitive handle
-- is the only identity available (UNIQUE tolerates many NULLs). handle is
-- display-only and may be corrected by the coach.
CREATE TABLE IF NOT EXISTS coach_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT UNIQUE,
  handle TEXT NOT NULL COLLATE NOCASE
) STRICT;
-- statement-end

-- One note per (player, match). note_id is the UUID the player's side
-- dedupes on, minted on first save and never rewritten by a re-save.
CREATE TABLE IF NOT EXISTS coach_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL UNIQUE,
  player_ref INTEGER NOT NULL REFERENCES coach_players (id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'reviewed_only')),
  text TEXT NOT NULL DEFAULT '',
  match_clock TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (player_ref, match_key)
) STRICT;
-- statement-end

-- The fixed focus vocabulary lives in the CHECK (mirrored by the coach
-- package and the frontend chip list); freeform "+ add" tags go in the
-- extra_tags sibling with no vocabulary.
CREATE TABLE IF NOT EXISTS coach_note_focus_tags (
  coach_note_id INTEGER NOT NULL REFERENCES coach_notes (id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (tag IN (
    'positioning', 'ult_economy', 'target_priority', 'cooldowns',
    'hero_pick', 'comms', 'mechanics', 'mental'
  )),
  PRIMARY KEY (coach_note_id, tag)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS coach_note_extra_tags (
  coach_note_id INTEGER NOT NULL REFERENCES coach_notes (id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (coach_note_id, tag)
) STRICT;
-- statement-end

-- A note's timestamped moments: "3:23 — no off-angle, the tank ate the
-- pressure alone". The note stays the per-match record (the overall text, the
-- tags, the reviewed mark); the moments are what a coach points AT while
-- watching the replay, so they hang off it rather than replacing it.
--
-- Many per note, which is the whole point — a single review says several
-- things at several times. sort_order is the authored order, kept so two
-- moments sharing a clock stay where the coach put them; readers order by
-- (match_clock, sort_order) so the strip reads down the match.
CREATE TABLE IF NOT EXISTS coach_note_moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Unique WITHIN a note, not globally. The id is minted by the client, so a
  -- global UNIQUE made it a shared namespace: an upsert conflicting on
  -- moment_id alone matched a row belonging to another note — another PLAYER,
  -- even — and rewrote it, while the caller's own write silently went nowhere.
  -- Scoping the constraint to the parent is what makes the conflict target
  -- name a row this note actually owns.
  moment_id TEXT NOT NULL,
  coach_note_id INTEGER NOT NULL REFERENCES coach_notes (id) ON DELETE CASCADE,
  match_clock TEXT NOT NULL,
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (coach_note_id, moment_id)
) STRICT;
-- statement-end

CREATE INDEX IF NOT EXISTS idx_coach_note_moments_note
  ON coach_note_moments (coach_note_id, match_clock, sort_order);
-- statement-end

-- One focus tag per moment, same vocabulary as the note's. A moment names a
-- single thing that happened, so this is a single tag rather than a set — the
-- table shape exists to share the CHECK with its sibling above.
CREATE TABLE IF NOT EXISTS coach_note_moment_focus_tags (
  coach_note_moment_id INTEGER NOT NULL REFERENCES coach_note_moments (id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (tag IN (
    'positioning', 'ult_economy', 'target_priority', 'cooldowns',
    'hero_pick', 'comms', 'mechanics', 'mental'
  )),
  PRIMARY KEY (coach_note_moment_id, tag)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS coach_session_summaries (
  player_ref INTEGER PRIMARY KEY REFERENCES coach_players (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

-- Accepted coach notes on this user's own matches. Blocks accumulate per
-- match (one per coach note); note_id is the coach's UUID so importing the
-- same notes file twice upserts instead of duplicating.
CREATE TABLE IF NOT EXISTS match_coach_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL UNIQUE,
  match_key TEXT NOT NULL,
  coach_name TEXT NOT NULL,
  session_date TEXT NOT NULL,
  text TEXT NOT NULL,
  match_clock TEXT NOT NULL DEFAULT '',
  accepted_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end
CREATE INDEX IF NOT EXISTS idx_match_coach_notes_match_key ON match_coach_notes (match_key);
-- statement-end

CREATE TABLE IF NOT EXISTS match_coach_note_focus_tags (
  match_coach_note_id INTEGER NOT NULL REFERENCES match_coach_notes (id) ON DELETE CASCADE,
  -- Same vocabulary as coach_note_focus_tags — keep the two CHECK lists in
  -- sync, or a tag a coach can write becomes unacceptable on the way back.
  tag TEXT NOT NULL CHECK (tag IN (
    'positioning', 'ult_economy', 'target_priority', 'cooldowns',
    'hero_pick', 'comms', 'mechanics', 'mental'
  )),
  PRIMARY KEY (match_coach_note_id, tag)
) STRICT;
-- statement-end

-- The timestamped moments that came WITH an accepted note. Stored beside the
-- block rather than merged into its text: the player reads them as a list
-- down the match, the same way the coach wrote them, and a moment keeps its
-- own clock and tag rather than dissolving into a paragraph.
--
-- No focus-tag child here. The moment carries at most one tag and it arrives
-- already validated by the notes-file reader, so a whole table to hold one
-- string per row would be shape for its own sake.
CREATE TABLE IF NOT EXISTS match_coach_note_moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_coach_note_id INTEGER NOT NULL REFERENCES match_coach_notes (id) ON DELETE CASCADE,
  moment_id TEXT NOT NULL,
  match_clock TEXT NOT NULL,
  text TEXT NOT NULL,
  focus_tag TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Unique WITHIN the block, the same constraint its authored twin carries:
  -- the id comes from a file another machine wrote, so it is not a namespace
  -- to trust, and two rows sharing one collide as Vue keys downstream.
  UNIQUE (match_coach_note_id, moment_id)
) STRICT;
-- statement-end

-- Ordered by sort_order alone. The accept assigns it from the by-SECONDS sort,
-- so it already encodes reading order — adding match_clock to the ORDER BY
-- sorted the STRING and put "10:00" before "9:00", discarding the very
-- ordering the accept had just computed.
CREATE INDEX IF NOT EXISTS idx_match_coach_note_moments_note
  ON match_coach_note_moments (match_coach_note_id, sort_order);
-- statement-end

CREATE TABLE IF NOT EXISTS match_coach_note_extra_tags (
  match_coach_note_id INTEGER NOT NULL REFERENCES match_coach_notes (id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (match_coach_note_id, tag)
) STRICT;
-- statement-end

-- A staged notes file the player imported but has not finished deciding on.
-- notes_json is the file's notes.json kept verbatim (an uploaded document —
-- only the decisions are relational); content_hash makes the same file
-- imported twice the same row. "Pending" is derived (undecided + decidable);
-- there is no finish state.
CREATE TABLE IF NOT EXISTS coach_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT NOT NULL UNIQUE,
  coach_name TEXT NOT NULL,
  player_handle TEXT NOT NULL,
  session_date TEXT NOT NULL,
  notes_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS coach_return_decisions (
  return_id INTEGER NOT NULL REFERENCES coach_returns (id) ON DELETE CASCADE,
  note_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'skipped')),
  decided_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (return_id, note_id)
) STRICT;
-- statement-end

-- ── Self review ─────────────────────────────────────────────────────────
--
-- One saved sitting over the player's own matches. review_id is a UUID and
-- is the wire id AND the bundle/move identity, so no integer ever leaves
-- the database (see the family note above). finished_at is NULL while the
-- review is in progress; Finish stamps it and marks every member match
-- reviewed_by 'self' where a coach has not already outranked it.
CREATE TABLE IF NOT EXISTS self_reviews (
  review_id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  finished_at TEXT
) STRICT;
-- statement-end

-- The set a review is over, in the order the player laid it out. No foreign
-- key to a match table (sidecar rule 2 — a match is five parent rows keyed
-- by match_key, not one row to reference); HardDeleteMatch removes the
-- membership row, and the note below cascades off it.
CREATE TABLE IF NOT EXISTS self_review_matches (
  review_id TEXT NOT NULL REFERENCES self_reviews (review_id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (review_id, match_key)
) STRICT;
-- statement-end
CREATE INDEX IF NOT EXISTS idx_self_review_matches_match_key
  ON self_review_matches (match_key);
-- statement-end

-- One note per (review, match), the same per-match record the coach's
-- authored note is: kind says whether words were written or the match was
-- only looked at (a moment on a match with no note opens a reviewed_only
-- one). The composite FK to the membership row is what makes "remove this
-- match from the review" and "hard-delete this match" one statement each —
-- the note goes with the membership.
CREATE TABLE IF NOT EXISTS self_review_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id TEXT NOT NULL,
  match_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'reviewed_only')),
  text TEXT NOT NULL DEFAULT '',
  match_clock TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (review_id, match_key),
  FOREIGN KEY (review_id, match_key)
    REFERENCES self_review_matches (review_id, match_key) ON DELETE CASCADE
) STRICT;
-- statement-end

-- Same vocabulary as coach_note_focus_tags — the third copy of the CHECK
-- list. Keep all three in step: the player and their coach file a match
-- under the same words, which is most of what makes a review legible.
CREATE TABLE IF NOT EXISTS self_review_note_focus_tags (
  self_review_note_id INTEGER NOT NULL REFERENCES self_review_notes (id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (tag IN (
    'positioning', 'ult_economy', 'target_priority', 'cooldowns',
    'hero_pick', 'comms', 'mechanics', 'mental'
  )),
  PRIMARY KEY (self_review_note_id, tag)
) STRICT;
-- statement-end

CREATE TABLE IF NOT EXISTS self_review_note_extra_tags (
  self_review_note_id INTEGER NOT NULL REFERENCES self_review_notes (id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (self_review_note_id, tag)
) STRICT;
-- statement-end

-- A note's timestamped moments, riding inside the note the way a received
-- block's do. moment_id is minted client-side and unique WITHIN the note,
-- like its two siblings. focus_tag is a CHECK column rather than a child
-- table, like match_moments: written straight from the API, so the CHECK is
-- the last thing between a client and an unreadable tag.
CREATE TABLE IF NOT EXISTS self_review_note_moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  self_review_note_id INTEGER NOT NULL REFERENCES self_review_notes (id) ON DELETE CASCADE,
  moment_id TEXT NOT NULL,
  match_clock TEXT NOT NULL,
  text TEXT NOT NULL,
  focus_tag TEXT NOT NULL DEFAULT '' CHECK (focus_tag IN (
    '', 'positioning', 'ult_economy', 'target_priority', 'cooldowns',
    'hero_pick', 'comms', 'mechanics', 'mental'
  )),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (self_review_note_id, moment_id)
) STRICT;
-- statement-end
