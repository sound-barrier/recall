package db

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func Init(path string) error {
	var err error
	DB, err = sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`CREATE TABLE IF NOT EXISTS match_results (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		source_file TEXT NOT NULL UNIQUE,
		data        TEXT NOT NULL
	)`)
	return err
}