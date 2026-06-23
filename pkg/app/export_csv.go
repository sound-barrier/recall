package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"time"

	"recall/pkg/db"
)

// ExportDataCSV produces a zip-of-CSVs equivalent of ExportData's JSON.
// Same data, different container — chosen by the UI based on user
// preference. Round-trippable through ImportData.
func (a *App) ExportDataCSV() ([]byte, error) {
	snap, err := a.store.LoadAll()
	if err != nil {
		return nil, fmt.Errorf("export csv: load: %w", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	// manifest.json — same envelope shape as the JSON export, minus the
	// row arrays (those live in the .csv files).
	manifest := struct {
		Schema        string `json:"schema"`
		ExportedAt    string `json:"exported_at"`
		RecallVersion string `json:"recall_version"`
		Container     string `json:"container"` // "zip-of-csvs"
	}{
		Schema:        exportSchemaV1,
		ExportedAt:    nowUTC(),
		RecallVersion: Version,
		Container:     "zip-of-csvs",
	}
	if err := zipWriteJSON(zw, "manifest.json", manifest); err != nil {
		return nil, err
	}

	// screenshots_dirs.csv — small lookup table.
	if err := zipWriteCSV(
		zw, "screenshots_dirs.csv",
		[]string{"id", "path"},
		mapToRows(snap.ScreenshotsDirs),
	); err != nil {
		return nil, err
	}

	// Parent + child tables.
	if err := zipWriteCSV(zw, "summaries.csv", summaryHeader, summariesToRows(snap.Summaries)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "summary_heroes_played.csv", summaryHeroPlayedHeader, summaryHeroesPlayedToRows(snap.Summaries)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "teams.csv", teamsHeader, teamsToRows(snap.Teams)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "teams_hero_stats.csv", heroStatHeader, teamsStatsToRows(snap.Teams)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "personals.csv", personalHeader, personalsToRows(snap.Personals)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "personal_hero_stats.csv", heroStatHeader, personalStatsToRows(snap.Personals)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "ranks.csv", rankHeader, ranksToRows(snap.Ranks)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "rank_modifiers.csv", []string{"rank_screenshot_id", "modifier"}, rankModifiersToRows(snap.Ranks)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "rank_sr.csv", []string{"rank_screenshot_id", "hero", "sr", "change"}, rankSRToRows(snap.Ranks)); err != nil {
		return nil, err
	}
	if err := zipWriteCSV(zw, "unknowns.csv", unknownHeader, unknownsToRows(snap.Unknowns)); err != nil {
		return nil, err
	}

	// user_layer.json — the override + sidecar tables (manual matches, edits,
	// annotations, hidden flags, queue/play-mode). Nested children make a flat
	// CSV awkward, so this rides as JSON alongside manifest.json; the parent
	// rows stay in their .csv files.
	ul, err := a.snapshotUserLayer()
	if err != nil {
		return nil, err
	}
	if err := zipWriteJSON(zw, "user_layer.json", csvUserLayer{
		UserMatchData: ul.userData, Annotations: ul.annots,
		Hidden: ul.hidden, Queues: ul.queues, PlayModes: ul.playModes,
	}); err != nil {
		return nil, fmt.Errorf("export csv: user layer: %w", err)
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// csvUserLayer is the user_layer.json entry inside the CSV-ZIP bundle — the same
// override/sidecar fields the JSON exportV1 carries inline.
type csvUserLayer struct {
	UserMatchData map[string]db.UserMatchData `json:"user_match_data,omitempty"`
	Annotations   map[string]db.Annotation    `json:"annotations,omitempty"`
	Hidden        []string                    `json:"hidden,omitempty"`
	Queues        map[string]string           `json:"queues,omitempty"`
	PlayModes     map[string]string           `json:"play_modes,omitempty"`
}

// importDataCSV reads a zip-of-CSVs payload, rebuilds a Screenshots
// snapshot (with children re-attached to their parents by source id),
// then routes through the same Clear + Upsert flow as the JSON path.
func (a *App) importDataCSV(payload []byte) error {
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return fmt.Errorf("%w: open zip: %w", ErrImportMalformed, err)
	}
	if err := validateCSVManifest(zr); err != nil {
		return err
	}
	dirs, err := readDirsCSV(zr)
	if err != nil {
		return err
	}
	tables, err := readCSVParentTables(zr)
	if err != nil {
		return err
	}
	remapID, err := a.clearAndRemapDirs("import csv", dirs)
	if err != nil {
		return err
	}
	if err := importAllParentTables(a.store, "import csv", tables, remapID); err != nil {
		return err
	}
	return a.importCSVUserLayer(zr)
}

// importCSVUserLayer applies the bundle's user_layer.json if present. Older CSV
// exports predate it, so absence is a clean no-op — but a present-yet-unreadable
// entry is a real error (hence the presence check rather than swallowing it).
func (a *App) importCSVUserLayer(zr *zip.Reader) error {
	const name = "user_layer.json"
	present := false
	for _, f := range zr.File {
		if f.Name == name {
			present = true
			break
		}
	}
	if !present {
		return nil // pre-user-layer bundle
	}
	b, err := readZipFile(zr, name)
	if err != nil {
		return fmt.Errorf("import csv: read user layer: %w", err)
	}
	var cul csvUserLayer
	if err := json.Unmarshal(b, &cul); err != nil {
		return fmt.Errorf("import csv: user layer: %w", err)
	}
	return a.applyUserLayer(exportV1{
		UserMatchData: cul.UserMatchData, Annotations: cul.Annotations,
		Hidden: cul.Hidden, Queues: cul.Queues, PlayModes: cul.PlayModes,
	})
}

// validateCSVManifest fails fast on a missing or wrong-schema manifest.json.
func validateCSVManifest(zr *zip.Reader) error {
	manifestBytes, err := readZipFile(zr, "manifest.json")
	if err != nil {
		return fmt.Errorf("%w: missing manifest.json: %w", ErrImportMalformed, err)
	}
	var mf struct {
		Schema string `json:"schema"`
	}
	if err := json.Unmarshal(manifestBytes, &mf); err != nil {
		return fmt.Errorf("%w: manifest decode: %w", ErrImportMalformed, err)
	}
	if mf.Schema != exportSchemaV1 {
		return fmt.Errorf("import csv: unsupported schema %q (this build expects %q)", mf.Schema, exportSchemaV1)
	}
	return nil
}

// readCSVParentTables reads the five parent-table CSVs out of the archive.
func readCSVParentTables(zr *zip.Reader) (parentTables, error) {
	summaries, err := readSummariesCSV(zr)
	if err != nil {
		return parentTables{}, err
	}
	teams, err := readTeamsCSV(zr)
	if err != nil {
		return parentTables{}, err
	}
	personals, err := readPersonalsCSV(zr)
	if err != nil {
		return parentTables{}, err
	}
	ranks, err := readRanksCSV(zr)
	if err != nil {
		return parentTables{}, err
	}
	unknowns, err := readUnknownsCSV(zr)
	if err != nil {
		return parentTables{}, err
	}
	return parentTables{summaries: summaries, teams: teams, personals: personals, ranks: ranks, unknowns: unknowns}, nil
}

// nowUTC is a tiny seam used by tests that want a deterministic
// timestamp. Production calls time.Now().UTC().
var nowUTC = func() string {
	return time.Now().UTC().Format(time.RFC3339)
}
