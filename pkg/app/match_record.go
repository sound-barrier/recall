package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"recall/pkg/db"
	"recall/pkg/parser"
)

type MatchRecord struct {
	ID          int64    `json:"id"`
	MatchKey    string   `json:"match_key"`
	SourceFiles []string `json:"source_files"`
	// SourceTypes maps a source filename to the OW screenshot type the
	// parser classified it as ("summary" / "scoreboard" / "personal" /
	// "rank"). Populated at parse time and persisted in the DB so the UI
	// can label each file. May be nil/missing for rows parsed before
	// type tracking landed — fall back to the per-row Data-Coverage
	// inference when a file isn't in the map.
	SourceTypes map[string]string `json:"source_types,omitempty"`
	// SourceParsedAt maps a source filename to the ISO8601 timestamp
	// when that file was first inserted into the DB. Stamped by
	// ParseScreenshots at OCR time; preserved across subsequent
	// re-parses (existing entries are never overwritten). May be nil
	// or missing entries for rows / files persisted before the
	// column landed; the UI shows a "—" placeholder in that case.
	SourceParsedAt map[string]string `json:"source_parsed_at,omitempty"`
	// ParsedAt is the match-level "first inserted at" timestamp from
	// the DB schema's parsed_at column. Stable across re-parses so
	// the UI can show "this match was parsed on X" without the value
	// shifting when a later screenshot is added.
	ParsedAt string             `json:"parsed_at,omitempty"`
	Data     parser.MatchResult `json:"data"`
}

// GetNewScreenshotCount returns the number of image files in the configured
// screenshots directory that haven't been parsed yet (i.e. don't appear in
// any existing DB row's source_files). Returns 0 when the directory is
// unset, empty, or missing.
func (a *App) GetNewScreenshotCount() (int, error) {
	if a.settings.ScreenshotsDir == "" {
		return 0, nil
	}
	parsed, err := a.store.LoadSourceFilenames()
	if err != nil {
		return 0, err
	}
	entries, err := os.ReadDir(a.settings.ScreenshotsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	count := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
			continue
		}
		if !parsed[e.Name()] {
			count++
		}
	}
	return count, nil
}

// GetMatchResults returns all stored, merged match rows.
func (a *App) GetMatchResults() ([]MatchRecord, error) {
	recs, err := a.readAllRecords()
	if err != nil {
		return nil, err
	}
	for i := range recs {
		inferSoleHeroPercent(&recs[i].Data)
		inferResultFromRank(&recs[i].Data)
	}
	return recs, nil
}

// ClearDatabase deletes all rows from match_results, resetting the
// parse history without touching settings or the SQLite schema.
func (a *App) ClearDatabase() error { return a.store.Clear() }

// readAllRecords pulls every match through the Store and decodes the JSON
// columns into the strongly-typed MatchRecord shape the UI / metrics layer
// uses. Initializes the slice to length 0 so an empty result set still
// JSON-marshals as `[]` (the OpenAPI schema for /api/match-results declares
// `type: array`, which a nil slice would violate).
func (a *App) readAllRecords() ([]MatchRecord, error) {
	rows, err := a.store.LoadAll()
	if err != nil {
		return nil, err
	}
	records := make([]MatchRecord, 0, len(rows))
	for _, r := range rows {
		rec, err := rowToMatchRecord(r)
		if err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	return records, nil
}

// rowToMatchRecord lifts the JSON columns out of a db.MatchRow into their
// typed counterparts on a MatchRecord.
func rowToMatchRecord(r db.MatchRow) (MatchRecord, error) {
	rec := MatchRecord{
		ID:             r.ID,
		MatchKey:       r.MatchKey,
		SourceFiles:    r.SourceFiles,
		SourceTypes:    r.SourceTypes,
		SourceParsedAt: r.SourceParsedAt,
		ParsedAt:       r.ParsedAt,
		Data: parser.MatchResult{
			Map: r.Map, Type: r.Type, Mode: r.Mode, Role: r.Role, Hero: r.Hero,
			Eliminations: r.Eliminations, Assists: r.Assists, Deaths: r.Deaths,
			Damage: r.Damage, Healing: r.Healing, Mitigation: r.Mitigation,
			Result: r.Result, FinalScore: r.FinalScore,
			Date: r.Date, FinishedAt: r.FinishedAt, GameLength: r.GameLength,
			Rank: r.Rank, Level: r.Level,
			RankProgress: r.RankProgress, ChangePercent: r.ChangePercent,
		},
	}
	if r.HeroesPlayedJSON != "" {
		if err := json.Unmarshal([]byte(r.HeroesPlayedJSON), &rec.Data.HeroesPlayed); err != nil {
			return rec, err
		}
	}
	if r.PerformanceJSON != "" {
		if err := json.Unmarshal([]byte(r.PerformanceJSON), &rec.Data.Performance); err != nil {
			return rec, err
		}
	}
	if r.ModifiersJSON != "" {
		if err := json.Unmarshal([]byte(r.ModifiersJSON), &rec.Data.Modifiers); err != nil {
			return rec, err
		}
	}
	if r.SRJSON != "" {
		if err := json.Unmarshal([]byte(r.SRJSON), &rec.Data.SR); err != nil {
			return rec, err
		}
	}
	return rec, nil
}
