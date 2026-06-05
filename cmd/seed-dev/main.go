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
	existingTotal := len(snap.Summaries) + len(snap.Scoreboards) + len(snap.Personals) + len(snap.Ranks) + len(snap.Unknowns)

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

	// Companion images for ambiguous screenshots — without an actual
	// file on disk under the configured screenshots dir, the Unknown
	// tab's resolution UI renders a missing-image placeholder. The DB
	// rows alone don't exercise the preview/selection path. We only
	// generate images for ambiguous filenames (the user only needs to
	// eyeball those); unknown rows stay file-less since their UX
	// doesn't require a preview.
	if len(fx.Ambiguous) > 0 {
		ssDir := filepath.Join(profiles.ProfileDir(target), "screenshots")
		if err := os.MkdirAll(ssDir, 0o700); err != nil {
			exitf("mkdir %s: %v", ssDir, err)
		}
		for i, a := range fx.Ambiguous {
			path := filepath.Join(ssDir, a.Filename)
			if err := writeSolidColorPNG(path, i, len(fx.Ambiguous)); err != nil {
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
	}

	fmt.Printf("seeded %d matches (%d reviewed, %d queue-tagged, %d play-mode-tagged, %d unknown, %d ambiguous) into profile %q at %s\n",
		*n, len(fx.Reviews), len(fx.Queues), len(fx.PlayModes), len(fx.Unknowns), len(fx.Ambiguous), target, dbPath)
}

// writeSolidColorPNG writes a small (320x180) single-color PNG at path.
// The color is derived from idx by walking the HSV hue circle, so every
// ambiguous screenshot in a single seed batch gets a visually distinct
// fill — handy for eyeballing which row's preview is which in the
// resolution UI.
func writeSolidColorPNG(path string, idx, total int) error {
	const w, h = 320, 180
	hue := 0.0
	if total > 0 {
		hue = float64(idx) / float64(total) * 360.0
	}
	r, g, b := hsvToRGB(hue, 0.7, 0.9)
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
