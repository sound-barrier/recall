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
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"image"
	"image/color"
	"image/png"
	"math"
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
	clear := flag.Bool("clear", false, "wipe the target profile and exit (no seeding)")
	chaos := flag.Float64("chaos", 0, "fraction of matches to receive pathological data shapes (0..1, default 0)")
	style := flag.String("style", "flex", `player style: "flex" (default; every map+hero covered), "one-trick", "one-role", or "random" (per-seed style pick)`)
	flag.Parse()

	if !*clear && *n <= 0 {
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
	existingTotal := len(snap.Summaries) + len(snap.Teams) + len(snap.Personals) + len(snap.Ranks) + len(snap.Unknowns)

	if *clear {
		if existingTotal == 0 {
			fmt.Printf("profile %q is already empty at %s\n", target, dbPath)
			return
		}
		if err := store.Clear(); err != nil {
			exitf("clear existing rows: %v", err)
		}
		fmt.Printf("cleared %d rows from profile %q at %s\n", existingTotal, target, dbPath)
		return
	}

	if existingTotal > 0 {
		if !*force {
			exitf("profile %q already contains %d rows; pass --force to wipe and reseed (or --clear to wipe without re-seeding)", target, existingTotal)
		}
		if err := store.Clear(); err != nil {
			exitf("clear existing rows: %v", err)
		}
		fmt.Fprintf(os.Stderr, "wiped %d existing rows from profile %q\n", existingTotal, target)
	}

	fx := app.GenerateMatchFixtureWithChaos(*n, *seed, *style, *chaos)

	for _, r := range fx.Summaries {
		if err := store.UpsertSummary(r); err != nil {
			exitf("UpsertSummary(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Teams {
		if err := store.UpsertTeams(r); err != nil {
			exitf("UpsertTeams(%s): %v", r.MatchKey, err)
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
	for _, r := range fx.Reviews {
		if err := store.SetReview(r.MatchKey, r.ReviewedBy); err != nil {
			exitf("SetReview(%s, %s): %v", r.MatchKey, r.ReviewedBy, err)
		}
	}
	for _, q := range fx.Queues {
		if err := store.SetMatchQueue(q.MatchKey, q.QueueType); err != nil {
			exitf("SetMatchQueue(%s, %s): %v", q.MatchKey, q.QueueType, err)
		}
	}
	for _, p := range fx.PlayModes {
		if err := store.SetMatchPlayMode(p.MatchKey, p.PlayMode); err != nil {
			exitf("SetMatchPlayMode(%s, %s): %v", p.MatchKey, p.PlayMode, err)
		}
	}
	for _, u := range fx.Unknowns {
		if err := store.UpsertUnknown(u); err != nil {
			exitf("UpsertUnknown(%s): %v", u.Filename, err)
		}
	}
	for _, a := range fx.Ambiguous {
		if err := store.ApplyAmbiguity(a.Filename, a.Candidates); err != nil {
			exitf("ApplyAmbiguity(%s): %v", a.Filename, err)
		}
	}

	// Companion images for the ambiguous resolution UI — without
	// actual files on disk under the configured screenshots dir, the
	// Unknown tab's preview slot AND the candidate-picker thumbnails
	// render missing-image placeholders. The DB rows alone don't
	// exercise the preview path. Generate images for:
	//   1. each ambiguous source file (the screenshot being resolved)
	//   2. every source file of each candidate match the ambiguous
	//      could be attached to (so the side-by-side preview pane
	//      shows real bytes when the user hovers a candidate)
	// Unknown rows stay file-less — their UX doesn't need a preview.
	if len(fx.Ambiguous) > 0 {
		ssDir := filepath.Join(profiles.ProfileDir(target), "screenshots")
		if err := os.MkdirAll(ssDir, 0o700); err != nil {
			exitf("mkdir %s: %v", ssDir, err)
		}
		filenames := previewFilenames(fx)
		for _, f := range filenames {
			path := filepath.Join(ssDir, f)
			if err := writeSolidColorPNG(path, f); err != nil {
				exitf("write %s: %v", path, err)
			}
		}
		// Convenience: if no screenshots dir is configured for this
		// profile yet, point settings.json at the seed dir so `make dev`
		// picks them up without manual configuration. Existing values
		// are left alone — the user may have wired a real OW captures
		// dir and we don't want to clobber that.
		if err := ensureScreenshotsDirConfigured(profiles.ProfileDir(target), ssDir); err != nil {
			exitf("ensure screenshots_dir configured: %v", err)
		}
		fmt.Fprintf(os.Stderr, "wrote %d preview images to %s\n", len(filenames), ssDir)
	}

	fmt.Printf("seeded %d matches (%d reviewed, %d queue-tagged, %d play-mode-tagged, %d unknown, %d ambiguous) into profile %q at %s\n",
		*n, len(fx.Reviews), len(fx.Queues), len(fx.PlayModes), len(fx.Unknowns), len(fx.Ambiguous), target, dbPath)
}

// writeSolidColorPNG writes a small (320x180) single-color PNG at path.
// The color is derived from a hash of the filename so the same name
// always produces the same fill across runs (handy for spotting drift)
// AND the candidate-thumbnail vs ambiguous-source previews stay
// visually distinct even when they share an ambiguous card. The full
// HSV hue circle keeps neighboring filenames clearly different.
func writeSolidColorPNG(path, filename string) error {
	const w, h = 320, 180
	r, g, b := hsvToRGB(hueFromName(filename), 0.7, 0.9)
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	c := color.RGBA{R: r, G: g, B: b, A: 0xFF}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	// #nosec G304 -- path is filepath.Join(<profile screenshots dir>, <generated fixture filename>); no user input, dev tool only.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return png.Encode(f, img)
}

// hueFromName maps a filename to an H value in [0, 360) via FNV-1a.
// FNV is fast, deterministic, and well-distributed enough for visual
// distinction at the handful-of-files scale we generate here.
func hueFromName(name string) float64 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(name))
	return float64(h.Sum32()%3600) / 10.0
}

// previewFilenames collects every screenshot filename that needs a
// companion PNG for the ambiguous resolution UI to render correctly:
// the ambiguous source files themselves (so the in-card preview slot
// shows the file being triaged), plus every source file of every
// candidate match an ambiguous could be attached to (so the
// side-by-side candidate preview pane renders real bytes). De-dupes
// + sorts for stable output across runs.
func previewFilenames(fx app.Fixture) []string {
	if len(fx.Ambiguous) == 0 {
		return nil
	}
	// Set of candidate match_keys we need to surface previews for.
	candidateKeys := make(map[string]bool)
	seen := make(map[string]bool)
	for _, a := range fx.Ambiguous {
		seen[a.Filename] = true // ambiguous source file itself
		for _, c := range a.Candidates {
			candidateKeys[c.MatchKey] = true
		}
	}
	// Add every source file of each candidate match. We don't know
	// which file the aggregator will pick as representative (it's
	// SourceFiles[0] after alphabetical sort), so generate all of
	// them — a handful per match, bounded by ambiguous*candidates*4.
	for _, r := range fx.Summaries {
		if candidateKeys[r.MatchKey] {
			seen[r.Filename] = true
		}
	}
	for _, r := range fx.Teams {
		if candidateKeys[r.MatchKey] {
			seen[r.Filename] = true
		}
	}
	for _, r := range fx.Personals {
		if candidateKeys[r.MatchKey] {
			seen[r.Filename] = true
		}
	}
	for _, r := range fx.Ranks {
		if candidateKeys[r.MatchKey] {
			seen[r.Filename] = true
		}
	}
	out := make([]string, 0, len(seen))
	for f := range seen {
		out = append(out, f)
	}
	slices.Sort(out)
	return out
}

// hsvToRGB converts H[0,360) S[0,1] V[0,1] to 8-bit RGB. Standard
// formula; only called for fixture image fills so no need for the
// extra precision of x/image/colornames or a third-party library.
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

// ensureScreenshotsDirConfigured reads the profile's settings.json,
// and if its screenshots_dir field is empty (first-run state), sets
// it to seedDir. Leaves any existing value untouched — the user may
// have a real OW captures dir wired up and we don't want to stomp it.
// Best-effort: a missing settings.json is created with the field set;
// a malformed one is left alone (the same forgiving stance the App
// takes when loading).
func ensureScreenshotsDirConfigured(profileDir, seedDir string) error {
	settingsPath := filepath.Join(profileDir, "settings.json")
	// #nosec G304 -- settingsPath is filepath.Join(<profile dir>, "settings.json"); no user input, dev tool only.
	raw, err := os.ReadFile(settingsPath)
	settings := map[string]any{}
	switch {
	case err == nil:
		// Malformed settings.json: leave it alone rather than
		// overwriting the user's data. The App's loader takes the same
		// "forgiving fall-through" stance. Surface no error — this is
		// best-effort convenience, not a hard requirement.
		if jsonErr := json.Unmarshal(raw, &settings); jsonErr != nil {
			fmt.Fprintf(os.Stderr, "seed-dev: settings.json at %s is malformed (%v); skipping screenshots_dir auto-config\n", settingsPath, jsonErr)
			//nolint:nilerr // intentional: convenience step that shouldn't fail the whole seed
			return nil
		}
	case os.IsNotExist(err):
		// fresh profile — fall through with empty map
	default:
		return err
	}
	if v, ok := settings["screenshots_dir"].(string); ok && v != "" {
		return nil // user configured it; don't clobber
	}
	settings["screenshots_dir"] = seedDir
	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(settingsPath, out, 0o600)
}

func exitf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "seed-dev: "+format+"\n", args...)
	os.Exit(1)
}
