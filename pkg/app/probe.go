package app

import (
	"os"
	"path/filepath"
	"runtime"
)

// ProbeResult is what `GetProbeResult` / the Detect Overwatch Folder
// button surfaces to the UI. `Path` is the first existing candidate
// directory; empty when nothing matched. `Tried` lists every path
// the probe checked, in order — useful diagnostic context to render
// under the "No default found" state.
type ProbeResult struct {
	Found bool     `json:"found"`
	Path  string   `json:"path"`
	Tried []string `json:"tried"`
}

// ProbeScreenshotsDir walks a platform-specific list of likely
// Overwatch screenshot locations and returns the first one that
// exists. Probe is read-only — does not write to settings on its
// own; the caller decides whether to persist.
//
// Returned ProbeResult.Tried is the full ordered list of candidates
// inspected; the frontend's empty state can echo it back so the
// user understands which paths were looked at when nothing was
// found. This avoids the "probe didn't find my folder, why?"
// support-loop where the answer is usually "the user moved
// Documents to OneDrive on a non-default drive".
func (a *App) ProbeScreenshotsDir() ProbeResult {
	tried := probeCandidates()
	for _, p := range tried {
		if dirExists(p) {
			return ProbeResult{Found: true, Path: p, Tried: tried}
		}
	}
	return ProbeResult{Found: false, Tried: tried}
}

// probeCandidates returns the ordered list of paths to try, derived
// from the current OS and the user's $HOME. Each entry points at
// the directory OW2 writes screenshots into by default — not the
// parent Documents dir.
//
// Sources for these paths:
//   - Windows: Battle.net OW2 client default = `Documents\Overwatch\
//     ScreenShots\Overwatch\`. OneDrive-redirected Documents is a
//     common variant.
//   - macOS:  no native OW2 client today, but a Documents-mirrored
//     path is honored when the user runs through CrossOver or a
//     migrated install.
//   - Linux:  Steam Proton wraps OW2 in a Wine prefix at
//     `~/.steam/steam/steamapps/compatdata/2357570/pfx/...`. Direct
//     Wine + Lutris installs land under `~/.wine/...`.
func probeCandidates() []string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil
	}
	switch runtime.GOOS {
	case "windows":
		return []string{
			filepath.Join(home, "Documents", "Overwatch", "ScreenShots", "Overwatch"),
			filepath.Join(home, "OneDrive", "Documents", "Overwatch", "ScreenShots", "Overwatch"),
		}
	case "darwin":
		return []string{
			filepath.Join(home, "Documents", "Overwatch", "ScreenShots", "Overwatch"),
			filepath.Join(home, "Documents", "Blizzard", "Overwatch", "ScreenShots", "Overwatch"),
			filepath.Join(home, "Library", "Application Support", "Blizzard", "Overwatch", "Screenshots", "Overwatch"),
		}
	case "linux":
		// Best-effort guesses for the two common Wine-prefix shapes.
		// `2357570` is the Steam app id for Overwatch 2.
		username := filepath.Base(home)
		return []string{
			filepath.Join(home, ".steam", "steam", "steamapps", "compatdata", "2357570", "pfx", "drive_c", "users", "steamuser", "Documents", "Overwatch", "ScreenShots", "Overwatch"),
			filepath.Join(home, ".wine", "drive_c", "users", username, "Documents", "Overwatch", "ScreenShots", "Overwatch"),
		}
	default:
		return nil
	}
}

// dirExists reports whether path is a real directory the current
// process can stat. Symlink-following is on; permission errors
// fail closed.
func dirExists(path string) bool {
	if path == "" {
		return false
	}
	fi, err := os.Stat(path)
	if err != nil {
		return false
	}
	return fi.IsDir()
}

// autoProbeOnFirstRun is called from Startup when settings carry no
// screenshots dir. Quietly applies the probe result so a fresh
// install finds the OW folder without forcing the user through the
// picker. Manual probes (via the Settings button) call
// ProbeScreenshotsDir directly and let the UI handle persistence.
func (a *App) autoProbeOnFirstRun() {
	if a.settings.ScreenshotsDir != "" {
		return
	}
	res := a.ProbeScreenshotsDir()
	if !res.Found {
		return
	}
	a.settings.ScreenshotsDir = res.Path
	_ = a.saveSettings(a.settings)
}
