package seed

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"recall/pkg/db"
	"recall/pkg/fixtures"
)

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
