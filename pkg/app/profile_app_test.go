package app

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

// App-level profile methods — surface for the Wails IPC + HTTP routes.
// The manager (Profiles) was already tested in profile_test.go; here
// we lock the App's higher-level behaviour: GetProfiles returns both
// active + list as a single ergonomic shape, CreateProfile + activate,
// SwitchProfile tears down + re-initializes the store + settings,
// DeleteProfile refuses the active.

func TestApp_GetProfiles_ReturnsActiveAndList(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	got := a.GetProfiles()
	if got.Active != "main" {
		t.Errorf("Active = %q, want main", got.Active)
	}
	if len(got.Profiles) != 1 || got.Profiles[0] != "main" {
		t.Errorf("Profiles = %v, want [main]", got.Profiles)
	}
}

func TestApp_CreateProfile_AddsAndActivates(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	if err := a.CreateProfile("alt"); err != nil {
		t.Fatalf("CreateProfile: %v", err)
	}
	got := a.GetProfiles()
	if got.Active != "alt" {
		t.Errorf("after Create the new profile must be active; Active=%q", got.Active)
	}
	if len(got.Profiles) != 2 {
		t.Errorf("Profiles = %v, want 2 entries", got.Profiles)
	}
}

func TestApp_CreateProfile_RejectsInvalidName(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	err := a.CreateProfile("../traversal")
	if !errors.Is(err, ErrInvalidProfileName) {
		t.Errorf("expected ErrInvalidProfileName, got %v", err)
	}
}

func TestApp_CreateProfile_RejectsDuplicate(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	err := a.CreateProfile("main")
	if !errors.Is(err, ErrProfileExists) {
		t.Errorf("expected ErrProfileExists, got %v", err)
	}
}

func TestApp_SwitchProfile_ReinitializesStoreAndSettings(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	// Use the real SQL store, not the fake — we want to assert the
	// store is swapped to a new on-disk path after the switch.
	a := New()
	a.Startup(context.Background())

	// Set a distinctive screenshots dir on main so we can prove the
	// switch loaded a different profile's settings.
	mainDir := t.TempDir()
	if err := a.SetScreenshotsDir(mainDir); err != nil {
		t.Fatalf("SetScreenshotsDir on main: %v", err)
	}

	if err := a.CreateProfile("alt"); err != nil {
		t.Fatalf("CreateProfile alt: %v", err)
	}
	// CreateProfile already activated; verify settings are fresh
	// (alt is a brand new profile so its settings should be defaults
	// with no screenshots dir).
	if a.settings.ScreenshotsDir != "" {
		t.Errorf("after switching to alt, ScreenshotsDir = %q; want empty (fresh profile)", a.settings.ScreenshotsDir)
	}

	// And the store's underlying DB path moved to alt's dir.
	wantDB := filepath.Join(a.dataDir(), "db", "recall.db")
	if got := filepath.Join(a.dataDir(), "db", "recall.db"); got != wantDB {
		t.Errorf("dataDir didn't move; got %q", got)
	}

	// Switching back to main restores its settings.
	if err := a.SwitchProfile("main"); err != nil {
		t.Fatalf("SwitchProfile main: %v", err)
	}
	if a.settings.ScreenshotsDir != mainDir {
		t.Errorf("after switching back to main, ScreenshotsDir = %q; want %q (main's persisted value)", a.settings.ScreenshotsDir, mainDir)
	}
}

func TestApp_SwitchProfile_RejectsUnknown(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	err := a.SwitchProfile("nope")
	if !errors.Is(err, ErrProfileNotFound) {
		t.Errorf("expected ErrProfileNotFound, got %v", err)
	}
}

func TestApp_DeleteProfile_RefusesActive(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	err := a.DeleteProfile("main")
	if !errors.Is(err, ErrProfileActive) {
		t.Errorf("expected ErrProfileActive, got %v", err)
	}
}

func TestApp_ProfileOverride_CreatesAndActivatesAtStartup(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	// First launch: --profile=alt creates the profile on the way in
	// and switches to it for the rest of Startup. The persisted
	// profiles.json then records "alt" as active, so a second launch
	// without the flag resumes there.
	a := New()
	a.SetProfileOverride("alt")
	a.Startup(context.Background())

	if got := a.GetProfiles().Active; got != "alt" {
		t.Errorf("--profile override didn't take effect; active=%q want alt", got)
	}
	if got := a.GetProfiles().Profiles; len(got) != 2 {
		t.Errorf("expected default + alt = 2 profiles, got %v", got)
	}
}

func TestApp_ProfileOverride_ActivatesExistingProfileWithoutDuplicateCreate(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	// Seed: first launch creates alt.
	a1 := New()
	a1.SetProfileOverride("alt")
	a1.Startup(context.Background())
	// Second launch: --profile=main switches back; should NOT try to
	// re-create main (which already exists from the default-init).
	a2 := New()
	a2.SetProfileOverride("main")
	a2.Startup(context.Background())

	if got := a2.GetProfiles().Active; got != "main" {
		t.Errorf("second launch active=%q want main", got)
	}
	if got := a2.GetProfiles().Profiles; len(got) != 2 {
		t.Errorf("expected [alt main], got %v", got)
	}
}

func TestApp_DeleteProfile_RemovesNonActive(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := New()
	a.Startup(context.Background())

	if err := a.CreateProfile("alt"); err != nil {
		t.Fatalf("CreateProfile alt: %v", err)
	}
	// CreateProfile activates alt — switch back to main so we can
	// delete alt without violating ErrProfileActive.
	if err := a.SwitchProfile("main"); err != nil {
		t.Fatalf("SwitchProfile main: %v", err)
	}

	if err := a.DeleteProfile("alt"); err != nil {
		t.Fatalf("DeleteProfile alt: %v", err)
	}
	got := a.GetProfiles()
	if len(got.Profiles) != 1 || got.Profiles[0] != "main" {
		t.Errorf("Profiles after delete = %v, want [main]", got.Profiles)
	}
}
