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

// appDataDir returns the platform-appropriate directory for Recall's
// settings and database. It follows OS conventions so the files land in
// the right place for a distributed app regardless of cwd:
//
//	macOS:   ~/Library/Application Support/Recall/
//	Linux:   $XDG_CONFIG_HOME/recall/  (fallback ~/.config/recall/)
//	Windows: %AppData%\Recall\
func appDataDir() string {
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

func settingsPath() string { return filepath.Join(appDataDir(), "settings.json") }

func loadSettings() Settings {
	raw, err := os.ReadFile(settingsPath())
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
	if s.ScreenshotsDir == "" {
		s.ScreenshotsDir = "screenshots"
	}
	return s
}

// defaultSettings returns a fresh Settings with first-run defaults applied.
func defaultSettings() Settings {
	return Settings{ScreenshotsDir: "screenshots"} // relative default works for `wails dev`
}

func saveSettings(s Settings) error {
	if err := os.MkdirAll(filepath.Dir(settingsPath()), 0o700); err != nil {
		return err
	}
	b, err := marshalSettings(s)
	if err != nil {
		return err
	}
	// 0o600 (owner-only RW) per gosec G306. settings.json holds
	// user-controlled paths (screenshots dir, tesseract path); no
	// reason for other users on the host to read it.
	return os.WriteFile(settingsPath(), b, 0o600)
}

// marshalSettings is the pure JSON-encoding step of saveSettings. Pulled out
// so tests can verify the on-disk shape without touching the filesystem.
func marshalSettings(s Settings) ([]byte, error) {
	return json.MarshalIndent(s, "", "  ")
}
