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
	`CREATE TABLE IF NOT EXISTS summary_screenshots (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		filename      TEXT NOT NULL UNIQUE,
		match_key     TEXT NOT NULL,
		parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

	`CREATE TABLE IF NOT EXISTS unknown_screenshots (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		filename    TEXT NOT NULL UNIQUE,
		match_key   TEXT NOT NULL,
		parsed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE INDEX IF NOT EXISTS idx_unknown_match_key ON unknown_screenshots(match_key)`,
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
