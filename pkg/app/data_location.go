package app

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
// what `bash scripts/db/db-where.sh` would inspect.
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
// surface it without poking at internal app wiring, and so the backup /
// restore paths resolve the live database the same way.
func dbPath(base string) string {
	return base + "/db/recall.db"
}
