package app_test

import (
	"os"
	"path/filepath"
	"strings"
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

	// Chaos-free, exactly as the walkthrough seeds (SeedTestProfile).
	res, err := app.SeedProfile(p, "test", app.SeedOptions{N: 250, Seed: 8, Style: "flex"})
	if err != nil {
		t.Fatalf("SeedProfile: %v", err)
	}
	if res.AlreadySeeded {
		t.Fatal("AlreadySeeded = true on a fresh profile")
	}
	if res.Matches == 0 {
		t.Fatal("seeded 0 matches")
	}
	// The tour's Unknown + Ambiguous steps still get real targets WITHOUT chaos —
	// those rows come from the dedicated unknown/ambiguous fixtures in the base
	// generation, not from chaos garbage.
	if res.Unknowns == 0 || res.Ambiguous == 0 {
		t.Fatalf("want ≥1 unknown + ≥1 ambiguous, got unknowns=%d ambiguous=%d", res.Unknowns, res.Ambiguous)
	}
	// The demo marks up a realistic minority of matches with annotations
	// (notes/tags/friends' BattleTags/…).
	if res.Annotated == 0 {
		t.Fatal("seeded 0 annotations — the demo should mark up some matches")
	}

	// The profile was created and the rows actually persisted.
	if !app.ContainsProfile(p.List(), "test") {
		t.Fatalf("profile %q not in list %v", "test", p.List())
	}
	store := loadStore(t, p, "test")
	snap, err := store.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(snap.Summaries) != res.Matches {
		t.Fatalf("store has %d summaries, result reported %d", len(snap.Summaries), res.Matches)
	}
	// No chaos → only real OW heroes/maps reach the demo: no synthetic-hero-NN,
	// no 200-char strings, no zalgo/emoji map names.
	for _, s := range snap.Summaries {
		if strings.Contains(s.Hero, "synthetic") || len(s.Hero) > 60 {
			t.Errorf("garbage hero in chaos-free seed: %q", s.Hero)
		}
		if len(s.Map) > 60 {
			t.Errorf("garbage map in chaos-free seed: %q", s.Map)
		}
	}

	// Annotations actually round-trip to SQLite (not just counted in the result),
	// and the friends' BattleTags survive the member child-table write/read.
	anns, err := store.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations: %v", err)
	}
	if len(anns) != res.Annotated {
		t.Errorf("store persisted %d annotations, result reported %d", len(anns), res.Annotated)
	}
	var withMembers int
	for _, a := range anns {
		for _, m := range a.Members {
			if !strings.Contains(m, "#") {
				t.Errorf("persisted member %q is not a BattleTag (name#digits)", m)
			}
		}
		if len(a.Members) > 0 {
			withMembers++
		}
	}
	if withMembers == 0 {
		t.Error("no persisted annotation carries friends' BattleTags")
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
