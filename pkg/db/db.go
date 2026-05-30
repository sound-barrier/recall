// Package db owns the SQLite persistence layer for Recall. The Store
// interface is the boundary the app uses; SQLStore is the production
// implementation. The schema lives here so it can be shared across
// implementations.
//
// The schema is 3NF: one parent table per screenshot type (SUMMARY,
// SCOREBOARD, PERSONAL, RANK, UNKNOWN) plus per-parent child tables
// for the repeating-group fields (heroes_played, modifiers, sr,
// hero stats). Each screenshot's parse writes to its own parent +
// children in one transaction; aggregation is read-time only.
package db

// schema creates every table on a fresh DB. Each statement is split out
// of the const so `Exec` can run them one at a time — SQLite's `Exec`
// handles multi-statement strings, but splitting makes startup errors
// point at a specific CREATE TABLE.
//
// Match identity is `match_key`, present on every parent table and
// indexed. Per-file uniqueness is enforced via the `filename UNIQUE`
// constraint, which `ON CONFLICT(filename) DO UPDATE` keys off so
// re-parsing the same file replaces its row in place.
var schemaStatements = []string{
	// screenshots_dirs records the source folder each screenshot was
	// ingested from. 3NF: one row per distinct path, referenced by
	// nullable screenshots_dir_id on every parent table — when the
	// user changes their screenshots folder later, the path captured
	// at parse time is preserved without duplicating the string on
	// every row. ON DELETE SET NULL means deleting a dir row leaves
	// parents pointing at NULL rather than orphan-cascading them out.
	`CREATE TABLE IF NOT EXISTS screenshots_dirs (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		path          TEXT NOT NULL UNIQUE,
		first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,

	`CREATE TABLE IF NOT EXISTS summary_screenshots (
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
	)`,
	`CREATE INDEX IF NOT EXISTS idx_summary_match_key ON summary_screenshots(match_key)`,

	`CREATE TABLE IF NOT EXISTS summary_heroes_played (
		summary_screenshot_id INTEGER NOT NULL REFERENCES summary_screenshots(id) ON DELETE CASCADE,
		hero            TEXT NOT NULL,
		percent_played  INTEGER NOT NULL DEFAULT 0,
		play_time       TEXT,
		PRIMARY KEY (summary_screenshot_id, hero)
	)`,

	`CREATE TABLE IF NOT EXISTS scoreboard_screenshots (
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
	)`,
	`CREATE INDEX IF NOT EXISTS idx_scoreboard_match_key ON scoreboard_screenshots(match_key)`,
	`CREATE INDEX IF NOT EXISTS idx_scoreboard_ead       ON scoreboard_screenshots(eliminations, assists, deaths)`,

	`CREATE TABLE IF NOT EXISTS scoreboard_hero_stats (
		scoreboard_screenshot_id INTEGER NOT NULL REFERENCES scoreboard_screenshots(id) ON DELETE CASCADE,
		hero        TEXT NOT NULL,
		stat_key    TEXT NOT NULL,
		stat_value  INTEGER NOT NULL,
		PRIMARY KEY (scoreboard_screenshot_id, hero, stat_key)
	)`,

	`CREATE TABLE IF NOT EXISTS personal_screenshots (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		filename      TEXT NOT NULL UNIQUE,
		match_key     TEXT NOT NULL,
		parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		screenshots_dir_id INTEGER REFERENCES screenshots_dirs(id) ON DELETE SET NULL,
		hero          TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS idx_personal_match_key ON personal_screenshots(match_key)`,

	`CREATE TABLE IF NOT EXISTS personal_hero_stats (
		personal_screenshot_id INTEGER NOT NULL REFERENCES personal_screenshots(id) ON DELETE CASCADE,
		hero        TEXT NOT NULL,
		stat_key    TEXT NOT NULL,
		stat_value  INTEGER NOT NULL,
		PRIMARY KEY (personal_screenshot_id, hero, stat_key)
	)`,

	`CREATE TABLE IF NOT EXISTS rank_screenshots (
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
	)`,
	`CREATE INDEX IF NOT EXISTS idx_rank_match_key ON rank_screenshots(match_key)`,

	`CREATE TABLE IF NOT EXISTS rank_modifiers (
		rank_screenshot_id INTEGER NOT NULL REFERENCES rank_screenshots(id) ON DELETE CASCADE,
		modifier TEXT NOT NULL,
		PRIMARY KEY (rank_screenshot_id, modifier)
	)`,

	`CREATE TABLE IF NOT EXISTS rank_sr (
		rank_screenshot_id INTEGER NOT NULL REFERENCES rank_screenshots(id) ON DELETE CASCADE,
		hero      TEXT NOT NULL,
		sr        INTEGER NOT NULL DEFAULT 0,
		change    INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (rank_screenshot_id, hero)
	)`,

	// User-curated per-match annotations. Four fields, all optional —
	// a row exists when ANY field is set; deletion happens on the
	// write path when all fields go empty. Keyed by match_key with no
	// FK so the annotation survives a re-parse that re-derives the
	// same key from the same screenshots — and also persists across
	// a Clear+Restore if the backup includes the table (Backup &
	// Restore extension is a follow-up).
	//
	//   - `leaver`      — 'self' | 'team' | 'enemy' | NULL (no
	//                     leaver tag). Drives W/L/D tally exclusion.
	//   - `note`        — free-text per-match commentary.
	//   - `replay_code` — Overwatch's six-character replay ID so
	//                     the user can re-find a specific match in
	//                     the in-game replay viewer.
	//   - members are in the child table below; one row per teammate.
	`CREATE TABLE IF NOT EXISTS match_annotations (
		match_key    TEXT PRIMARY KEY,
		leaver       TEXT CHECK (leaver IS NULL OR leaver IN ('self','team','enemy')),
		note         TEXT,
		replay_code  TEXT,
		annotated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	// One row per group-member BattleTag attached to a given match's
	// annotation. Composite PK prevents duplicate tags on the same
	// match; ON DELETE CASCADE means clearing the parent annotation
	// row blows the member list away. Members are stored verbatim —
	// no canonicalisation — so 'Apollo#11234' and 'apollo#11234' are
	// distinct rows.
	`CREATE TABLE IF NOT EXISTS match_annotation_members (
		match_key TEXT NOT NULL,
		member    TEXT NOT NULL,
		PRIMARY KEY (match_key, member),
		FOREIGN KEY (match_key) REFERENCES match_annotations(match_key) ON DELETE CASCADE
	)`,
	// One row per user-applied tag on a given match's annotation.
	// Tags are free-form strings — `stack`, `stream`, `placement` are
	// the conventional three but the user can add anything. The
	// composite PK prevents duplicate tags on the same match;
	// ON DELETE CASCADE drops the tag list when the parent annotation
	// row is removed. Tags are lower-cased + trimmed at the app layer
	// before they reach this table (case-insensitive equivalence —
	// `Stack` and `stack` collapse to one row), unlike Members which
	// are stored verbatim because BattleTag case is significant.
	//
	// The `idx_match_annotation_tags_tag` index supports the
	// "match by tag" lookup that the FilterRail Tags multi-select
	// drives — without it, the LoadAnnotations table-scan + the
	// future explicit `WHERE tag = ?` queries would full-scan the
	// child table.
	`CREATE TABLE IF NOT EXISTS match_annotation_tags (
		match_key TEXT NOT NULL,
		tag       TEXT NOT NULL,
		PRIMARY KEY (match_key, tag),
		FOREIGN KEY (match_key) REFERENCES match_annotations(match_key) ON DELETE CASCADE
	)`,
	`CREATE INDEX IF NOT EXISTS idx_match_annotation_tags_tag ON match_annotation_tags(tag)`,
	// Soft-deleted matches. Presence in this table = the user clicked
	// Hide on the match in the UI. The aggregator filters these out of
	// MatchRecord output by default; the FilterRail "Hidden · N"
	// toggle opts them back in so users can review / unhide. Keyed by
	// match_key only — the per-screenshot rows stay in their respective
	// parent tables so a re-parse of the same source files doesn't surface the
	// hidden match again (LoadAllFilenames sees them as already parsed).
	// 3NF-clean: existence in the table is the hidden state; hidden_at
	// is server-set audit timestamp dependent solely on match_key.
	`CREATE TABLE IF NOT EXISTS hidden_matches (
		match_key TEXT PRIMARY KEY,
		hidden_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS unknown_screenshots (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		filename    TEXT NOT NULL UNIQUE,
		match_key   TEXT NOT NULL,
		parsed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		screenshots_dir_id INTEGER REFERENCES screenshots_dirs(id) ON DELETE SET NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_unknown_match_key ON unknown_screenshots(match_key)`,

	// Ambiguous-attribution storage. When the resolver can't pin a
	// screenshot to a single match (EAD signature ambiguity, or a
	// timestamp-window tie between two matches), it mints the parent
	// row's match_key as "ambiguous:<filename>" and records the
	// candidate matches here so the user can pick the right one via
	// the Unknown tab. One row per (filename, candidate_match_key);
	// presence in this table = the screenshot is ambiguous.
	`CREATE TABLE IF NOT EXISTS ambiguous_candidates (
		filename     TEXT NOT NULL,
		match_key    TEXT NOT NULL,
		distance_s   INTEGER NOT NULL,
		PRIMARY KEY (filename, match_key)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_ambig_cand_match_key ON ambiguous_candidates(match_key)`,
}

// parentTables enumerates every parent screenshot table. Used by
// LoadAllFilenames, Clear, and the aggregator to iterate uniformly.
var parentTables = []string{
	"summary_screenshots",
	"scoreboard_screenshots",
	"personal_screenshots",
	"rank_screenshots",
	"unknown_screenshots",
}
