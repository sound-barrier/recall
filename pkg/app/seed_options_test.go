package app_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
)

// SeedOptions edge behavior: the input guard, the destructive Force path, and
// the "don't clobber the user's screenshots folder" rule.

func newSeedManager(t *testing.T) *app.Profiles {
	t.Helper()
	p, err := app.LoadProfiles(t.TempDir())
	mustNoErr(t, err)
	return p
}

// N is the only required option and the CLI passes it straight through from a
// flag. A zero or negative N must be refused up front — the fixture generator
// would otherwise produce an empty profile that then reads as "already seeded"
// on every later run.
func TestSeedProfile_RejectsNonPositiveN(t *testing.T) {
	p := newSeedManager(t)
	for _, n := range []int{0, -1} {
		res, err := app.SeedProfile(p, "test", app.SeedOptions{N: n, Seed: 8, Style: "flex"})
		if err == nil {
			t.Fatalf("N=%d accepted, got %+v", n, res)
		}
		if !strings.Contains(err.Error(), "seed: N must be positive") {
			t.Errorf("N=%d error = %q, want it to name the offending option", n, err)
		}
	}
	// The guard runs before the profile is created, so a bad N leaves no trace.
	if p.Contains("test") {
		t.Errorf("rejected seed still created the profile: %v", p.List())
	}
}

// Force is the destructive reseed: it must WIPE, not merge. A merge would leave
// two generations of fixtures interleaved and silently break every "the demo
// profile holds exactly the seeded corpus" assumption.
func TestSeedProfile_ForceWipesThePreviousCorpus(t *testing.T) {
	p := newSeedManager(t)
	first, err := app.SeedProfile(p, "test", app.SeedOptions{N: 20, Seed: 1, Style: "flex"})
	mustNoErr(t, err)
	before := summaryKeys(t, loadStore(t, p, "test"))

	second, err := app.SeedProfile(p, "test", app.SeedOptions{N: 8, Seed: 2, Style: "flex", Force: true})
	mustNoErr(t, err)
	if second.AlreadySeeded {
		t.Fatal("Force reported AlreadySeeded — it reused instead of reseeding")
	}
	if second.Matches >= first.Matches {
		t.Fatalf("reseed produced %d matches, want fewer than the original %d", second.Matches, first.Matches)
	}

	after := summaryKeys(t, loadStore(t, p, "test"))
	if len(after) != second.Matches {
		t.Errorf("store holds %d summaries, result reported %d", len(after), second.Matches)
	}
	for key := range before {
		if after[key] {
			t.Fatalf("match %q from the first seed survived the Force wipe", key)
		}
	}
}

func summaryKeys(t *testing.T, store db.Store) map[string]bool {
	t.Helper()
	snap, err := store.LoadAll()
	mustNoErr(t, err)
	keys := make(map[string]bool, len(snap.Summaries))
	for _, r := range snap.Summaries {
		keys[r.MatchKey] = true
	}
	return keys
}

// Seeding points the profile at its generated preview images so the
// ambiguous-resolution cards render — but only when the folder isn't already
// configured. Overwriting would silently redirect a real player's watched
// folder at a directory of synthetic PNG files.
func TestSeedProfile_OnlySetsScreenshotsDirWhenUnset(t *testing.T) {
	const configured = "/home/player/Pictures/Overwatch"
	cases := []struct {
		name    string
		profile string
		preset  string
		want    func(profileDir string) string
	}{
		{
			name:    "existing folder is left alone",
			profile: "configured",
			preset:  configured,
			want:    func(string) string { return configured },
		},
		{
			name:    "fresh profile is pointed at the seed images",
			profile: "fresh",
			want:    func(dir string) string { return filepath.Join(dir, "screenshots") },
		},
	}
	p := newSeedManager(t)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mustNoErr(t, p.Create(tc.profile))
			dir := p.ProfileDir(tc.profile)
			if tc.preset != "" {
				writeSettingsScreenshotsDir(t, dir, tc.preset)
			}
			res, err := app.SeedProfile(p, tc.profile, app.SeedOptions{N: 250, Seed: 8, Style: "flex"})
			mustNoErr(t, err)
			if res.Images == 0 {
				t.Fatal("no preview images written — the screenshots_dir step never ran")
			}
			if got := readSettingsScreenshotsDir(t, dir); got != tc.want(dir) {
				t.Errorf("screenshots_dir = %q, want %q", got, tc.want(dir))
			}
		})
	}
}

func writeSettingsScreenshotsDir(t *testing.T, profileDir, value string) {
	t.Helper()
	raw, err := json.Marshal(map[string]string{"screenshots_dir": value})
	mustNoErr(t, err)
	mustNoErr(t, os.WriteFile(filepath.Join(profileDir, "settings.json"), raw, 0o600))
}

func readSettingsScreenshotsDir(t *testing.T, profileDir string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(profileDir, "settings.json"))
	mustNoErr(t, err)
	var settings map[string]any
	mustNoErr(t, json.Unmarshal(raw, &settings))
	value, _ := settings["screenshots_dir"].(string)
	return value
}
