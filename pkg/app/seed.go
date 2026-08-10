package app

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"slices"

	"recall/pkg/db"
	"recall/pkg/fixtures"
)

// Synthetic-data seeding shared by the `seed-dev` CLI and the in-app
// "create a sample test profile" handler. The fixture GENERATION lives
// in fixtures.go; this file is the WRITE side — turn a fixtures.Fixture into rows
// in a profile's SQLite store plus the companion preview images the
// ambiguous-resolution UI needs.

// SeedOptions parameterizes a seed run.
type SeedOptions struct {
	N     int     // number of synthetic matches
	Seed  int64   // deterministic fixture seed
	Style string  // player style: flex / one-trick / one-role / random
	Chaos float64 // fraction (0..1) given pathological shapes (unknown/ambiguous)
	Force bool    // wipe + reseed if the profile already holds data
}

// SeedResult summarizes what a seed run produced (or found).
type SeedResult struct {
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

// SeedProfile creates the named profile if absent, opens a TRANSIENT
// store at its db path (never the App's active store), and seeds it with
// opts.N synthetic matches over the rolling fixture window. If the
// profile already holds rows: with Force it wipes + reseeds; otherwise it
// returns the existing count with AlreadySeeded=true and writes nothing.
// Also writes companion PNG files for the ambiguous-resolution previews and
// points the profile's screenshots_dir at them (only when unset).
func SeedProfile(p *Profiles, name string, opts SeedOptions) (SeedResult, error) {
	if opts.N <= 0 {
		return SeedResult{}, fmt.Errorf("seed: N must be positive (got %d)", opts.N)
	}
	if err := ensureProfileExists(p, name); err != nil {
		return SeedResult{}, err
	}

	profileDir := p.ProfileDir(name)
	store, err := openSeedStore(profileDir)
	if err != nil {
		return SeedResult{}, err
	}
	defer func() { _ = store.Close() }()

	kept, existingMatches, err := keepOrClearExisting(store, opts.Force)
	if err != nil {
		return SeedResult{}, err
	}
	if kept {
		return SeedResult{Profile: name, Matches: existingMatches, AlreadySeeded: true}, nil
	}

	fx := fixtures.GenerateMatchFixtureWithChaos(opts.N, opts.Seed, opts.Style, opts.Chaos)
	if err := writeFixture(store, fx); err != nil {
		return SeedResult{}, err
	}

	images := 0
	if len(fx.Ambiguous) > 0 {
		images, err = writeAmbiguousPreviews(profileDir, fx)
		if err != nil {
			return SeedResult{}, err
		}
	}

	edited, manual := countUserDataOrigins(fx)
	return SeedResult{
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
func ensureProfileExists(p *Profiles, name string) error {
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

// writeFixture persists every record kind in a fixtures.Fixture to the store.
// Each kind is one branch-free step over the shared writeAll loop, so adding a
// record kind is one more table entry.
func writeFixture(store db.Store, fx fixtures.Fixture) error {
	steps := []func() error{
		func() error {
			return writeAll("UpsertSummary", fx.Summaries,
				func(r db.SummaryRow) string { return r.MatchKey }, store.UpsertSummary)
		},
		func() error {
			return writeAll("UpsertTeams", fx.Teams,
				func(r db.TeamsRow) string { return r.MatchKey }, store.UpsertTeams)
		},
		func() error {
			return writeAll("UpsertPersonal", fx.Personals,
				func(r db.PersonalRow) string { return r.MatchKey }, store.UpsertPersonal)
		},
		func() error {
			return writeAll("UpsertRank", fx.Ranks,
				func(r db.RankRow) string { return r.MatchKey }, store.UpsertRank)
		},
		func() error {
			return writeAll("SetReview", fx.Reviews,
				func(r fixtures.ReviewSeed) string { return r.MatchKey },
				func(r fixtures.ReviewSeed) error { return store.SetReview(r.MatchKey, r.ReviewedBy) })
		},
		func() error {
			return writeAll("SetAnnotation", fx.Annotations,
				func(ann db.Annotation) string { return ann.MatchKey }, store.SetAnnotation)
		},
		func() error {
			return writeAll("SetMatchQueue", fx.Queues,
				func(q fixtures.QueueSeed) string { return q.MatchKey },
				func(q fixtures.QueueSeed) error { return store.SetMatchQueue(q.MatchKey, q.QueueType) })
		},
		func() error {
			return writeAll("SetMatchPlayMode", fx.PlayModes,
				func(pm fixtures.PlayModeSeed) string { return pm.MatchKey },
				func(pm fixtures.PlayModeSeed) error { return store.SetMatchPlayMode(pm.MatchKey, pm.PlayMode) })
		},
		func() error {
			return writeAll("UpsertUnknown", fx.Unknowns,
				func(u db.UnknownRow) string { return u.Filename }, store.UpsertUnknown)
		},
		func() error {
			return writeAll("ApplyAmbiguity", fx.Ambiguous,
				func(a fixtures.AmbiguousSeed) string { return a.Filename },
				func(a fixtures.AmbiguousSeed) error { return store.ApplyAmbiguity(a.Filename, a.Candidates) })
		},
		func() error {
			return writeAll("UpsertUserMatchData", fx.UserData,
				func(ud db.UserMatchData) string { return ud.MatchKey }, store.UpsertUserMatchData)
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return err
		}
	}
	return nil
}

// writeAll persists each record via write, wrapping the first failure with the
// store operation's name and the record's identity (match key or filename).
func writeAll[T any](op string, records []T, identity func(T) string, write func(T) error) error {
	for _, r := range records {
		if err := write(r); err != nil {
			return fmt.Errorf("%s(%s): %w", op, identity(r), err)
		}
	}
	return nil
}

// writeAmbiguousPreviews writes a solid-color companion PNG for every
// screenshot the ambiguous-resolution UI previews (the ambiguous source
// files + every source file of each candidate match), so the in-card
// preview + candidate thumbnails render real bytes instead of missing-
// image placeholders. Then points the profile's screenshots_dir at the
// seed dir if it isn't set yet. Returns the image count.
func writeAmbiguousPreviews(profileDir string, fx fixtures.Fixture) (int, error) {
	ssDir := filepath.Join(profileDir, "screenshots")
	if err := os.MkdirAll(ssDir, 0o700); err != nil {
		return 0, fmt.Errorf("mkdir %s: %w", ssDir, err)
	}
	filenames := ambiguousPreviewFilenames(fx)
	for _, f := range filenames {
		if err := writeSolidColorPNG(filepath.Join(ssDir, f), f); err != nil {
			return 0, fmt.Errorf("write %s: %w", f, err)
		}
	}
	if err := ensureScreenshotsDirConfigured(profileDir, ssDir); err != nil {
		return 0, fmt.Errorf("configure screenshots_dir: %w", err)
	}
	return len(filenames), nil
}

// ambiguousPreviewFilenames collects every screenshot filename that needs
// a companion PNG: the ambiguous source files plus every source file of
// each candidate match they could attach to. De-duped + sorted.
func ambiguousPreviewFilenames(fx fixtures.Fixture) []string {
	if len(fx.Ambiguous) == 0 {
		return nil
	}
	candidateKeys := make(map[string]bool)
	seen := make(map[string]bool)
	for _, a := range fx.Ambiguous {
		seen[a.Filename] = true
		for _, c := range a.Candidates {
			candidateKeys[c.MatchKey] = true
		}
	}
	markCandidateFiles(seen, candidateKeys, fx.Summaries,
		func(r db.SummaryRow) (string, string) { return r.MatchKey, r.Filename })
	markCandidateFiles(seen, candidateKeys, fx.Teams,
		func(r db.TeamsRow) (string, string) { return r.MatchKey, r.Filename })
	markCandidateFiles(seen, candidateKeys, fx.Personals,
		func(r db.PersonalRow) (string, string) { return r.MatchKey, r.Filename })
	markCandidateFiles(seen, candidateKeys, fx.Ranks,
		func(r db.RankRow) (string, string) { return r.MatchKey, r.Filename })
	out := make([]string, 0, len(seen))
	for f := range seen {
		out = append(out, f)
	}
	slices.Sort(out)
	return out
}

// markCandidateFiles adds each row's filename to seen when its match key is
// one of the ambiguity candidates. The identity closure lets one body serve
// all four screenshot-backed row kinds.
func markCandidateFiles[T any](seen, candidateKeys map[string]bool, rows []T, identity func(T) (matchKey, filename string)) {
	for _, r := range rows {
		if matchKey, filename := identity(r); candidateKeys[matchKey] {
			seen[filename] = true
		}
	}
}

// writeSolidColorPNG writes a small (320x180) single-color PNG. The color
// is derived from a hash of the filename so the same name always fills
// the same hue (visually distinct neighbors, stable across runs).
func writeSolidColorPNG(path, filename string) error {
	const w, h = 320, 180
	r, g, b := hsvToRGB(hueFromName(filename), 0.7, 0.9)
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	c := color.RGBA{R: r, G: g, B: b, A: 0xFF}
	for y := range h {
		for x := range w {
			img.Set(x, y, c)
		}
	}
	// #nosec G304 -- path is filepath.Join(<profile screenshots dir>, <generated fixture filename>); no external input.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return png.Encode(f, img)
}

// hueFromName maps a filename to an H value in [0, 360) via FNV-1a.
func hueFromName(name string) float64 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(name))
	return float64(h.Sum32()%3600) / 10.0
}

// hsvToRGB converts H[0,360) S[0,1] V[0,1] to 8-bit RGB.
func hsvToRGB(h, s, v float64) (uint8, uint8, uint8) {
	c := v * s
	x := c * (1 - math.Abs(math.Mod(h/60, 2)-1))
	m := v - c
	var rf, gf, bf float64
	switch {
	case h < 60:
		rf, gf, bf = c, x, 0
	case h < 120:
		rf, gf, bf = x, c, 0
	case h < 180:
		rf, gf, bf = 0, c, x
	case h < 240:
		rf, gf, bf = 0, x, c
	case h < 300:
		rf, gf, bf = x, 0, c
	default:
		rf, gf, bf = c, 0, x
	}
	return uint8((rf + m) * 255), uint8((gf + m) * 255), uint8((bf + m) * 255)
}

// ensureScreenshotsDirConfigured sets the profile's settings.json
// screenshots_dir to seedDir when it's empty (first-run state); leaves an
// existing value untouched. Best-effort: a malformed settings.json is
// left alone.
func ensureScreenshotsDirConfigured(profileDir, seedDir string) error {
	settingsPath := filepath.Join(profileDir, "settings.json")
	// #nosec G304 -- settingsPath is filepath.Join(<profile dir>, "settings.json"); no external input.
	raw, err := os.ReadFile(settingsPath)
	settings := map[string]any{}
	switch {
	case err == nil:
		if jsonErr := json.Unmarshal(raw, &settings); jsonErr != nil {
			//nolint:nilerr // intentional: convenience step that shouldn't fail the whole seed
			return nil
		}
	case os.IsNotExist(err):
		// fresh profile — empty map
	default:
		return err
	}
	if v, ok := settings["screenshots_dir"].(string); ok && v != "" {
		return nil
	}
	settings["screenshots_dir"] = seedDir
	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(settingsPath, out, 0o600)
}
