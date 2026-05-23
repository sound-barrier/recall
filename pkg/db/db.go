// Package db owns the SQLite persistence layer for Recall. The Store
// interface is the boundary the app uses; SQLStore is the production
// implementation. The schema and migrations live here so they can be
// shared across implementations.
package db

// schema rebuilds match_results around a derived match_key (the canonical
// "E:A:D" tuple) so a single logical match — fed by both the SUMMARY screen
// and the TEAMS scoreboard — lands in one row. source_files is a JSON array
// of every screenshot that contributed.
//
// This is CREATE TABLE IF NOT EXISTS; column changes require either a real
// migration (see the migrations slice) or deleting recall.db.
const schema = `CREATE TABLE IF NOT EXISTS match_results (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	match_key     TEXT NOT NULL UNIQUE,
	source_files  TEXT NOT NULL,
	source_types  TEXT,

	map           TEXT,
	type          TEXT,
	mode          TEXT,
	role          TEXT,
	hero          TEXT,

	eliminations  INTEGER NOT NULL DEFAULT 0,
	assists       INTEGER NOT NULL DEFAULT 0,
	deaths        INTEGER NOT NULL DEFAULT 0,
	damage        INTEGER NOT NULL DEFAULT 0,
	healing       INTEGER NOT NULL DEFAULT 0,
	mitigation    INTEGER NOT NULL DEFAULT 0,

	result        TEXT,
	final_score   TEXT,
	date          TEXT,
	finished_at   TEXT,
	game_length   TEXT,

	heroes_played  TEXT,
	performance    TEXT,

	rank           TEXT,
	level          INTEGER NOT NULL DEFAULT 0,
	rank_progress  INTEGER NOT NULL DEFAULT 0,
	change_percent INTEGER NOT NULL DEFAULT 0,
	modifiers      TEXT,
	sr             TEXT,

	parsed_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`

// Lightweight in-place migrations: each statement is idempotent (or
// no-ops cleanly when the schema already matches). Add new ALTERs here
// when adding new columns so existing databases pick them up without a
// wipe. Errors that look like "duplicate column" are swallowed because
// SQLite has no IF NOT EXISTS for ADD COLUMN until v3.35.
var migrations = []string{
	`ALTER TABLE match_results ADD COLUMN source_types TEXT`,
}
