package app

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

// Settings is the on-disk JSON config the user persists across runs.
// New user-tweakable knobs can be added as new fields without migration
// (missing fields unmarshal to their zero value — which is exactly the
// default for the boolean toggles).
type Settings struct {
	ScreenshotsDir    string `json:"screenshots_dir"`
	TesseractPath     string `json:"tesseract_path"`
	PrometheusEnabled bool   `json:"prometheus_enabled"`
	WatchEnabled      bool   `json:"watch_enabled"`
}

// appBaseDir returns the install-wide base directory. Used by the
// profile manager to root the <base>/profiles/<name>/ tree and by
// pre-Startup tests that haven't loaded profiles. Honors the
// `RECALL_DATA_DIR` env override (set in `.envrc` to `<repo>/data` so
// `wails dev` keeps its data under the repo for easy inspection);
// falls through to the platform-appropriate user-config directory
// for shipped builds:
//
//	macOS:   ~/Library/Application Support/Recall/
//	Linux:   $XDG_CONFIG_HOME/recall/  (fallback ~/.config/recall/)
//	Windows: %AppData%\Recall\
//
// The env-var path is taken as-is — no platform-name suffix appended —
// so the override is a complete, absolute placement decision.
func appBaseDir() string {
	if dir := os.Getenv("RECALL_DATA_DIR"); dir != "" {
		return dir
	}
	base, err := os.UserConfigDir()
	if err != nil {
		// Should not happen on any supported OS; fall back to ~/.recall.
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".recall")
	}
	name := "recall"
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		name = "Recall"
	}
	return filepath.Join(base, name)
}

// BaseDir exposes the install-wide base directory to out-of-package
// callers (the dev seed tool at cmd/seed-dev) so they can resolve the
// same profile tree the App opens. Production callers continue to use
// the unexported form.
func BaseDir() string { return appBaseDir() }

// dataDir returns the directory the App reads/writes settings + the
// SQLite DB from. Once profiles have been loaded (Startup), it's the
// active profile's directory under <base>/profiles/<name>/. Before
// that — and in tests that wire an App via NewWithStore without
// running Startup — it falls back to the base dir so settings IO
// stays HOME-isolation friendly.
func (a *App) dataDir() string {
	if a.profiles != nil {
		return a.profiles.ActiveDir()
	}
	return appBaseDir()
}

func (a *App) settingsPath() string {
	return filepath.Join(a.dataDir(), "settings.json")
}

func (a *App) loadSettings() Settings {
	raw, err := os.ReadFile(a.settingsPath())
	if err != nil {
		return defaultSettings() // file doesn't exist yet (first run); use defaults
	}
	return loadSettingsFrom(bytes.NewReader(raw))
}

// loadSettingsFrom parses Settings out of an io.Reader, filling defaults for
// any field the JSON didn't set. Malformed JSON falls back to defaults
// entirely — matches the historical "first run / corrupted file is harmless"
// behavior. Split out of loadSettings so tests don't need to round-trip
// through the real settings.json path.
func loadSettingsFrom(r io.Reader) Settings {
	s := defaultSettings()
	raw, err := io.ReadAll(r)
	if err != nil {
		return s
	}
	_ = json.Unmarshal(raw, &s) // ignore malformed JSON; keep defaults
	return s
}

// defaultSettings returns a fresh Settings with first-run defaults
// applied. ScreenshotsDir intentionally stays "" so that
// autoProbeOnFirstRun (called from Startup) actually fires — the
// previous default of the relative literal "screenshots" was a
// wails-dev ergonomic shortcut that silently sabotaged the
// auto-probe (it early-returns on any non-empty value) AND survived
// into the shipped Recall.app where the relative path resolves to
// nothing under the .app bundle's working directory. Startup's
// validate-and-clear step catches any stale absolute value too.
func defaultSettings() Settings {
	return Settings{}
}

func (a *App) saveSettings(s Settings) error {
	if err := os.MkdirAll(filepath.Dir(a.settingsPath()), 0o700); err != nil {
		return err
	}
	b, err := marshalSettings(s)
	if err != nil {
		return err
	}
	// 0o600 (owner-only RW) per gosec G306. settings.json holds
	// user-controlled paths (screenshots dir, tesseract path); no
	// reason for other users on the host to read it.
	return os.WriteFile(a.settingsPath(), b, 0o600)
}

// marshalSettings is the pure JSON-encoding step of saveSettings. Pulled out
// so tests can verify the on-disk shape without touching the filesystem.
func marshalSettings(s Settings) ([]byte, error) {
	return json.MarshalIndent(s, "", "  ")
}
