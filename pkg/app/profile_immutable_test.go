package app_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"recall/pkg/app"
	"recall/pkg/match"
)

// The manager persists per-profile immutability and carries it through
// rename/delete. Exercised through the LoadProfiles alias.
func TestProfiles_Immutable_ManagerRoundTrip(t *testing.T) {
	base := t.TempDir()
	p, err := app.LoadProfiles(base)
	if err != nil {
		t.Fatalf("LoadProfiles: %v", err)
	}
	if err := p.Create("test"); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if p.IsImmutable("test") {
		t.Fatal("a fresh profile should be mutable")
	}
	if err := p.SetImmutable("test"); err != nil {
		t.Fatalf("SetImmutable: %v", err)
	}
	if !p.IsImmutable("test") {
		t.Error("SetImmutable did not take effect")
	}
	if err := p.SetImmutable("nope"); !errors.Is(err, app.ErrProfileNotFound) {
		t.Errorf("SetImmutable(unknown) = %v, want ErrProfileNotFound", err)
	}

	// Persists across a reload of the same base dir.
	p2, err := app.LoadProfiles(base)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !p2.IsImmutable("test") {
		t.Error("immutability did not persist across reload")
	}
	// Rename carries the flag; delete clears it.
	if err := p2.Rename("test", "sample"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if p2.IsImmutable("test") || !p2.IsImmutable("sample") {
		t.Error("Rename should carry immutability to the new name")
	}
	if err := p2.Delete("sample"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if p2.IsImmutable("sample") {
		t.Error("Delete should clear immutability")
	}
}

// The seeded "test" profile is read-only end to end: every corpus-mutating
// entry point rejects with ErrProfileImmutable, and a move INTO it is refused.
func TestApp_TestProfileRejectsMutations(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	a := app.NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	// Immutability is per-profile: on the default "main" (a normal profile) the
	// import guards never fire — users parse/import on their own profiles as
	// before. Only the seeded "test" profile is read-only.
	if err := a.StartParse(false); errors.Is(err, app.ErrProfileImmutable) {
		t.Fatal("StartParse on a normal profile must NOT be blocked as immutable")
	}

	if _, err := a.SeedTestProfile(); err != nil {
		t.Fatalf("SeedTestProfile: %v", err)
	}
	if got := a.GetProfiles(); !slices.Contains(got.Immutable, "test") {
		t.Fatalf("GetProfiles().Immutable = %v, want it to contain \"test\"", got.Immutable)
	}

	// A move INTO the immutable profile is refused from the (mutable) main.
	if err := a.MoveMatches([]string{"match-2026-01-01T00-00-00"}, "test"); !errors.Is(err, app.ErrProfileImmutable) {
		t.Errorf("MoveMatches(→test) = %v, want ErrProfileImmutable", err)
	}

	if err := a.SwitchProfile("test"); err != nil {
		t.Fatalf("SwitchProfile(test): %v", err)
	}

	// Every IMPORT-a-new-match entry point must reject while "test" is active.
	// (The guard fires before any input validation, so empty inputs are fine.)
	_, importErr := a.ImportMatches([]byte("{}"))
	_, manualErr := a.CreateManualMatch(match.ManualMatchInput{})
	blocked := map[string]error{
		"StartParse":        a.StartParse(false),
		"ParseScreenshots":  a.ParseScreenshots(),
		"ReParseAll":        a.ReParseAll(),
		"ImportMatches":     importErr,
		"RestoreDatabase":   a.RestoreDatabase([]byte("{}")),
		"CreateManualMatch": manualErr,
	}
	for name, err := range blocked {
		if !errors.Is(err, app.ErrProfileImmutable) {
			t.Errorf("%s on the read-only profile = %v, want ErrProfileImmutable", name, err)
		}
	}

	// Small edits — removing matches from the existing corpus — are NOT imports,
	// so they must NOT be blocked (the demo stays explorable).
	if err := a.HardDeleteMatch("match-2026-01-01T00-00-00"); errors.Is(err, app.ErrProfileImmutable) {
		t.Error("HardDeleteMatch should be allowed on the read-only sample (it's a removal, not an import)")
	}
	if err := a.ClearDatabase(false); errors.Is(err, app.ErrProfileImmutable) {
		t.Error("ClearDatabase should be allowed on the read-only sample (it's a removal, not an import)")
	}
}
