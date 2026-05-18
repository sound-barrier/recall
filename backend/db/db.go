package db

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

// schema rebuilds match_results around a derived match_key (the canonical
// "E:A:D" tuple) so a single logical match — fed by both the SUMMARY screen
// and the TEAMS scoreboard — lands in one row. source_files is a JSON array
// of every screenshot that contributed.
//
// This is CREATE TABLE IF NOT EXISTS; column changes require `rm
// data/db/recall.db` (or a real migration).
const schema = `CREATE TABLE IF NOT EXISTS match_results (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	match_key     TEXT NOT NULL UNIQUE,
	source_files  TEXT NOT NULL,

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

func Init(path string) error {
	var err error
	DB, err = sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	_, err = DB.Exec(schema)
	return err
}
