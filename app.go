package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"os"
	"path/filepath"

	"OWMetrics/backend/db"
	"OWMetrics/backend/parser"
)

type MatchRecord struct {
	ID         int64              `json:"id"`
	SourceFile string             `json:"source_file"`
	Data       parser.MatchResult `json:"data"`
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

	// data/db/ relative to the working directory (project root during dev,
	// alongside the binary in production).
	dbDir := filepath.Join("data", "db")
	if err := os.MkdirAll(dbDir, 0700); err != nil {
		log.Fatal("could not create db dir:", err)
	}
	if err := db.Init(filepath.Join(dbDir, "owmetrics.db")); err != nil {
		log.Fatal("could not init db:", err)
	}

	// screenshots/ relative to the working directory.
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
		if err := upsertMatchResult(filename, result); err != nil {
			return err
		}
	}
	return nil
}

// GetMatchResults returns all stored match results from the database.
func (a *App) GetMatchResults() ([]MatchRecord, error) {
	rows, err := db.DB.Query(`SELECT
		id, source_file, source,
		map, type, mode, role, hero,
		eliminations, assists, deaths, damage, healing, mitigation,
		result, final_score, date, finished_at, game_length,
		heroes_played, performance
		FROM match_results ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []MatchRecord
	for rows.Next() {
		rec, err := scanMatchRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	return records, rows.Err()
}

// upsertMatchResult inserts (or updates on source_file conflict) one parsed
// screenshot into the explicit-column schema. Nested fields (heroes_played
// and performance) are stored as JSON sub-blobs since they're variable-length
// per-screenshot data that the frontend just wants to display, not query.
func upsertMatchResult(filename string, r *parser.MatchResult) error {
	var heroesJSON, perfJSON sql.NullString
	if len(r.HeroesPlayed) > 0 {
		b, err := json.Marshal(r.HeroesPlayed)
		if err != nil {
			return err
		}
		heroesJSON = sql.NullString{String: string(b), Valid: true}
	}
	if r.Performance != nil {
		b, err := json.Marshal(r.Performance)
		if err != nil {
			return err
		}
		perfJSON = sql.NullString{String: string(b), Valid: true}
	}

	_, err := db.DB.Exec(`INSERT INTO match_results (
		source_file, source,
		map, type, mode, role, hero,
		eliminations, assists, deaths, damage, healing, mitigation,
		result, final_score, date, finished_at, game_length,
		heroes_played, performance
	) VALUES (?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?)
	ON CONFLICT(source_file) DO UPDATE SET
		source        = excluded.source,
		map           = excluded.map,
		type          = excluded.type,
		mode          = excluded.mode,
		role          = excluded.role,
		hero          = excluded.hero,
		eliminations  = excluded.eliminations,
		assists       = excluded.assists,
		deaths        = excluded.deaths,
		damage        = excluded.damage,
		healing       = excluded.healing,
		mitigation    = excluded.mitigation,
		result        = excluded.result,
		final_score   = excluded.final_score,
		date          = excluded.date,
		finished_at   = excluded.finished_at,
		game_length   = excluded.game_length,
		heroes_played = excluded.heroes_played,
		performance   = excluded.performance,
		parsed_at     = CURRENT_TIMESTAMP`,
		filename, r.Source,
		r.Map, r.Type, r.Mode, r.Role, r.Hero,
		r.Eliminations, r.Assists, r.Deaths, r.Damage, r.Healing, r.Mitigation,
		nullableString(r.Result), nullableString(r.FinalScore),
		nullableString(r.Date), nullableString(r.FinishedAt), nullableString(r.GameLength),
		heroesJSON, perfJSON,
	)
	return err
}

func scanMatchRecord(rows *sql.Rows) (MatchRecord, error) {
	var rec MatchRecord
	var source, mapCol, typeCol, mode, role, hero sql.NullString
	var result, finalScore, date, finishedAt, gameLength sql.NullString
	var heroesJSON, perfJSON sql.NullString
	err := rows.Scan(
		&rec.ID, &rec.SourceFile, &source,
		&mapCol, &typeCol, &mode, &role, &hero,
		&rec.Data.Eliminations, &rec.Data.Assists, &rec.Data.Deaths,
		&rec.Data.Damage, &rec.Data.Healing, &rec.Data.Mitigation,
		&result, &finalScore, &date, &finishedAt, &gameLength,
		&heroesJSON, &perfJSON,
	)
	if err != nil {
		return rec, err
	}
	rec.Data.Source = source.String
	rec.Data.Map = mapCol.String
	rec.Data.Type = typeCol.String
	rec.Data.Mode = mode.String
	rec.Data.Role = role.String
	rec.Data.Hero = hero.String
	rec.Data.Result = result.String
	rec.Data.FinalScore = finalScore.String
	rec.Data.Date = date.String
	rec.Data.FinishedAt = finishedAt.String
	rec.Data.GameLength = gameLength.String
	if heroesJSON.Valid && heroesJSON.String != "" {
		_ = json.Unmarshal([]byte(heroesJSON.String), &rec.Data.HeroesPlayed)
	}
	if perfJSON.Valid && perfJSON.String != "" {
		_ = json.Unmarshal([]byte(perfJSON.String), &rec.Data.Performance)
	}
	return rec, nil
}

func nullableString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
