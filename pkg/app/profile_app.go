package app

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// ProfilesResponse is the wire shape for GET /api/v1/profiles and the
// Wails GetProfiles binding. One ergonomic object so the frontend
// doesn't need two round-trips for "what's active" + "what exists."
type ProfilesResponse struct {
	Active   string   `json:"active"`
	Profiles []string `json:"profiles"`
}

// SetProfileOverride stashes a profile name to activate during the
// next Startup. main.go / main_server.go call this when the user
// passes `--profile=<name>` on the command line. The override is
// applied EXACTLY ONCE in Startup, after profiles.json is loaded;
// the named profile is auto-created if it doesn't exist. Recorded as
// the active profile in profiles.json so subsequent launches without
// --profile resume on the same one.
func (a *App) SetProfileOverride(name string) {
	a.profileOverride = name
}

// GetProfiles returns the active profile + the sorted list of every
// known profile. Read-only — safe to call from any goroutine.
func (a *App) GetProfiles() ProfilesResponse {
	if a.profiles == nil {
		// Pre-Startup safety: return a single-default placeholder so
		// the frontend's first paint doesn't render an empty switcher.
		return ProfilesResponse{
			Active:   DefaultProfileName,
			Profiles: []string{DefaultProfileName},
		}
	}
	return ProfilesResponse{
		Active:   a.profiles.Active(),
		Profiles: a.profiles.List(),
	}
}

// CreateProfile creates a new profile + immediately activates it. The
// create-then-switch sequence matches the typical UX (user picks
// "New profile…" from the masthead chip, names it, expects to be on
// it). Returns ErrInvalidProfileName / ErrProfileExists for typed 4xx
// mapping at the HTTP boundary.
func (a *App) CreateProfile(name string) error {
	if a.profiles == nil {
		return fmt.Errorf("profiles: not initialized")
	}
	if err := a.profiles.Create(name); err != nil {
		return err
	}
	return a.activateAndReload(name)
}

// SwitchProfile activates an existing profile. The full App teardown
// + reload sequence runs so settings, the SQLite connection, the
// watcher, and the metrics endpoint all swap atomically to the new
// profile's state. Returns ErrProfileNotFound for unknown names.
func (a *App) SwitchProfile(name string) error {
	if a.profiles == nil {
		return fmt.Errorf("profiles: not initialized")
	}
	if !containsProfile(a.profiles.List(), name) {
		return fmt.Errorf("%w: %q", ErrProfileNotFound, name)
	}
	return a.activateAndReload(name)
}

// DeleteProfile drops a profile from the list AND wipes its dir. The
// active profile cannot be deleted — callers must SwitchProfile first.
func (a *App) DeleteProfile(name string) error {
	if a.profiles == nil {
		return fmt.Errorf("profiles: not initialized")
	}
	return a.profiles.Delete(name)
}

// activateAndReload is the common tail of Create/Switch. After the
// profile name change is recorded, we tear down the active store +
// background services and re-build them at the new profile's dir.
//
// Failure path is best-effort: if the teardown succeeds but the
// re-init fails (e.g. SQLite can't open the new path), the App is
// left in a broken state and the operator restarts. Acceptable
// because the only realistic failure is filesystem-level (out of
// disk, permission). The HTTP handler returns 500 and the user
// retries.
func (a *App) activateAndReload(name string) error {
	// Persist any in-memory settings deltas the user staged but hasn't
	// triggered a save for. The toggle setters all save inline, so
	// this is paranoia — but cheap paranoia.
	_ = a.saveSettings(a.settings)

	// Tear down the background services tied to the OLD profile.
	a.stopWatching()
	a.stopMetrics()
	if a.store != nil {
		if closer, ok := a.store.(interface{ Close() error }); ok {
			_ = closer.Close()
		}
		a.store = nil
	}

	if err := a.profiles.Activate(name); err != nil {
		return err
	}

	// Re-init at the new dir.
	a.settings = a.loadSettings()
	if a.settings.ScreenshotsDir != "" && pathIsMissingOrNotADir(a.settings.ScreenshotsDir) {
		a.settings.ScreenshotsDir = ""
		_ = a.saveSettings(a.settings)
	}
	if a.settings.TesseractPath == "" {
		a.settings.TesseractPath = defaultTesseractPath()
		_ = a.saveSettings(a.settings)
	}
	a.tessStatus = checkTesseract(a.settings.TesseractPath)
	parser.SetTesseractPath(a.settings.TesseractPath)
	a.autoProbeOnFirstRun()

	dbDir := filepath.Join(a.dataDir(), "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		return fmt.Errorf("profiles: ensure db dir for %q: %w", name, err)
	}
	s, err := db.NewSQLStore(filepath.Join(dbDir, "recall.db"))
	if err != nil {
		log.Printf("profiles: open db for %q: %v", name, err)
		return fmt.Errorf("profiles: open db for %q: %w", name, err)
	}
	a.store = s

	if a.settings.PrometheusEnabled {
		a.startMetrics()
	}
	if a.settings.WatchEnabled {
		a.startWatching()
	}
	return nil
}
