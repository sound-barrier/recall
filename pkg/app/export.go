package app

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"recall/pkg/db"
)

// DataLocation surfaces the on-disk paths Recall uses for state.
// Shown in SettingsView's Directories section and returned by
// GET /api/v1/system/data-location.
type DataLocation struct {
	BaseDir        string `json:"base_dir"`        // <appDataDir>
	SettingsPath   string `json:"settings_path"`   // <baseDir>/settings.json
	DatabasePath   string `json:"database_path"`   // <baseDir>/db/recall.db
	ScreenshotsDir string `json:"screenshots_dir"` // currently-configured screenshots folder (may be "")
}

// GetDataLocation returns the on-disk paths the running app reads and
// writes. The base directory is the active profile's data dir
// (<RECALL_DATA_DIR>/profiles/<active>/); RECALL_DATA_DIR still drives
// the install root so the value the user sees in Settings matches
// what `bash scripts/db-where.sh` would inspect.
func (a *App) GetDataLocation() DataLocation {
	base := a.dataDir()
	return DataLocation{
		BaseDir:        base,
		SettingsPath:   a.settingsPath(),
		DatabasePath:   dbPath(base),
		ScreenshotsDir: a.settings.ScreenshotsDir,
	}
}

// dbPath mirrors the path NewSQLStore opens. Kept here so Settings can
// surface it without poking at internal app wiring.
func dbPath(base string) string {
	return base + "/db/recall.db"
}

// ────────────────────────────────────────────────────────────────────
// Export / import — local backup format. The wire shape is opaque to
// users (they download it as a .json blob and feed it back in later);
// versioned via the `schema` field so we can evolve the format
// without breaking older exports.
// ────────────────────────────────────────────────────────────────────

const exportSchemaV1 = "recall-export/v1"

// exportV1 is the wire format for `GET /api/v1/exports` and the Wails save
// dialog. Mirrors db.Screenshots with a metadata envelope; the
// screenshots_dirs map renders ids→paths so the import side can
// remap auto-increment ids without forcing the source DB's IDs onto
// the destination.
type exportV1 struct {
	Schema         string             `json:"schema"`
	ExportedAt     string             `json:"exported_at"`
	RecallVersion  string             `json:"recall_version"`
	ScreenshotsDir map[string]string  `json:"screenshots_dirs"`
	Summaries      []db.SummaryRow    `json:"summaries"`
	Scoreboards    []db.ScoreboardRow `json:"scoreboards"`
	Personals      []db.PersonalRow   `json:"personals"`
	Ranks          []db.RankRow       `json:"ranks"`
	Unknowns       []db.UnknownRow    `json:"unknowns"`
}

// ExportData snapshots the current store and returns the export
// payload as bytes. The Wails layer hands these bytes to a native
// save dialog; the HTTP layer streams them as a download.
func (a *App) ExportData() ([]byte, error) {
	snap, err := a.store.LoadAll()
	if err != nil {
		return nil, fmt.Errorf("export: load: %w", err)
	}
	dirs := make(map[string]string, len(snap.ScreenshotsDirs))
	for id, path := range snap.ScreenshotsDirs {
		dirs[strconv.FormatInt(id, 10)] = path
	}
	doc := exportV1{
		Schema:         exportSchemaV1,
		ExportedAt:     time.Now().UTC().Format(time.RFC3339),
		RecallVersion:  Version,
		ScreenshotsDir: dirs,
		Summaries:      snap.Summaries,
		Scoreboards:    snap.Scoreboards,
		Personals:      snap.Personals,
		Ranks:          snap.Ranks,
		Unknowns:       snap.Unknowns,
	}
	return json.MarshalIndent(doc, "", "  ")
}

// ImportData replaces the entire local database with the contents of
// a previously-exported payload. Validates the schema version, runs
// every row write inside a fresh transaction-equivalent (Clear +
// re-Upsert), and remaps screenshots_dirs FKs so the destination DB's
// auto-increment ids don't collide with the source's.
//
// Accepts BOTH container formats:
//   - JSON envelope (single document — `recall-export/v1`)
//   - ZIP-of-CSVs (manifest.json + per-table .csv files inside)
//
// The format is detected from the payload's magic bytes (`{` vs
// `PK\x03\x04`); the caller doesn't need to pre-select.
//
// The operation is REPLACE, not MERGE — anything currently in the
// store is dropped before the import lands. The caller is expected to
// surface a confirmation step before invoking this.
func (a *App) ImportData(payload []byte) error {
	payload = stripBOM(payload)
	if looksLikeZIP(payload) {
		return a.importDataCSV(payload)
	}
	if !looksLikeJSON(payload) {
		return fmt.Errorf("import: payload is neither JSON nor a ZIP archive")
	}
	var doc exportV1
	if err := json.Unmarshal(payload, &doc); err != nil {
		return fmt.Errorf("import: decode: %w", err)
	}
	if doc.Schema != exportSchemaV1 {
		return fmt.Errorf("import: unsupported schema %q (this build expects %q)", doc.Schema, exportSchemaV1)
	}

	// Build the source-id → destination-id remap. EnsureScreenshotsDir
	// is idempotent on path; calling it for each source path gives us
	// the destination id whether the path already existed or not.
	remap := make(map[int64]int64, len(doc.ScreenshotsDir))
	for srcIDStr, path := range doc.ScreenshotsDir {
		srcID, err := strconv.ParseInt(srcIDStr, 10, 64)
		if err != nil {
			return fmt.Errorf("import: invalid screenshots_dir id %q: %w", srcIDStr, err)
		}
		dstID, err := a.store.EnsureScreenshotsDir(path)
		if err != nil {
			return fmt.Errorf("import: register dir %q: %w", path, err)
		}
		remap[srcID] = dstID
	}

	if err := a.store.Clear(); err != nil {
		return fmt.Errorf("import: clear: %w", err)
	}

	// Re-register dirs after Clear (Clear wipes screenshots_dirs too)
	// and rebuild the remap from the post-clear ids. Source ids might
	// now map to a different destination set since auto-increment
	// resets aren't guaranteed.
	remap = make(map[int64]int64, len(doc.ScreenshotsDir))
	for srcIDStr, path := range doc.ScreenshotsDir {
		srcID, _ := strconv.ParseInt(srcIDStr, 10, 64)
		dstID, err := a.store.EnsureScreenshotsDir(path)
		if err != nil {
			return fmt.Errorf("import: re-register dir %q: %w", path, err)
		}
		remap[srcID] = dstID
	}

	remapID := func(srcID int64) int64 {
		if srcID == 0 {
			return 0
		}
		if dstID, ok := remap[srcID]; ok {
			return dstID
		}
		// Unknown source id (orphan FK in the export) — drop to NULL
		// rather than fail the whole import.
		return 0
	}

	for _, r := range doc.Summaries {
		r.ID = 0 // let SQLite assign a fresh primary key
		r.ScreenshotsDirID = remapID(r.ScreenshotsDirID)
		if err := a.store.UpsertSummary(r); err != nil {
			return fmt.Errorf("import: summary %q: %w", r.Filename, err)
		}
	}
	for _, r := range doc.Scoreboards {
		r.ID = 0
		r.ScreenshotsDirID = remapID(r.ScreenshotsDirID)
		if err := a.store.UpsertScoreboard(r); err != nil {
			return fmt.Errorf("import: scoreboard %q: %w", r.Filename, err)
		}
	}
	for _, r := range doc.Personals {
		r.ID = 0
		r.ScreenshotsDirID = remapID(r.ScreenshotsDirID)
		if err := a.store.UpsertPersonal(r); err != nil {
			return fmt.Errorf("import: personal %q: %w", r.Filename, err)
		}
	}
	for _, r := range doc.Ranks {
		r.ID = 0
		r.ScreenshotsDirID = remapID(r.ScreenshotsDirID)
		if err := a.store.UpsertRank(r); err != nil {
			return fmt.Errorf("import: rank %q: %w", r.Filename, err)
		}
	}
	for _, r := range doc.Unknowns {
		r.ID = 0
		r.ScreenshotsDirID = remapID(r.ScreenshotsDirID)
		if err := a.store.UpsertUnknown(r); err != nil {
			return fmt.Errorf("import: unknown %q: %w", r.Filename, err)
		}
	}
	return nil
}
