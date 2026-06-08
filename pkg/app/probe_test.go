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

func TestFirstExistingCandidate_FindsFirstMatch(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)

	tried := probeCandidates()
	if len(tried) == 0 {
		t.Skipf("no probe candidates on %s; nothing to assert", runtime.GOOS)
	}
	want := tried[0]
	if err := os.MkdirAll(want, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", want, err)
	}

	got, ok := firstExistingCandidate()
	if !ok {
		t.Fatalf("expected ok=true; first candidate %q exists on disk", want)
	}
	if got != want {
		t.Fatalf("path = %q; want %q", got, want)
	}
}

func TestFirstExistingCandidate_EmptyHomeReturnsNotFound(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)

	_ = home
	got, ok := firstExistingCandidate()
	if ok {
		t.Fatalf("expected ok=false on an empty home; got path=%q", got)
	}
	if got != "" {
		t.Fatalf("path = %q; want empty", got)
	}
	// Sanity: probeCandidates produces an under-HOME list — defensive
	// check kept from the old test so a regression that points the
	// probe at the real user home still fails loudly.
	for _, p := range probeCandidates() {
		if !filepath.IsAbs(p) {
			t.Errorf("candidate %q is not absolute", p)
		}
		rel, err := filepath.Rel(home, p)
		if err != nil || rel == "" || strings.HasPrefix(rel, "..") {
			t.Errorf("candidate %q is not under HOME=%s (rel=%q err=%v)", p, home, rel, err)
		}
	}
}

func TestProbeScreenshotsCandidates_NonWindowsReturnsEmpty(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has its own assertion below")
	}
	a := &App{}
	got := a.ProbeScreenshotsCandidates()
	if len(got) != 0 {
		t.Errorf("non-Windows should return empty slice; got %+v", got)
	}
}

func TestProbeScreenshotsCandidates_WindowsReportsAllFour(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-only behaviour")
	}
	home := t.TempDir()
	setHome(t, home)

	// Materialise three of the four candidate paths so the test
	// exercises both "exists" and "not found" cards in one pass.
	// Steam stays absent (no registry shim in unit tests).
	must := func(p string) {
		t.Helper()
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", p, err)
		}
	}
	must(filepath.Join(home, "Videos", "Overwatch"))
	must(filepath.Join(home, "Documents", "Overwatch", "ScreenShots", "Overwatch"))
	must(filepath.Join(home, "Pictures", "Screenshots"))

	a := &App{}
	got := a.ProbeScreenshotsCandidates()
	if len(got) != 4 {
		t.Fatalf("want 4 cards on Windows; got %d (%+v)", len(got), got)
	}
	wantNames := []string{"nvidia", "prntscn", "snip", "steam"}
	for i, n := range wantNames {
		if got[i].Name != n {
			t.Errorf("card[%d].Name = %q; want %q", i, got[i].Name, n)
		}
	}
	if !got[0].Exists || !got[1].Exists || !got[2].Exists {
		t.Errorf("expected nvidia/prntscn/snip to be found; got exists=%v/%v/%v",
			got[0].Exists, got[1].Exists, got[2].Exists)
	}
	if got[3].Exists {
		t.Errorf("Steam should be absent in unit tests; got exists=true path=%q", got[3].Path)
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
