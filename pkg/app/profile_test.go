package app_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"recall/pkg/app"
)

// LoadProfiles on a fresh base dir creates the default profile + writes
// profiles.json. The default name is "main" — matches the FEATURES.md
// wording ("main + alt accounts") and reads correctly to a user clicking
// the masthead chip on first launch.
func TestLoadProfiles_FreshInitCreatesDefaultProfile(t *testing.T) {
	base := t.TempDir()

	p, err := app.LoadProfiles(base)
	if err != nil {
		t.Fatalf("LoadProfiles: %v", err)
	}
	if got, want := p.Active(), "main"; got != want {
		t.Errorf("Active() = %q, want %q", got, want)
	}
	if got, want := p.List(), []string{"main"}; !reflect.DeepEqual(got, want) {
		t.Errorf("List() = %v, want %v", got, want)
	}
	mainDir := filepath.Join(base, "profiles", "main")
	if _, err := os.Stat(mainDir); err != nil {
		t.Errorf("expected %q to exist, got %v", mainDir, err)
	}
	if _, err := os.Stat(filepath.Join(base, "profiles.json")); err != nil {
		t.Errorf("expected profiles.json to be written, got %v", err)
	}
}

// LoadProfiles is idempotent — calling it twice on the same dir does
// not re-create or re-migrate anything.
func TestLoadProfiles_IdempotentSecondLoad(t *testing.T) {
	base := t.TempDir()
	if _, err := app.LoadProfiles(base); err != nil {
		t.Fatalf("first LoadProfiles: %v", err)
	}
	p, err := app.LoadProfiles(base)
	if err != nil {
		t.Fatalf("second LoadProfiles: %v", err)
	}
	if got := p.List(); !reflect.DeepEqual(got, []string{"main"}) {
		t.Errorf("List() = %v, want [main]", got)
	}
}

// Pinning the no-migration contract: any pre-existing settings.json
// or db/ at <base>/ from a hypothetical earlier layout MUST be left
// untouched. Per the user's request this is a no-migration cut-over —
// fresh installs only. Loading still succeeds (profiles/main/ stands
// up beside the stale files) but nothing moves.
func TestLoadProfiles_DoesNotMigratePreExistingLayout(t *testing.T) {
	base := t.TempDir()

	stalSettings := filepath.Join(base, "settings.json")
	if err := os.WriteFile(stalSettings, []byte(`{"prometheus_enabled":true}`), 0o600); err != nil {
		t.Fatalf("seed settings.json: %v", err)
	}
	staleDBDir := filepath.Join(base, "db")
	if err := os.MkdirAll(staleDBDir, 0o700); err != nil {
		t.Fatalf("seed db dir: %v", err)
	}

	if _, err := app.LoadProfiles(base); err != nil {
		t.Fatalf("LoadProfiles: %v", err)
	}

	// Stale files survive at the base — no migration ran.
	if _, err := os.Stat(stalSettings); err != nil {
		t.Errorf("base settings.json should be left in place, got %v", err)
	}
	if _, err := os.Stat(staleDBDir); err != nil {
		t.Errorf("base db/ should be left in place, got %v", err)
	}
	// And the active profile's directory exists but is fresh.
	mainSettings := filepath.Join(base, "profiles", "main", "settings.json")
	if _, err := os.Stat(mainSettings); !os.IsNotExist(err) {
		t.Errorf("profiles/main/settings.json should NOT have been copied; got %v", err)
	}
}

func TestProfiles_Create_AddsToListAndCreatesDir(t *testing.T) {
	base := t.TempDir()
	p, err := app.LoadProfiles(base)
	if err != nil {
		t.Fatalf("LoadProfiles: %v", err)
	}

	if err := p.Create("alt"); err != nil {
		t.Fatalf("Create: %v", err)
	}
	want := []string{"alt", "main"}
	if got := p.List(); !reflect.DeepEqual(got, want) {
		t.Errorf("List() = %v, want %v", got, want)
	}
	if p.Active() != "main" {
		t.Errorf("Create must not change Active; got %q", p.Active())
	}
	if _, err := os.Stat(filepath.Join(base, "profiles", "alt")); err != nil {
		t.Errorf("alt dir should be created: %v", err)
	}

	// Persistence — a fresh Load reads the new list.
	p2, err := app.LoadProfiles(base)
	if err != nil {
		t.Fatalf("re-LoadProfiles: %v", err)
	}
	if got := p2.List(); !reflect.DeepEqual(got, want) {
		t.Errorf("after re-Load: List() = %v, want %v", got, want)
	}
}

func TestProfiles_Activate_SwitchesAndPersists(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	_ = p.Create("alt")

	if err := p.Activate("alt"); err != nil {
		t.Fatalf("Activate: %v", err)
	}
	if got := p.Active(); got != "alt" {
		t.Errorf("Active() = %q, want %q", got, "alt")
	}

	// Persists across re-load.
	p2, _ := app.LoadProfiles(base)
	if got := p2.Active(); got != "alt" {
		t.Errorf("after re-Load: Active() = %q, want %q", got, "alt")
	}
}

func TestProfiles_Activate_UnknownReturnsNotFound(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	err := p.Activate("nope")
	if !errors.Is(err, app.ErrProfileNotFound) {
		t.Errorf("expected ErrProfileNotFound, got %v", err)
	}
}

func TestProfiles_Create_RejectsDuplicate(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	if err := p.Create("main"); !errors.Is(err, app.ErrProfileExists) {
		t.Errorf("expected ErrProfileExists, got %v", err)
	}
}

func TestProfiles_Create_RejectsInvalidNames(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	for _, name := range []string{
		"",              // empty
		".",             // traversal
		"..",            // traversal
		"foo/bar",       // path sep
		"foo\\bar",      // backslash
		"  spaces  ",    // not allowed
		"with space",    // not allowed
		"profile!",      // special
		"___underscore", // must start alphanumeric
		"this-name-is-way-too-long-to-be-allowed-as-a-profile-name", // > 40
	} {
		if err := p.Create(name); !errors.Is(err, app.ErrInvalidProfileName) {
			t.Errorf("Create(%q) = %v, want ErrInvalidProfileName", name, err)
		}
	}
}

func TestProfiles_Create_AcceptsValidNames(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	for _, name := range []string{
		"a",
		"alt",
		"alt-account",
		"alt_account",
		"Alt2",
		"smurf-2",
		"abcdefghij1234567890ABCDEFGHIJ1234567890", // exactly 40
	} {
		if err := p.Create(name); err != nil {
			t.Errorf("Create(%q) failed: %v", name, err)
		}
	}
}

func TestProfiles_Rename_UpdatesListAndDir(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	_ = p.Create("alt")

	if err := p.Rename("alt", "smurf"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	want := []string{"main", "smurf"}
	if got := p.List(); !reflect.DeepEqual(got, want) {
		t.Errorf("List() = %v, want %v", got, want)
	}
	// Old dir gone, new dir present.
	if _, err := os.Stat(filepath.Join(base, "profiles", "alt")); !os.IsNotExist(err) {
		t.Errorf("old alt dir should be gone, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(base, "profiles", "smurf")); err != nil {
		t.Errorf("new smurf dir should exist: %v", err)
	}
}

func TestProfiles_Rename_ActiveProfile(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	// Default "main" is active.

	if err := p.Rename("main", "silentstorm"); err != nil {
		t.Fatalf("Rename active: %v", err)
	}
	if got := p.Active(); got != "silentstorm" {
		t.Errorf("Active() = %q, want silentstorm (rename should follow)", got)
	}
	if got := p.List(); !reflect.DeepEqual(got, []string{"silentstorm"}) {
		t.Errorf("List() = %v, want [silentstorm]", got)
	}
}

func TestProfiles_Rename_PersistsAcrossReload(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	_ = p.Create("alt")
	_ = p.Rename("alt", "manny")

	p2, _ := app.LoadProfiles(base)
	if got := p2.List(); !reflect.DeepEqual(got, []string{"main", "manny"}) {
		t.Errorf("after reload: List() = %v, want [main manny]", got)
	}
}

func TestProfiles_Rename_RejectsInvalidNewName(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	_ = p.Create("alt")
	err := p.Rename("alt", "../traversal")
	if !errors.Is(err, app.ErrInvalidProfileName) {
		t.Errorf("expected ErrInvalidProfileName, got %v", err)
	}
}

func TestProfiles_Rename_RejectsUnknownSource(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	err := p.Rename("nope", "manny")
	if !errors.Is(err, app.ErrProfileNotFound) {
		t.Errorf("expected ErrProfileNotFound, got %v", err)
	}
}

func TestProfiles_Rename_RejectsCollisionWithExisting(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	_ = p.Create("alt")
	err := p.Rename("alt", "main") // main already exists
	if !errors.Is(err, app.ErrProfileExists) {
		t.Errorf("expected ErrProfileExists, got %v", err)
	}
}

func TestProfiles_Rename_NoOpWhenSameName(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	if err := p.Rename("main", "main"); err != nil {
		t.Errorf("rename to same name should be a no-op, got %v", err)
	}
	if got := p.List(); !reflect.DeepEqual(got, []string{"main"}) {
		t.Errorf("list mutated after no-op rename: %v", got)
	}
}

func TestProfiles_Delete_RefusesActive(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	if err := p.Delete("main"); !errors.Is(err, app.ErrProfileActive) {
		t.Errorf("expected ErrProfileActive, got %v", err)
	}
}

func TestProfiles_Delete_RemovesProfileAndDir(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	_ = p.Create("alt")
	altDir := filepath.Join(base, "profiles", "alt")
	// Seed a sub-file so we know the dir tree is wiped, not just the leaf.
	if err := os.WriteFile(filepath.Join(altDir, "settings.json"), []byte("{}"), 0o600); err != nil {
		t.Fatalf("seed sub-file: %v", err)
	}

	if err := p.Delete("alt"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if got := p.List(); !reflect.DeepEqual(got, []string{"main"}) {
		t.Errorf("List() after Delete = %v, want [main]", got)
	}
	if _, err := os.Stat(altDir); !os.IsNotExist(err) {
		t.Errorf("alt dir should be wiped, but %v", err)
	}
}

func TestProfiles_Delete_UnknownReturnsNotFound(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	err := p.Delete("nope")
	if !errors.Is(err, app.ErrProfileNotFound) {
		t.Errorf("expected ErrProfileNotFound, got %v", err)
	}
}

func TestProfiles_ProfileDir_IsNamespacedUnderBase(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	got := p.ProfileDir("alt")
	want := filepath.Join(base, "profiles", "alt")
	if got != want {
		t.Errorf("ProfileDir(alt) = %q, want %q", got, want)
	}
	if active := p.ActiveDir(); active != filepath.Join(base, "profiles", "main") {
		t.Errorf("ActiveDir() = %q, want %q", active, filepath.Join(base, "profiles", "main"))
	}
}

func TestProfiles_OnDiskShape(t *testing.T) {
	base := t.TempDir()
	p, _ := app.LoadProfiles(base)
	_ = p.Create("alt")
	_ = p.Activate("alt")

	raw, err := os.ReadFile(filepath.Join(base, "profiles.json"))
	if err != nil {
		t.Fatalf("read profiles.json: %v", err)
	}
	var got struct {
		Active   string   `json:"active_profile"`
		Profiles []string `json:"profiles"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal profiles.json: %v\n%s", err, raw)
	}
	if got.Active != "alt" {
		t.Errorf("active_profile = %q, want %q", got.Active, "alt")
	}
	if !reflect.DeepEqual(got.Profiles, []string{"alt", "main"}) {
		t.Errorf("profiles = %v, want [alt main]", got.Profiles)
	}
}
