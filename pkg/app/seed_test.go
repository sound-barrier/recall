package app_test

import (
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
)

func loadStore(t *testing.T, p *app.Profiles, name string) db.Store {
	t.Helper()
	store, err := db.NewSQLStore(filepath.Join(p.ProfileDir(name), "db", "recall.db"))
	if err != nil {
		t.Fatalf("open %q store: %v", name, err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestSeedProfile_CreatesAndSeeds(t *testing.T) {
	p, err := app.LoadProfiles(t.TempDir())
	if err != nil {
		t.Fatalf("LoadProfiles: %v", err)
	}

	res, err := app.SeedProfile(p, "test", app.SeedOptions{N: 250, Seed: 8, Style: "flex", Chaos: 0.1})
	if err != nil {
		t.Fatalf("SeedProfile: %v", err)
	}
	if res.AlreadySeeded {
		t.Fatal("AlreadySeeded = true on a fresh profile")
	}
	if res.Matches == 0 {
		t.Fatal("seeded 0 matches")
	}
	// chaos=0.1 must yield a few of each so the tour's Unknown +
	// Ambiguous steps have real targets. (The rolling-date window itself
	// is verified in fixtures_test on clean, chaos-free generation —
	// chaos deliberately mutates some dates.)
	if res.Unknowns == 0 || res.Ambiguous == 0 {
		t.Fatalf("want ≥1 unknown + ≥1 ambiguous, got unknowns=%d ambiguous=%d", res.Unknowns, res.Ambiguous)
	}

	// The profile was created and the rows actually persisted.
	if !app.ContainsProfile(p.List(), "test") {
		t.Fatalf("profile %q not in list %v", "test", p.List())
	}
	snap, err := loadStore(t, p, "test").LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(snap.Summaries) != res.Matches {
		t.Fatalf("store has %d summaries, result reported %d", len(snap.Summaries), res.Matches)
	}
}

func TestSeedProfile_IdempotentReuse(t *testing.T) {
	p, err := app.LoadProfiles(t.TempDir())
	if err != nil {
		t.Fatalf("LoadProfiles: %v", err)
	}
	first, err := app.SeedProfile(p, "test", app.SeedOptions{N: 80, Seed: 8, Style: "flex"})
	if err != nil {
		t.Fatalf("first SeedProfile: %v", err)
	}

	// Second call without Force reuses the existing data untouched.
	second, err := app.SeedProfile(p, "test", app.SeedOptions{N: 80, Seed: 8, Style: "flex"})
	if err != nil {
		t.Fatalf("second SeedProfile: %v", err)
	}
	if !second.AlreadySeeded {
		t.Fatal("second seed: AlreadySeeded = false, expected reuse")
	}
	if second.Matches != first.Matches {
		t.Fatalf("reuse reported %d matches, original had %d", second.Matches, first.Matches)
	}
}

func TestSeedProfile_DoesNotTouchOtherProfiles(t *testing.T) {
	p, err := app.LoadProfiles(t.TempDir())
	if err != nil {
		t.Fatalf("LoadProfiles: %v", err)
	}
	// Fresh install has the default 'main' profile but no DB yet.
	if _, err := app.SeedProfile(p, "test", app.SeedOptions{N: 60, Seed: 8, Style: "flex"}); err != nil {
		t.Fatalf("SeedProfile: %v", err)
	}
	mainDB := filepath.Join(p.ProfileDir(app.DefaultProfileName), "db", "recall.db")
	if _, statErr := os.Stat(mainDB); !os.IsNotExist(statErr) {
		t.Fatalf("seeding 'test' created/touched %q's database (%s, stat err=%v)", app.DefaultProfileName, mainDB, statErr)
	}
}
