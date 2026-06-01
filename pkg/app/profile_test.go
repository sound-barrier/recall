package app

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// LoadProfiles on a fresh base dir creates the default profile + writes
// profiles.json. The default name is "main" — matches the FEATURES.md
// wording ("main + alt accounts") and reads correctly to a user clicking
// the masthead chip on first launch.
func TestLoadProfiles_FreshInitCreatesDefaultProfile(t *testing.T) {
	base := t.TempDir()

	p, err := LoadProfiles(base)
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
	if _, err := LoadProfiles(base); err != nil {
		t.Fatalf("first LoadProfiles: %v", err)
	}
	p, err := LoadProfiles(base)
	if err != nil {
		t.Fatalf("second LoadProfiles: %v", err)
	}
	if got := p.List(); !reflect.DeepEqual(got, []string{"main"}) {
		t.Errorf("List() = %v, want [main]", got)
	}
}

// Pre-profile installations had settings.json + db/recall.db sitting
// directly at the base dir. LoadProfiles must migrate that layout into
// profiles/main/ so the dev's local data survives an upgrade. The user
// said "no users besides myself" — this is for that user.
func TestLoadProfiles_MigratesPreProfileLayout(t *testing.T) {
	base := t.TempDir()

	settingsAt := filepath.Join(base, "settings.json")
	if err := os.WriteFile(settingsAt, []byte(`{"prometheus_enabled":true}`), 0o600); err != nil {
		t.Fatalf("seed settings.json: %v", err)
	}
	dbDir := filepath.Join(base, "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		t.Fatalf("seed db dir: %v", err)
	}
	dbAt := filepath.Join(dbDir, "recall.db")
	if err := os.WriteFile(dbAt, []byte("fake db bytes"), 0o600); err != nil {
		t.Fatalf("seed db file: %v", err)
	}

	p, err := LoadProfiles(base)
	if err != nil {
		t.Fatalf("LoadProfiles: %v", err)
	}
	if got := p.Active(); got != "main" {
		t.Errorf("Active() = %q, want %q", got, "main")
	}

	// Old paths gone.
	if _, err := os.Stat(settingsAt); !os.IsNotExist(err) {
		t.Errorf("old settings.json should be moved, but %v", err)
	}
	if _, err := os.Stat(dbDir); !os.IsNotExist(err) {
		t.Errorf("old db dir should be moved, but %v", err)
	}
	// New paths present + content preserved.
	movedSettings := filepath.Join(base, "profiles", "main", "settings.json")
	got, err := os.ReadFile(movedSettings)
	if err != nil {
		t.Fatalf("read migrated settings: %v", err)
	}
	if string(got) != `{"prometheus_enabled":true}` {
		t.Errorf("migrated settings content lost: %q", got)
	}
	movedDB, err := os.ReadFile(filepath.Join(base, "profiles", "main", "db", "recall.db"))
	if err != nil {
		t.Fatalf("read migrated db: %v", err)
	}
	if string(movedDB) != "fake db bytes" {
		t.Errorf("migrated db content lost: %q", movedDB)
	}
}

func TestProfiles_Create_AddsToListAndCreatesDir(t *testing.T) {
	base := t.TempDir()
	p, err := LoadProfiles(base)
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
	p2, err := LoadProfiles(base)
	if err != nil {
		t.Fatalf("re-LoadProfiles: %v", err)
	}
	if got := p2.List(); !reflect.DeepEqual(got, want) {
		t.Errorf("after re-Load: List() = %v, want %v", got, want)
	}
}

func TestProfiles_Activate_SwitchesAndPersists(t *testing.T) {
	base := t.TempDir()
	p, _ := LoadProfiles(base)
	_ = p.Create("alt")

	if err := p.Activate("alt"); err != nil {
		t.Fatalf("Activate: %v", err)
	}
	if got := p.Active(); got != "alt" {
		t.Errorf("Active() = %q, want %q", got, "alt")
	}

	// Persists across re-load.
	p2, _ := LoadProfiles(base)
	if got := p2.Active(); got != "alt" {
		t.Errorf("after re-Load: Active() = %q, want %q", got, "alt")
	}
}

func TestProfiles_Activate_UnknownReturnsNotFound(t *testing.T) {
	base := t.TempDir()
	p, _ := LoadProfiles(base)
	err := p.Activate("nope")
	if !errors.Is(err, ErrProfileNotFound) {
		t.Errorf("expected ErrProfileNotFound, got %v", err)
	}
}

func TestProfiles_Create_RejectsDuplicate(t *testing.T) {
	base := t.TempDir()
	p, _ := LoadProfiles(base)
	if err := p.Create("main"); !errors.Is(err, ErrProfileExists) {
		t.Errorf("expected ErrProfileExists, got %v", err)
	}
}

func TestProfiles_Create_RejectsInvalidNames(t *testing.T) {
	base := t.TempDir()
	p, _ := LoadProfiles(base)
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
		if err := p.Create(name); !errors.Is(err, ErrInvalidProfileName) {
			t.Errorf("Create(%q) = %v, want ErrInvalidProfileName", name, err)
		}
	}
}

func TestProfiles_Create_AcceptsValidNames(t *testing.T) {
	base := t.TempDir()
	p, _ := LoadProfiles(base)
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

func TestProfiles_Delete_RefusesActive(t *testing.T) {
	base := t.TempDir()
	p, _ := LoadProfiles(base)
	if err := p.Delete("main"); !errors.Is(err, ErrProfileActive) {
		t.Errorf("expected ErrProfileActive, got %v", err)
	}
}

func TestProfiles_Delete_RemovesProfileAndDir(t *testing.T) {
	base := t.TempDir()
	p, _ := LoadProfiles(base)
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
	p, _ := LoadProfiles(base)
	err := p.Delete("nope")
	if !errors.Is(err, ErrProfileNotFound) {
		t.Errorf("expected ErrProfileNotFound, got %v", err)
	}
}

func TestProfiles_ProfileDir_IsNamespacedUnderBase(t *testing.T) {
	base := t.TempDir()
	p, _ := LoadProfiles(base)
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
	p, _ := LoadProfiles(base)
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
