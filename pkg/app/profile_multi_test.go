package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// Pinning tests for the multi-profile invariants the FEATURES.md item
// implies but that aren't obvious from the unit tests for individual
// methods. Two contracts worth locking:
//
//  1. There is no cap on the number of profiles — the user said
//     "3-5" but the implementation should not impose a hidden ceiling.
//  2. screenshots_dir is per-profile — settings.json lives under the
//     active profile's directory, so each profile's screenshots
//     folder configuration is independent.

func TestProfiles_AllowsArbitraryProfileCount(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	a := New()
	a.Startup(context.Background())

	// Create five named profiles in a row — matches the FEATURES.md
	// description ("3-5" alts is the realistic ceiling for the user's
	// own use case, but the type should accept far more before any
	// hidden cap kicks in).
	names := []string{"silentstorm", "jokester", "manny", "alt4", "alt5"}
	for _, name := range names {
		if err := a.CreateProfile(name); err != nil {
			t.Fatalf("CreateProfile(%q): %v", name, err)
		}
	}

	// CreateProfile activates each newly-created profile, so the
	// final active is the last one in the loop.
	got := a.GetProfiles()
	if got.Active != "alt5" {
		t.Errorf("active = %q, want alt5", got.Active)
	}
	// main + the 5 we just created.
	if len(got.Profiles) != 6 {
		t.Errorf("profile count = %d, want 6 (main + 5 alts)", len(got.Profiles))
	}
	// Sanity: every directory exists.
	for _, name := range append([]string{"main"}, names...) {
		dir := a.profiles.ProfileDir(name)
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			t.Errorf("profile dir for %q missing or not a dir: %v", name, err)
		}
	}
}

func TestProfiles_ScreenshotsDirIsPerProfile(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	a := New()
	a.Startup(context.Background())

	// Distinct on-disk dirs to assign to two profiles, so each
	// profile's screenshots configuration is provably independent
	// (not just both empty / both same).
	mainDir := t.TempDir()
	altDir := t.TempDir()

	// Configure main's screenshots dir.
	if err := a.SetScreenshotsDir(mainDir); err != nil {
		t.Fatalf("SetScreenshotsDir on main: %v", err)
	}

	// Create alt — CreateProfile activates it, so the next SetScreenshotsDir
	// writes to alt's settings.json (not main's).
	if err := a.CreateProfile("alt"); err != nil {
		t.Fatalf("CreateProfile alt: %v", err)
	}
	if err := a.SetScreenshotsDir(altDir); err != nil {
		t.Fatalf("SetScreenshotsDir on alt: %v", err)
	}

	// Switch back to main — its screenshots dir survives.
	if err := a.SwitchProfile("main"); err != nil {
		t.Fatalf("SwitchProfile main: %v", err)
	}
	if got := a.settings.ScreenshotsDir; got != mainDir {
		t.Errorf("main ScreenshotsDir after switch back = %q, want %q", got, mainDir)
	}

	// Switch to alt — its screenshots dir comes through.
	if err := a.SwitchProfile("alt"); err != nil {
		t.Fatalf("SwitchProfile alt: %v", err)
	}
	if got := a.settings.ScreenshotsDir; got != altDir {
		t.Errorf("alt ScreenshotsDir after switch = %q, want %q", got, altDir)
	}

	// And the on-disk shape matches: each profile's settings.json
	// is a sibling of the other, not a shared file.
	mainSettings := filepath.Join(a.profiles.ProfileDir("main"), "settings.json")
	altSettings := filepath.Join(a.profiles.ProfileDir("alt"), "settings.json")
	if _, err := os.Stat(mainSettings); err != nil {
		t.Errorf("main settings.json missing: %v", err)
	}
	if _, err := os.Stat(altSettings); err != nil {
		t.Errorf("alt settings.json missing: %v", err)
	}
}
