package app

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"recall/pkg/parser"
)

// TesseractStatus describes whether the configured tesseract binary
// resolves to a working executable. The frontend renders the System
// Alert banner and the Engine setting state from this struct.
type TesseractStatus struct {
	Path      string `json:"path"`
	Found     bool   `json:"found"`
	Version   string `json:"version"`
	Supported bool   `json:"supported"`
	Error     string `json:"error"`
	Default   string `json:"default"`
}

// ErrInvalidTesseractPath is returned when a user-supplied path to the
// Tesseract binary fails format validation (empty, contains disallowed
// characters, not absolute, or wrong basename). Mapped to 400 by the
// HTTP layer for the same reason as ErrInvalidScreenshotsDir.
var ErrInvalidTesseractPath = errors.New("tesseract path is invalid")

// defaultTesseractPath returns the most likely on-disk install location
// for the current platform, falling through to whatever's on PATH and
// finally a bare "tesseract" hint. macOS prefers the Homebrew prefix
// (Apple Silicon first, then Intel). Linux prefers /usr/bin (the apt
// install location); Windows checks both Program Files variants.
func defaultTesseractPath() string {
	var candidates []string
	switch runtime.GOOS {
	case "darwin":
		candidates = []string{
			"/opt/homebrew/bin/tesseract",
			"/usr/local/bin/tesseract",
		}
	case "linux":
		candidates = []string{
			"/usr/bin/tesseract",
			"/usr/local/bin/tesseract",
		}
	case "windows":
		candidates = []string{
			`C:\Program Files\Tesseract-OCR\tesseract.exe`,
			`C:\Program Files (x86)\Tesseract-OCR\tesseract.exe`,
		}
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	if p, err := exec.LookPath("tesseract"); err == nil {
		return p
	}
	if len(candidates) > 0 {
		return candidates[0]
	}
	return "tesseract"
}

// checkTesseract runs `<path> --version` and parses the output. On
// success returns the version string (e.g. "5.4.1"); on failure
// populates the Error field with a human-readable explanation suitable
// for surfacing directly in the UI banner.
func checkTesseract(path string) TesseractStatus {
	s := TesseractStatus{Path: path, Default: defaultTesseractPath()}
	if path == "" {
		s.Error = "Tesseract path is empty — pick the binary in Settings → Engine."
		return s
	}
	cmd := exec.Command(path, "--version")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	parser.HideWindow(cmd) // no-op off Windows; suppresses console flash on Windows
	if err := cmd.Run(); err != nil {
		// Distinguish "file doesn't exist" from "ran but failed".
		if _, statErr := os.Stat(path); statErr != nil {
			s.Error = fmt.Sprintf("Nothing exists at %s. Install Tesseract or change the path in Settings → Engine.", path)
		} else {
			s.Error = fmt.Sprintf("Could not run %s: %v", path, err)
		}
		return s
	}
	version, supported, vErr := parseTesseractVersion(stdout.String(), stderr.String())
	if vErr != "" {
		s.Error = vErr
		return s
	}
	s.Found = true
	s.Version = version
	s.Supported = supported
	return s
}

// parseTesseractVersion extracts the version string from `tesseract --version`
// output. The binary writes its banner to stderr on most builds, stdout on
// others — both are concatenated to be channel-agnostic. Returns:
//   - version: the parsed version (e.g. "5.5.0")
//   - supported: true only for major version 5 (the parser was tuned against
//     it; 3.x and 4.x routinely misread the post-match UI font)
//   - msg: non-empty diagnostic when the output doesn't look like a Tesseract
//     banner. Empty when the parse succeeded.
//
// Splitting this out of checkTesseract makes the pure parsing testable
// without shelling out to a real binary.
func parseTesseractVersion(stdout, stderr string) (version string, supported bool, msg string) {
	output := stdout + stderr
	first := strings.TrimSpace(strings.SplitN(output, "\n", 2)[0])
	if !strings.HasPrefix(strings.ToLower(first), "tesseract") {
		return "", false, "Binary at that path doesn't identify as Tesseract: " + first
	}
	v := strings.TrimSpace(strings.TrimPrefix(first, "tesseract"))
	v = strings.TrimSpace(strings.TrimPrefix(v, "v"))
	// Only major version 5 is officially supported. 3.x and 4.x may produce
	// incorrect OCR output with the current parser logic.
	major := strings.SplitN(v, ".", 2)[0]
	return v, major == "5", ""
}

// GetTesseractStatus returns the cached result of the last detection
// run (refreshed on Startup + any path-changing call). Cheap — does not
// re-shell out to tesseract.
func (a *App) GetTesseractStatus() TesseractStatus {
	return a.tessStatus
}

// SetTesseractPath persists a user-typed or user-picked path, re-runs
// detection, and rewires the parser to use the new binary. The path is
// validated for shape (absolute, no shell metacharacters, basename must
// be `tesseract` or `tesseract.exe`) so the value reaching exec.Command
// downstream is sanitized — see validateTesseractPath. The returned
// status reflects the new state so the frontend can refresh the Engine
// row + System Alert without a follow-up call.
func (a *App) SetTesseractPath(path string) (TesseractStatus, error) {
	cleaned, err := validateTesseractPath(path)
	if err != nil {
		// Reflect the validation error in the status so the frontend's
		// System Alert banner shows what went wrong without an extra
		// round-trip — this mirrors how checkTesseract surfaces failures.
		a.tessStatus = TesseractStatus{
			Path:    strings.TrimSpace(path),
			Default: defaultTesseractPath(),
			Error:   err.Error(),
		}
		return a.tessStatus, err
	}
	a.settings.TesseractPath = cleaned
	if err := saveSettings(a.settings); err != nil {
		return a.tessStatus, err
	}
	a.tessStatus = checkTesseract(cleaned)
	parser.SetTesseractPath(cleaned)
	return a.tessStatus, nil
}

// ResetTesseractPath restores the platform default and re-validates.
// The default path is produced internally by defaultTesseractPath() and
// is therefore trusted — we bypass validateTesseractPath here so that
// unusual platforms where the fallback is the bare command "tesseract"
// (non-absolute) still flow through to checkTesseract, which will
// surface a clean "not found" error to the UI.
func (a *App) ResetTesseractPath() (TesseractStatus, error) {
	path := defaultTesseractPath()
	a.settings.TesseractPath = path
	if err := saveSettings(a.settings); err != nil {
		return a.tessStatus, err
	}
	a.tessStatus = checkTesseract(path)
	parser.SetTesseractPath(path)
	return a.tessStatus, nil
}

// validateTesseractPath enforces a strict shape on the user-supplied
// path to the Tesseract binary: only filesystem-safe characters, in
// canonical form, absolute, with basename `tesseract` or `tesseract.exe`.
// Returns the sanitized path; callers must use the returned value rather
// than the raw input for downstream exec.Command / os.Stat calls so the
// sanitized form is what reaches the syscall.
//
// The basename restriction prevents the endpoint from being abused to
// execute arbitrary binaries — `PUT /api/v1/settings/tesseract` was the
// path CodeQL flagged as a command-injection sink, and pinning the
// basename reduces the attack surface to "swap which Tesseract is used."
func validateTesseractPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("%w: path is empty", ErrInvalidTesseractPath)
	}
	if !safePathChars.MatchString(path) {
		return "", fmt.Errorf("%w: %s: contains disallowed characters", ErrInvalidTesseractPath, path)
	}
	cleaned := filepath.Clean(path)
	if cleaned != path {
		return "", fmt.Errorf("%w: %s: path is not in canonical form", ErrInvalidTesseractPath, path)
	}
	if !filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("%w: %s: must be an absolute path", ErrInvalidTesseractPath, path)
	}
	base := filepath.Base(cleaned)
	if base != "tesseract" && base != "tesseract.exe" {
		return "", fmt.Errorf("%w: %s: basename must be 'tesseract' or 'tesseract.exe'", ErrInvalidTesseractPath, path)
	}
	return cleaned, nil
}
