package db

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

// schema is intentionally CREATE TABLE IF NOT EXISTS — if you change columns
// here you must wipe the DB (scripts/clear-db.sh deletes rows; for column
// changes, rm data/db/owmetrics.db) or write a migration. The frontend reads
// columns directly via app.go, so renaming a column will break the UI.
const schema = `CREATE TABLE IF NOT EXISTS match_results (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	source_file   TEXT NOT NULL UNIQUE,
	source        TEXT,

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

	heroes_played TEXT,
	performance   TEXT,

	parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
