package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

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
// os.Stat (alerts on POST /api/tesseract-path and
// POST /api/screenshots-dir).
var safePathChars = regexp.MustCompile(`^[\w./\\:\- ()+',]+$`)

func (a *App) GetScreenshotsDir() string {
	return a.settings.ScreenshotsDir
}

// SetScreenshotsDir updates the configured screenshots directory and
// persists the change. Used by the REST API in server mode (replaces
// the native directory dialog). Returns ErrInvalidScreenshotsDir
// (possibly wrapped with the failing path) when path is empty, fails
// format validation, doesn't exist, or isn't a directory.
func (a *App) SetScreenshotsDir(path string) error {
	cleaned, err := validateScreenshotsDir(path)
	if err != nil {
		return err
	}
	a.settings.ScreenshotsDir = cleaned
	return saveSettings(a.settings)
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
