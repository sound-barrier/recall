package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Tests use t.Setenv("HOME", …) to point os.UserHomeDir at a
// scratch tree under t.TempDir(). On linux UserHomeDir reads $HOME
// directly; on darwin/windows it does too as a first preference, so
// the same recipe works across all three targets.
//
// On Windows, os.UserHomeDir consults %USERPROFILE% first. We set
// both to be safe — extra env entries are harmless when not read.

func setHome(t *testing.T, home string) {
	t.Helper()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
}

func TestProbeScreenshotsDir_FindsFirstExistingCandidate(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)

	// Materialise whichever first-candidate path applies on this OS.
	tried := probeCandidates()
	if len(tried) == 0 {
		t.Skipf("no probe candidates on %s; nothing to assert", runtime.GOOS)
	}
	want := tried[0]
	if err := os.MkdirAll(want, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", want, err)
	}

	a := &App{}
	got := a.ProbeScreenshotsDir()
	if !got.Found {
		t.Fatalf("expected Found=true; tried=%v", got.Tried)
	}
	if got.Path != want {
		t.Fatalf("Path = %q; want %q", got.Path, want)
	}
	if len(got.Tried) == 0 {
		t.Fatalf("expected Tried to be populated even on success")
	}
}

func TestProbeScreenshotsDir_NoMatchReturnsTriedList(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)

	a := &App{}
	got := a.ProbeScreenshotsDir()
	if got.Found {
		t.Fatalf("expected Found=false on an empty home; got %+v", got)
	}
	if got.Path != "" {
		t.Fatalf("Path = %q; want empty", got.Path)
	}
	if len(got.Tried) == 0 && runtime.GOOS != "freebsd" && runtime.GOOS != "openbsd" {
		t.Fatalf("expected non-empty Tried list on %s", runtime.GOOS)
	}
	// Every tried path must be under the scratch HOME, never the real one.
	// `filepath.Rel(home, p)` returns ".."-prefixed paths when `p` escapes
	// `home`. A leading dot alone is fine — Linux candidates legitimately
	// start with .steam / .wine.
	for _, p := range got.Tried {
		if !filepath.IsAbs(p) {
			t.Errorf("tried path %q is not absolute", p)
		}
		rel, err := filepath.Rel(home, p)
		if err != nil || rel == "" || strings.HasPrefix(rel, "..") {
			t.Errorf("tried path %q is not under HOME=%s (rel=%q err=%v)", p, home, rel, err)
		}
	}
}

func TestAutoProbeOnFirstRun_AppliesWhenSettingIsEmpty(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)

	tried := probeCandidates()
	if len(tried) == 0 {
		t.Skipf("no probe candidates on %s", runtime.GOOS)
	}
	want := tried[0]
	if err := os.MkdirAll(want, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", want, err)
	}

	// Redirect settings writes into the scratch HOME so saveSettings
	// doesn't pollute the real ~/Library or ~/.config tree.
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))

	a := &App{}
	a.autoProbeOnFirstRun()
	if a.settings.ScreenshotsDir != want {
		t.Fatalf("settings.ScreenshotsDir = %q; want %q", a.settings.ScreenshotsDir, want)
	}
}

func TestAutoProbeOnFirstRun_NoOpWhenAlreadyConfigured(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)

	// Pre-populate; even if the probe would have found something,
	// the existing path must win.
	preset := filepath.Join(home, "existing")
	if err := os.MkdirAll(preset, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", preset, err)
	}
	tried := probeCandidates()
	if len(tried) > 0 {
		if err := os.MkdirAll(tried[0], 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", tried[0], err)
		}
	}

	a := &App{settings: Settings{ScreenshotsDir: preset}}
	a.autoProbeOnFirstRun()
	if a.settings.ScreenshotsDir != preset {
		t.Fatalf("settings.ScreenshotsDir overwrote preset: got %q want %q", a.settings.ScreenshotsDir, preset)
	}
}

func TestDirExists(t *testing.T) {
	tmp := t.TempDir()
	if !dirExists(tmp) {
		t.Errorf("dirExists(%q) = false; want true", tmp)
	}
	if dirExists(filepath.Join(tmp, "nope")) {
		t.Errorf("dirExists on missing path returned true")
	}
	// Files are not directories.
	f := filepath.Join(tmp, "file")
	if err := os.WriteFile(f, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if dirExists(f) {
		t.Errorf("dirExists on a file returned true")
	}
	if dirExists("") {
		t.Errorf("dirExists on empty returned true")
	}
}
