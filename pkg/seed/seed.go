// Package seed writes synthetic corpora into a profile's SQLite store.
//
// Shared by the `seed-dev` CLI and the in-app "create a sample test
// profile" handler. The fixture GENERATION lives in pkg/fixtures; this
// package is the WRITE side — turn a fixtures.Fixture into rows in a
// profile's store plus the companion preview images the
// ambiguous-resolution UI needs.
package seed

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"recall/pkg/db"
	"recall/pkg/fixtures"
	"recall/pkg/profiles"
)

// Options parameterizes a seed run.
type Options struct {
	N     int     // number of synthetic matches
	Seed  int64   // deterministic fixture seed
	Style string  // player style: flex / one-trick / one-role / random
	Chaos float64 // fraction (0..1) given pathological shapes (unknown/ambiguous)
	Force bool    // wipe + reseed if the profile already holds data
}

// Result summarizes what a seed run produced (or found).
type Result struct {
	Profile       string
	Matches       int  // matches now in the profile
	AlreadySeeded bool // had data + Force was false → reused, not reseeded
	Reviewed      int
	Annotated     int // matches carrying a user annotation (note/tags/members/…)
	Queues        int
	PlayModes     int
	Unknowns      int
	Ambiguous     int
	Images        int
	Edited        int // OCR matches carrying a user override (→ ocr_edited)
	Manual        int // hand-entered matches with no screenshot rows (→ manual)
}

// Profile creates the named profile if absent, opens a TRANSIENT
// store at its db path (never the App's active store), and seeds it with
// opts.N synthetic matches over the rolling fixture window. If the
// profile already holds rows: with Force it wipes + reseeds; otherwise it
// returns the existing count with AlreadySeeded=true and writes nothing.
// Also writes companion PNG files for the ambiguous-resolution previews and
// points the profile's screenshots_dir at them (only when unset).
func Profile(p *profiles.Profiles, name string, opts Options) (Result, error) {
	if opts.N <= 0 {
		return Result{}, fmt.Errorf("seed: N must be positive (got %d)", opts.N)
	}
	if err := ensureProfileExists(p, name); err != nil {
		return Result{}, err
	}

	profileDir := p.ProfileDir(name)
	store, err := openSeedStore(profileDir)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = store.Close() }()

	kept, existingMatches, err := keepOrClearExisting(store, opts.Force)
	if err != nil {
		return Result{}, err
	}
	if kept {
		return Result{Profile: name, Matches: existingMatches, AlreadySeeded: true}, nil
	}

	fx := fixtures.GenerateMatchFixtureWithChaos(opts.N, opts.Seed, opts.Style, opts.Chaos)
	if err := writeFixture(store, fx); err != nil {
		return Result{}, err
	}

	images := 0
	if len(fx.Ambiguous) > 0 {
		images, err = writeAmbiguousPreviews(profileDir, fx)
		if err != nil {
			return Result{}, err
		}
	}

	edited, manual := countUserDataOrigins(fx)
	return Result{
		Profile:   name,
		Matches:   len(fx.Summaries),
		Reviewed:  len(fx.Reviews),
		Annotated: len(fx.Annotations),
		Queues:    len(fx.Queues),
		PlayModes: len(fx.PlayModes),
		Unknowns:  len(fx.Unknowns),
		Ambiguous: len(fx.Ambiguous),
		Images:    images,
		Edited:    edited,
		Manual:    manual,
	}, nil
}

// ensureProfileExists creates the named profile when it isn't known yet.
func ensureProfileExists(p *profiles.Profiles, name string) error {
	if slices.Contains(p.List(), name) {
		return nil
	}
	if err := p.Create(name); err != nil {
		return fmt.Errorf("create profile %q: %w", name, err)
	}
	return nil
}

// openSeedStore opens the profile's SQLite store (creating the db dir first).
// The caller owns the returned store and must Close it.
func openSeedStore(profileDir string) (*db.SQLStore, error) {
	dbDir := filepath.Join(profileDir, "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir %s: %w", dbDir, err)
	}
	store, err := db.NewSQLStore(filepath.Join(dbDir, "recall.db"))
	if err != nil {
		return nil, fmt.Errorf("open store: %w", err)
	}
	return store, nil
}

// keepOrClearExisting decides what happens to rows already in the store:
// without Force they're kept (kept=true plus the summary count for the
// AlreadySeeded result); with Force the store is wiped for reseeding.
func keepOrClearExisting(store db.Store, force bool) (kept bool, existingMatches int, err error) {
	snap, err := store.LoadAll()
	if err != nil {
		return false, 0, fmt.Errorf("inspect existing rows: %w", err)
	}
	existing := len(snap.Summaries) + len(snap.Teams) + len(snap.Personals) + len(snap.Ranks) + len(snap.Unknowns)
	if existing == 0 {
		return false, 0, nil
	}
	if !force {
		return true, len(snap.Summaries), nil
	}
	if err := store.Clear(); err != nil {
		return false, 0, fmt.Errorf("clear existing rows: %w", err)
	}
	return false, 0, nil
}

// countUserDataOrigins splits the fixture's user-data rows into OCR edits
// (the match also has screenshot rows) and manual entries (it doesn't).
func countUserDataOrigins(fx fixtures.Fixture) (edited, manual int) {
	ocrKeys := make(map[string]bool, len(fx.Summaries))
	for _, r := range fx.Summaries {
		ocrKeys[r.MatchKey] = true
	}
	for _, ud := range fx.UserData {
		if ocrKeys[ud.MatchKey] {
			edited++
		} else {
			manual++
		}
	}
	return edited, manual
}
