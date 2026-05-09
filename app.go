package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"

	"OWMetrics/backend/db"
	"OWMetrics/backend/parser"
)

type MatchRecord struct {
	ID         int64               `json:"id"`
	SourceFile string              `json:"source_file"`
	Data       parser.MatchResult  `json:"data"`
}

type App struct {
	ctx            context.Context
	screenshotsDir string
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	dataDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatal("could not find config dir:", err)
	}
	appDir := filepath.Join(dataDir, "OWMetrics")
	if err := os.MkdirAll(appDir, 0700); err != nil {
		log.Fatal("could not create app dir:", err)
	}
	if err := db.Init(filepath.Join(appDir, "owmetrics.db")); err != nil {
		log.Fatal("could not init db:", err)
	}

	// screenshots/ relative to the working directory (project root during dev)
	a.screenshotsDir = "screenshots"
}

// ParseScreenshots runs the local OCR pipeline against every image in the
// screenshots directory and upserts the result into the database.
func (a *App) ParseScreenshots() error {
	results, err := parser.ParseScreenshotsDir(a.screenshotsDir)
	if err != nil {
		return err
	}
	for filename, result := range results {
		blob, err := json.Marshal(result)
		if err != nil {
			return err
		}
		_, err = db.DB.Exec(
			`INSERT INTO match_results (source_file, data) VALUES (?, ?)
			 ON CONFLICT(source_file) DO UPDATE SET data = excluded.data`,
			filename, string(blob),
		)
		if err != nil {
			return err
		}
	}
	return nil
}

// GetMatchResults returns all stored match results from the database.
func (a *App) GetMatchResults() ([]MatchRecord, error) {
	rows, err := db.DB.Query(`SELECT id, source_file, data FROM match_results ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []MatchRecord
	for rows.Next() {
		var rec MatchRecord
		var raw string
		if err := rows.Scan(&rec.ID, &rec.SourceFile, &raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(raw), &rec.Data); err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	return records, rows.Err()
}