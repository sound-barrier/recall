package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"recall/pkg/parser"
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

// NamedCandidate is one entry in the Windows screenshot-source picker
// surfaced on the first-run Settings empty state. Each card the user
// sees corresponds to one canonical capture method:
//
//	"nvidia"  — Nvidia Overlay (GeForce Experience instant replay)
//	"prntscn" — OW's PrntScn default Documents folder
//	"snip"    — Win+Shift+S Snip tool screenshots
//	"steam"   — Steam in-game F12 captures
//
// Path is the resolved first existing variant per source (each source
// has 1–2 OneDrive-redirected fallbacks; the resolver returns the
// first hit). Exists tells the UI whether to render the card as
// clickable or grayed-with-tooltip. Empty path + Exists=false means
// the source has no plausible location on this machine — the card
// still renders so the user sees the option exists.
//
// macOS / Linux return an empty slice from ProbeScreenshotsCandidates;
// the frontend hides the grid entirely on those platforms.
type NamedCandidate struct {
	Name   string `json:"name"`
	Label  string `json:"label"`
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
}

// firstExistingCandidate walks the platform-specific list of likely
// Overwatch screenshot locations and returns the first one that
// exists on this machine. Used by autoProbeOnFirstRun so a fresh
// install adopts the OW folder without forcing the user through the
// picker. The public surface for the same walk is
// ProbeScreenshotsCandidates (Windows-only, 4-card grid); this
// helper is the all-platform single-best variant for the
// startup-quiet code path.
func firstExistingCandidate() (string, bool) {
	for _, p := range probeCandidates() {
		if dirExists(p) {
			return p, true
		}
	}
	return "", false
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

// ProbeScreenshotsCandidates returns the per-source list the Windows
// first-run picker renders. Each entry corresponds to one card in
// the 2 × 2 grid (Nvidia Overlay / PrntScn / Snip tool / Steam).
// macOS / Linux get an empty slice — auto-detect is Windows-only by
// design; the frontend hides the grid on those platforms.
//
// Each source has 1–2 known location variants (mostly OneDrive
// redirections). The probe walks each variant in order and surfaces
// the first existing one as Path; if none exist the source's
// canonical first path lifts to Path with Exists=false so the user
// still sees the card with a "not found" status dot.
func (a *App) ProbeScreenshotsCandidates() []NamedCandidate {
	out := make([]NamedCandidate, 0, 4)
	for _, s := range candidateSources() {
		first, exists := firstExisting(s.paths)
		out = append(out, NamedCandidate{
			Name:   s.name,
			Label:  s.label,
			Path:   first,
			Exists: exists,
		})
	}
	return out
}

// NamedCandidateStats is the per-source diagnostic blob the picker
// hydrates after the cards mount. file_count, last_modified, and
// recognised_count tell the user which source their captures are
// actually landing in — a card with "0 files" vs "47 files · 2h ago"
// reads at a glance.
//
// The walk is bounded to candidateStatsMaxEntries per source so a
// synced cloud folder with thousands of unrelated files (Pictures
// holding a lifetime of phone backups) doesn't block the response.
//
// "Recognised" means the filename starts with one of the per-tool
// prefixes from parser.ScreenshotSources — i.e. would be picked up
// by the parser. A folder full of Win Snip captures shows
// "12 files · 0 recognised" so the user immediately knows the
// folder isn't the right source.
type NamedCandidateStats struct {
	Name            string `json:"name"`
	FileCount       int    `json:"file_count"`
	LastModified    string `json:"last_modified"` // RFC3339 UTC, empty if no files
	RecognisedCount int    `json:"recognised_count"`
}

// candidateStatsMaxEntries is the hard upper bound on the directory
// walk per source. 1000 is high enough that the count is a useful
// signal ("a lot of files") without exhausting a synced cloud folder
// indexer mid-walk.
const candidateStatsMaxEntries = 1000

// ProbeScreenshotsCandidateStats walks the first-existing path of
// each candidate source and returns per-source counts + last-write
// timestamp. Run asynchronously after the picker grid mounts — the
// dirread is fast on local disks but can spin for a few seconds on
// a synced cloud folder; we don't want to block the visible UI.
//
// Mirrors ProbeScreenshotsCandidates' Windows-only contract: returns
// nil on macOS / Linux (the frontend hides the grid there).
func (a *App) ProbeScreenshotsCandidateStats() []NamedCandidateStats {
	specs := candidateSources()
	out := make([]NamedCandidateStats, 0, len(specs))
	for _, s := range specs {
		path, exists := firstExisting(s.paths)
		stats := NamedCandidateStats{Name: s.name}
		if exists {
			files, latest := walkSourceDir(path)
			stats.FileCount = len(files)
			if !latest.IsZero() {
				stats.LastModified = latest.UTC().Format(time.RFC3339)
			}
			stats.RecognisedCount = countRecognised(files)
		}
		out = append(out, stats)
	}
	return out
}

// walkSourceDir reads up to candidateStatsMaxEntries names from dir
// and returns (filenames, latest-mtime). Non-files (subdirectories,
// symlinks to anywhere) are skipped — the picker is about screenshot
// captures and the parser doesn't recurse.
func walkSourceDir(dir string) ([]string, time.Time) {
	// #nosec G304 -- `dir` comes from candidateSources() which builds
	// paths from os.UserHomeDir() + a hard-coded per-source suffix
	// (Videos/Overwatch, Documents/Overwatch/ScreenShots/Overwatch,
	// etc.) plus the Steam-registry resolver. None of it is user
	// input; the value is the same shape ProbeScreenshotsCandidates
	// surfaces and the user already trusted at first-run pick time.
	f, err := os.Open(dir)
	if err != nil {
		return nil, time.Time{}
	}
	defer func() { _ = f.Close() }()
	entries, err := f.Readdir(candidateStatsMaxEntries)
	if err != nil {
		return nil, time.Time{}
	}
	names := make([]string, 0, len(entries))
	var latest time.Time
	for _, e := range entries {
		if !e.Mode().IsRegular() {
			continue
		}
		names = append(names, e.Name())
		if mt := e.ModTime(); mt.After(latest) {
			latest = mt
		}
	}
	return names, latest
}

// countRecognised tallies how many filenames the parser's filename
// grammars would accept. A "Win Snip" folder full of generic
// "Screenshot 2026-06-07 224855.png" reads as fully recognised; a
// generic Pictures folder reads as zero.
func countRecognised(names []string) int {
	sources := parser.Sources()
	if len(sources) == 0 {
		return 0
	}
	n := 0
	for _, name := range names {
		for _, src := range sources {
			if strings.HasPrefix(name, src.Prefix) && src.Regex.MatchString(name) {
				n++
				break
			}
		}
	}
	return n
}

// sourceSpec is one entry in candidateSources(). Each card maps to
// one spec.
type sourceSpec struct {
	name  string
	label string
	paths []string
}

// firstExisting returns the first path in `paths` that resolves to a
// real directory. If none exist it returns the first path (so the
// "not found" card still has a path to display) and exists=false.
// Empty input returns ("", false).
func firstExisting(paths []string) (string, bool) {
	for _, p := range paths {
		if dirExists(p) {
			return p, true
		}
	}
	if len(paths) == 0 {
		return "", false
	}
	return paths[0], false
}

// candidateSources is the per-platform source list. Returns nil on
// non-Windows so ProbeScreenshotsCandidates returns an empty slice
// and the frontend can hide the grid.
//
// Windows paths:
//
//	Nvidia:  %USERPROFILE%\Videos\Overwatch
//	PrntScn: %USERPROFILE%\Documents\Overwatch\ScreenShots\Overwatch
//	          + OneDrive variant
//	Snip:    %USERPROFILE%\Pictures\Screenshots
//	          + OneDrive variant
//	Steam:   <SteamInstall>\userdata\<id>\760\remote\<OW-appid>\
//	          screenshots — see resolveSteamScreenshots in
//	          probe_windows.go for the registry-walk shape.
func candidateSources() []sourceSpec {
	if runtime.GOOS != "windows" {
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil
	}
	specs := []sourceSpec{
		{
			name:  "nvidia",
			label: "Nvidia Overlay",
			paths: []string{
				filepath.Join(home, "Videos", "Overwatch"),
			},
		},
		{
			name:  "prntscn",
			label: "OW default",
			paths: []string{
				filepath.Join(home, "Documents", "Overwatch", "ScreenShots", "Overwatch"),
				filepath.Join(home, "OneDrive", "Documents", "Overwatch", "ScreenShots", "Overwatch"),
			},
		},
		{
			name:  "snip",
			label: "Snip tool",
			paths: []string{
				filepath.Join(home, "Pictures", "Screenshots"),
				filepath.Join(home, "OneDrive", "Pictures", "Screenshots"),
			},
		},
	}
	steamPath, _ := resolveSteamScreenshots()
	steamPaths := []string{}
	if steamPath != "" {
		steamPaths = append(steamPaths, steamPath)
	}
	specs = append(specs, sourceSpec{
		name:  "steam",
		label: "Steam install",
		paths: steamPaths,
	})
	return specs
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
	path, ok := firstExistingCandidate()
	if !ok {
		return
	}
	a.settings.ScreenshotsDir = path
	a.saveSettingsBestEffort()
}
