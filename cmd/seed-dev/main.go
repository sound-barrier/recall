// cmd/seed-dev — populate a Recall SQLite profile with N synthetic
// matches so the UI can be exercised against a large corpus without
// parsing real screenshots.
//
// Usage:
//
//	go run ./cmd/seed-dev --n=300 --profile=demo
//	go run ./cmd/seed-dev --n=300 --profile=demo --force      # wipe + reseed
//	go run ./cmd/seed-dev --n=300 --profile=demo --seed=42    # reproducible
//	go run ./cmd/seed-dev --profile=demo --clear              # wipe, no reseed
//
// The fixture generation + write logic lives in pkg/app (fixtures.go +
// seed.go) so this tool and the in-app "create a sample test profile"
// handler share one source of truth. This dev binary never ships in a
// release: it's a separate main package compiled via `go run` from the
// `task seed-dev` Taskfile task.
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
	clearOnly := flag.Bool("clear", false, "wipe the target profile and exit (no seeding)")
	chaos := flag.Float64("chaos", 0, "fraction of matches to receive pathological data shapes (0..1, default 0)")
	style := flag.String("style", "flex", `player style: "flex" (default; every map+hero covered), "one-trick", "one-role", or "random" (per-seed style pick)`)
	flag.Parse()

	if !*clearOnly && *n <= 0 {
		exitf("--n must be positive (got %d); pass --clear to wipe without seeding", *n)
	}

	profiles, err := app.LoadProfiles(app.BaseDir())
	if err != nil {
		exitf("load profiles: %v", err)
	}

	target := *profile
	if target == "" {
		target = profiles.Active()
	}

	if *clearOnly {
		clearProfile(profiles, target)
		return
	}

	res, err := app.SeedProfile(profiles, target, app.SeedOptions{
		N: *n, Seed: *seed, Style: *style, Chaos: *chaos, Force: *force,
	})
	if err != nil {
		exitf("seed %q: %v", target, err)
	}
	if res.AlreadySeeded {
		exitf("profile %q already contains %d matches; pass --force to wipe and reseed (or --clear to wipe without re-seeding)", target, res.Matches)
	}

	dbPath := filepath.Join(profiles.ProfileDir(target), "db", "recall.db")
	fmt.Printf("seeded %d OCR matches (%d edited, %d hand-entered manual, %d reviewed, %d annotated, %d queue-tagged, %d play-mode-tagged, %d unknown, %d ambiguous, %d preview images) into profile %q at %s\n",
		res.Matches, res.Edited, res.Manual, res.Reviewed, res.Annotated, res.Queues, res.PlayModes, res.Unknowns, res.Ambiguous, res.Images, target, dbPath)
}

// clearProfile wipes a profile's database without reseeding.
func clearProfile(profiles *app.Profiles, target string) {
	if !slices.Contains(profiles.List(), target) {
		fmt.Printf("profile %q does not exist; nothing to clear\n", target)
		return
	}
	dbPath := filepath.Join(profiles.ProfileDir(target), "db", "recall.db")
	store, err := db.NewSQLStore(dbPath)
	if err != nil {
		exitf("open %s: %v", dbPath, err)
	}
	defer func() { _ = store.Close() }()

	snap, err := store.LoadAll()
	if err != nil {
		exitf("inspect existing rows: %v", err)
	}
	total := len(snap.Summaries) + len(snap.Teams) + len(snap.Personals) + len(snap.Ranks) + len(snap.Unknowns)
	if total == 0 {
		fmt.Printf("profile %q is already empty at %s\n", target, dbPath)
		return
	}
	if err := store.Clear(); err != nil {
		exitf("clear existing rows: %v", err)
	}
	fmt.Printf("cleared %d rows from profile %q at %s\n", total, target, dbPath)
}

func exitf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "seed-dev: "+format+"\n", args...)
	os.Exit(1)
}
