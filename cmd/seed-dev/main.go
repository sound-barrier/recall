// cmd/seed-dev — populate a Recall SQLite profile with N synthetic
// matches so the UI can be exercised against a large corpus without
// parsing real screenshots.
//
// Usage:
//
//	go run ./cmd/seed-dev --n=300 --profile=demo
//	go run ./cmd/seed-dev --n=300 --profile=demo --force      # wipe + reseed
//	go run ./cmd/seed-dev --n=300 --profile=demo --seed=42    # reproducible
//
// The fixture-generation logic lives in pkg/app/fixtures.go so tests
// and this tool share a single source of truth. The dev binary itself
// never ships in a release: it's a separate main package compiled via
// `go run` from the Makefile target `make seed-dev`.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"recall/pkg/app"
	"recall/pkg/db"
)

func main() {
	n := flag.Int("n", 100, "number of synthetic matches to insert")
	profile := flag.String("profile", "", "target profile name (empty → active)")
	seed := flag.Int64("seed", 1, "deterministic seed for fixture generation")
	force := flag.Bool("force", false, "wipe the target profile before seeding")
	flag.Parse()

	if *n <= 0 {
		exitf("--n must be positive (got %d)", *n)
	}

	profiles, err := app.LoadProfiles(app.BaseDir())
	if err != nil {
		exitf("load profiles: %v", err)
	}

	target := *profile
	if target == "" {
		target = profiles.Active()
	}

	if !slices.Contains(profiles.List(), target) {
		if err := profiles.Create(target); err != nil {
			exitf("create profile %q: %v", target, err)
		}
		fmt.Fprintf(os.Stderr, "created profile %q\n", target)
	}

	dbDir := filepath.Join(profiles.ProfileDir(target), "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		exitf("mkdir %s: %v", dbDir, err)
	}
	dbPath := filepath.Join(dbDir, "recall.db")

	store, err := db.NewSQLStore(dbPath)
	if err != nil {
		exitf("open %s: %v", dbPath, err)
	}
	defer func() { _ = store.Close() }()

	snap, err := store.LoadAll()
	if err != nil {
		exitf("inspect existing rows: %v", err)
	}
	existingTotal := len(snap.Summaries) + len(snap.Scoreboards) + len(snap.Personals) + len(snap.Ranks) + len(snap.Unknowns)
	if existingTotal > 0 {
		if !*force {
			exitf("profile %q already contains %d rows; pass --force to wipe and reseed", target, existingTotal)
		}
		if err := store.Clear(); err != nil {
			exitf("clear existing rows: %v", err)
		}
		fmt.Fprintf(os.Stderr, "wiped %d existing rows from profile %q\n", existingTotal, target)
	}

	fx := app.GenerateMatchFixture(*n, *seed)

	for _, r := range fx.Summaries {
		if err := store.UpsertSummary(r); err != nil {
			exitf("UpsertSummary(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Scoreboards {
		if err := store.UpsertScoreboard(r); err != nil {
			exitf("UpsertScoreboard(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Personals {
		if err := store.UpsertPersonal(r); err != nil {
			exitf("UpsertPersonal(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Ranks {
		if err := store.UpsertRank(r); err != nil {
			exitf("UpsertRank(%s): %v", r.MatchKey, err)
		}
	}

	fmt.Printf("seeded %d matches into profile %q at %s\n", *n, target, dbPath)
}

func exitf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "seed-dev: "+format+"\n", args...)
	os.Exit(1)
}
