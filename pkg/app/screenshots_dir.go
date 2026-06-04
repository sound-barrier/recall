package app

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
)

// revealCommand is a seam over exec.Command so RevealScreenshotsDir
// can be exercised in tests without actually popping a Finder /
// Explorer window. Production wiring is plain exec.Command; tests
// swap in a recorder via t.Cleanup. Mirrors the runTesseractFunc /
// parseSingleFunc pattern in pkg/parser — one-method seams stay as
// function variables rather than interfaces.
var revealCommand = exec.Command

// ErrInvalidScreenshotsDir is returned when the configured screenshots
// directory is empty, doesn't exist, or isn't a directory. Callers (the
// HTTP server in particular) map it to a 4xx response rather than 5xx
// because it reflects a client- or configuration-level problem, not an
// unexpected internal failure.
var ErrInvalidScreenshotsDir = errors.New("screenshots directory is not configured or unreadable")

// safePathChars accepts characters that legitimately appear in
// filesystem paths and Tesseract install locations, including
// real-world cases like `C:\Program Files (x86)\Tesseract-OCR\…`
// (parens, spaces) and usernames containing apostrophes or plus
// signs. Excludes shell metacharacters (`; | & $ < > * ? "` and
// backticks), NUL bytes, newlines, and other control codes — both
// because they signal abuse and because CodeQL's go/command-injection
// and go/path-injection rules recognize this regex-match pattern as a
// sanitizer on user-controlled paths flowing into exec.Command /
// os.Stat (alerts on PUT /api/v1/settings/tesseract and
// PUT /api/v1/settings/screenshots-folder).
var safePathChars = regexp.MustCompile(`^[\w./\\:\- ()+',]+$`)

func (a *App) GetScreenshotsDir() string {
	return a.settings.ScreenshotsDir
}

// SetScreenshotsDir updates the configured screenshots directory and
// persists the change. Used by the REST API in server mode AND by the
// Wails PickScreenshotsDir dialog flow — both transports go through
// this method so the validation rule + watcher-restart side-effect
// stay in one place.
//
// Returns ErrInvalidScreenshotsDir (possibly wrapped with the failing
// path) when path is empty, fails format validation, doesn't exist,
// or isn't a directory.
//
// Watcher behaviour: if the watcher is currently armed (WatchEnabled
// is true and startWatching has booted an fsnotify watcher), it gets
// restarted against the new dir. Without this, changing the dir
// while watching would leave fsnotify pointed at the old path —
// silent drift between user intent and actual behaviour. Both the
// Wails dialog flow and the server-mode HTTP path funnel through
// here so transports stay in parity.
func (a *App) SetScreenshotsDir(path string) error {
	cleaned, err := validateScreenshotsDir(path)
	if err != nil {
		return err
	}
	a.settings.ScreenshotsDir = cleaned
	if err := a.saveSettings(a.settings); err != nil {
		return err
	}
	if a.settings.WatchEnabled {
		a.stopWatching()
		a.startWatching()
	}
	return nil
}

// ResetScreenshotsDir clears the persisted screenshots folder and
// tears down the file watcher if it was armed. Symmetric with
// ResetTesseractPath, but the "default" state for screenshots is
// "no folder configured" rather than a platform default — the user
// uses Detect / Pick to choose one again.
//
// Persists the empty value so the next Startup loads "" (not the
// old configured path), and stops any armed watcher so we don't
// leak an fsnotify handle pointing at the now-orphaned dir.
func (a *App) ResetScreenshotsDir() error {
	a.settings.ScreenshotsDir = ""
	if err := a.saveSettings(a.settings); err != nil {
		return err
	}
	a.stopWatching()
	return nil
}

// RevealScreenshotsDir opens the configured screenshots folder in the
// host OS file manager. Replaces the Reveal button's old
// BrowserOpenURL('file://…') call which Wails v2.12 rejects with
// "scheme not allowed" (utils.ValidateAndSanitizeURL blocks file://).
//
// The path is the in-memory settings.ScreenshotsDir, re-validated via
// validateScreenshotsDir before reaching the shell so the cleaned
// form is what we exec — even though the value was already validated
// at write time, re-running the check here means a settings.json that
// got hand-edited to inject metacharacters can't sneak past the
// boundary.
//
// Per-platform opener:
//   - macOS:    `open <path>`     (Finder)
//   - Linux:    `xdg-open <path>` (whatever the desktop's default is)
//   - Windows:  `explorer <path>` (File Explorer)
//
// Returns ErrInvalidScreenshotsDir wrapped with the failing path when
// the configured folder doesn't pass validation, so HTTP handlers
// surface 400 instead of 500.
func (a *App) RevealScreenshotsDir() error {
	cleaned, err := validateScreenshotsDir(a.settings.ScreenshotsDir)
	if err != nil {
		return err
	}
	name, ok := revealOpenerForGOOS(runtime.GOOS)
	if !ok {
		return fmt.Errorf("reveal: unsupported platform %q", runtime.GOOS)
	}
	// #nosec G204 -- cleaned has already passed safePathChars +
	// filepath.Clean (validateScreenshotsDir above); name is a
	// hard-coded per-GOOS string from revealOpenerForGOOS, not user
	// input. The combination is what CodeQL's go/command-injection
	// rule recognizes as sanitized.
	cmd := revealCommand(name, cleaned)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("reveal: %s %q: %w", name, cleaned, err)
	}
	// Release the child without waiting — the opener forks the GUI
	// process and returns immediately; we'd block forever otherwise.
	go func() { _ = cmd.Wait() }()
	return nil
}

func revealOpenerForGOOS(goos string) (string, bool) {
	switch goos {
	case "darwin":
		return "open", true
	case "windows":
		return "explorer", true
	case "linux", "freebsd", "openbsd", "netbsd":
		return "xdg-open", true
	}
	return "", false
}

// validateScreenshotsDir confirms path is a real, readable directory and
// contains only filesystem-safe characters. Returns the sanitized path
// (cleaned of any redundant segments) so callers can use the validated
// value in subsequent file operations rather than the raw input. The
// regex match + `filepath.Clean` equality check together prevent path
// traversal (`..`) and shell-metacharacter injection.
//
// Called from both SetScreenshotsDir (reject bogus user/fuzzer input at
// write time) and ParseScreenshots (catch a dir that disappeared
// between configure and parse).
func validateScreenshotsDir(path string) (string, error) {
	if path == "" {
		return "", ErrInvalidScreenshotsDir
	}
	if !safePathChars.MatchString(path) {
		return "", fmt.Errorf("%w: %s: contains disallowed characters", ErrInvalidScreenshotsDir, path)
	}
	cleaned := filepath.Clean(path)
	if cleaned != path {
		return "", fmt.Errorf("%w: %s: path is not in canonical form", ErrInvalidScreenshotsDir, path)
	}
	info, err := os.Stat(cleaned)
	if err != nil {
		return "", fmt.Errorf("%w: %s: %v", ErrInvalidScreenshotsDir, cleaned, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%w: %s is not a directory", ErrInvalidScreenshotsDir, cleaned)
	}
	return cleaned, nil
}
