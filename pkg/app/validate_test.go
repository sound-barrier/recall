package app

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// validateTesseractPath is the boundary guard for the user-supplied path
// flowing into exec.Command (CodeQL alerts #1, #2, #3). These cases lock
// down both the happy paths the real installers produce and the inputs
// that previously would have reached the sink unchecked.
//
// filepath.IsAbs is OS-aware: `C:\...` only counts as absolute on
// Windows, and `/usr/...` only on POSIX, so the accept set is split by
// runtime.GOOS.
func TestValidateTesseractPath_Accepts(t *testing.T) {
	var cases []string
	if runtime.GOOS == "windows" {
		cases = []string{
			`C:\Program Files\Tesseract-OCR\tesseract.exe`,
			`C:\Program Files (x86)\Tesseract-OCR\tesseract.exe`,
		}
	} else {
		cases = []string{
			"/opt/homebrew/bin/tesseract",
			"/usr/local/bin/tesseract",
			"/usr/bin/tesseract",
		}
	}
	for _, in := range cases {
		t.Run(in, func(t *testing.T) {
			got, err := validateTesseractPath(in)
			if err != nil {
				t.Fatalf("expected accept, got error: %v", err)
			}
			if got != in {
				t.Errorf("path mutated unexpectedly: in=%q out=%q", in, got)
			}
		})
	}
}

func TestValidateTesseractPath_Rejects(t *testing.T) {
	cases := []struct {
		in  string
		why string
	}{
		{"", "empty"},
		{"tesseract", "not absolute"},
		{"/usr/bin/rm", "wrong basename"},
		{"/usr/bin/tesseract; rm -rf /", "shell metacharacter"},
		{"/usr/bin/`whoami`/tesseract", "backtick"},
		{"/usr/bin/$IFS/tesseract", "dollar"},
		{"/usr/bin/../bin/tesseract", "non-canonical"},
		{"/usr/bin/tesseract\x00.exe", "NUL byte"},
		// Embedded newline (not trailing — TrimSpace would strip a
		// trailing one before validation, which is fine).
		{"/usr/bin/te\nsseract", "embedded newline"},
	}
	for _, c := range cases {
		t.Run(c.why, func(t *testing.T) {
			if _, err := validateTesseractPath(c.in); err == nil {
				t.Fatalf("expected reject (%s), got accept for %q", c.why, c.in)
			} else if !errors.Is(err, ErrInvalidTesseractPath) {
				t.Errorf("error should wrap ErrInvalidTesseractPath, got %v", err)
			}
		})
	}
}

// validateScreenshotsDir is the boundary guard for the user-supplied dir
// flowing into os.Stat (CodeQL alert #4). The accepts case uses a real
// temp directory so the os.Stat check inside the validator passes too;
// the rejects cases never reach os.Stat because the format check trips first.
func TestValidateScreenshotsDir_AcceptsRealDir(t *testing.T) {
	dir := t.TempDir()
	got, err := validateScreenshotsDir(dir)
	if err != nil {
		t.Fatalf("expected accept for temp dir %q, got error: %v", dir, err)
	}
	// validateScreenshotsDir cleans the path; on macOS t.TempDir() may
	// return a /private/var/... or /var/folders/... path that's already
	// canonical, so the returned value should match Clean(dir).
	if got != filepath.Clean(dir) {
		t.Errorf("expected cleaned path %q, got %q", filepath.Clean(dir), got)
	}
}

func TestValidateScreenshotsDir_Rejects(t *testing.T) {
	// A real but non-directory path exposes the "is not a directory" branch.
	tmpFile, err := os.CreateTemp("", "validate-screenshots-*")
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	defer func() { _ = os.Remove(tmpFile.Name()) }()
	tmpFile.Close()

	cases := []struct {
		in  string
		why string
	}{
		{"", "empty"},
		{"; rm -rf /", "shell metacharacter"},
		{"/tmp/`whoami`", "backtick"},
		{"/tmp/$HOME", "dollar"},
		{"/this/path/should/not/exist/anywhere", "nonexistent"},
		{tmpFile.Name(), "exists but is a file"},
	}
	for _, c := range cases {
		t.Run(c.why, func(t *testing.T) {
			if _, err := validateScreenshotsDir(c.in); err == nil {
				t.Fatalf("expected reject (%s), got accept for %q", c.why, c.in)
			} else if !errors.Is(err, ErrInvalidScreenshotsDir) {
				t.Errorf("error should wrap ErrInvalidScreenshotsDir, got %v", err)
			}
		})
	}
}

func TestValidateScreenshotsDir_RejectsNonCanonical(t *testing.T) {
	// Build a non-canonical path that points at a real directory after
	// cleaning — the equality check should still reject it, since the
	// validator's contract is "return the canonical form, or fail."
	dir := t.TempDir()
	noisy := dir + "/."
	if runtime.GOOS == "windows" {
		noisy = dir + `\.`
	}
	if _, err := validateScreenshotsDir(noisy); err == nil {
		t.Fatalf("expected reject for non-canonical %q", noisy)
	}
}
