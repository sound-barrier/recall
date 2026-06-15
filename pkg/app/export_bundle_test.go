package app_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"recall/pkg/app"
	"recall/pkg/db"
)

// seedBundleFixture writes 3 matches across the fake store + populates
// a hidden one. The screenshots dir is a real tmpdir so ExportBundle
// can copy actual file bytes into the ZIP.
//
// Layout:
//
//	match-1 — normal, has a SUMMARY (s1.png) + TEAMS (sb1.png)
//	match-2 — normal, has a SUMMARY (s2.png) WITH no map (unknown)
//	match-3 — hidden, has a SUMMARY (s3.png)
//
// Returns the App, store, and the screenshots tmpdir for cleanup.
func seedBundleFixture(t *testing.T) (*app.App, *fakeStore, string) {
	t.Helper()
	dir := t.TempDir()
	// Real files so the bundle can copy them.
	for _, f := range []string{"s1.png", "sb1.png", "s2.png", "s3.png"} {
		if err := os.WriteFile(filepath.Join(dir, f), []byte("PNG-"+f), 0o600); err != nil {
			t.Fatalf("seed file: %v", err)
		}
	}

	fs := &fakeStore{}
	dirID, err := fs.EnsureScreenshotsDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	a := app.NewWithStore(fs)
	app.AppSettings(a).ScreenshotsDir = dir

	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	// match-1: full SUMMARY + TEAMS on rialto.
	must(fs.UpsertSummary(db.SummaryRow{
		Filename: "s1.png", MatchKey: "match-1", ScreenshotsDirID: dirID,
		Map: "rialto", Playlist: "competitive", Result: "victory", Hero: "lucio",
	}))
	must(fs.UpsertTeams(db.TeamsRow{
		Filename: "sb1.png", MatchKey: "match-1", ScreenshotsDirID: dirID,
		Eliminations: 17, Assists: 16, Deaths: 11,
	}))
	// match-2: SUMMARY with no map → aggregator tags as "unknown".
	must(fs.UpsertSummary(db.SummaryRow{
		Filename: "s2.png", MatchKey: "match-2", ScreenshotsDirID: dirID,
		Playlist: "competitive", Hero: "ana",
	}))
	// match-3: SUMMARY + hidden flag.
	must(fs.UpsertSummary(db.SummaryRow{
		Filename: "s3.png", MatchKey: "match-3", ScreenshotsDirID: dirID,
		Map: "hanamura", Playlist: "competitive", Hero: "kiriko",
	}))
	must(fs.HideMatch("match-3"))

	return a, fs, dir
}

// unzip reads `name` from the ZIP `data` and returns the bytes.
// Empty bytes + nil err means "not present in the ZIP."
func unzip(t *testing.T, data []byte, name string) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("unzip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %q: %v", name, err)
		}
		defer func() { _ = rc.Close() }()
		b, err := io.ReadAll(rc)
		if err != nil {
			t.Fatalf("read %q: %v", name, err)
		}
		return b
	}
	return nil
}

func zipNames(t *testing.T, data []byte) []string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("unzip: %v", err)
	}
	names := make([]string, 0, len(zr.File))
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	return names
}

// TestExportBundle_OnlySelectedMatchKeys includes exactly the keys the
// caller named, without picking up the unknown or hidden matches.
func TestExportBundle_OnlySelectedMatchKeys(t *testing.T) {
	a, _, _ := seedBundleFixture(t)
	payload, err := a.ExportBundle(app.ExportBundleOptions{
		MatchKeys: []string{"match-1"},
	})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}

	// Manifest schema + screenshot map.
	mb := unzip(t, payload, "manifest.json")
	if len(mb) == 0 {
		t.Fatal("manifest.json missing from bundle")
	}
	var m struct {
		Schema      string            `json:"schema"`
		MatchCount  int               `json:"match_count"`
		Screenshots map[string]string `json:"screenshots"`
	}
	if err := json.Unmarshal(mb, &m); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	if m.Schema != "recall-bundle/v1" {
		t.Errorf("schema = %q, want recall-bundle/v1", m.Schema)
	}
	if m.MatchCount != 1 {
		t.Errorf("match_count = %d, want 1", m.MatchCount)
	}
	if got := m.Screenshots["s1.png"]; got != "match-1" {
		t.Errorf("screenshots[s1.png] = %q, want match-1", got)
	}
	if _, ok := m.Screenshots["s2.png"]; ok {
		t.Errorf("unknown match's screenshot leaked into the bundle: s2.png")
	}
	if _, ok := m.Screenshots["s3.png"]; ok {
		t.Errorf("hidden match's screenshot leaked into the bundle: s3.png")
	}

	// data.json is the v1 export shape, filtered.
	db := unzip(t, payload, "data.json")
	if len(db) == 0 {
		t.Fatal("data.json missing from bundle")
	}
	if !strings.Contains(string(db), `"match-1"`) {
		t.Errorf("data.json should contain match-1: %s", string(db[:200]))
	}
	if strings.Contains(string(db), `"match-2"`) {
		t.Errorf("data.json should NOT contain unknown match-2")
	}

	// screenshots/ entries match exactly what the manifest declares.
	bytes := unzip(t, payload, "screenshots/s1.png")
	if string(bytes) != "PNG-s1.png" {
		t.Errorf("screenshots/s1.png = %q, want %q", string(bytes), "PNG-s1.png")
	}
	if unzip(t, payload, "screenshots/sb1.png") == nil {
		t.Errorf("screenshots/sb1.png missing")
	}
}

func TestExportBundle_IncludeUnknownAddsUnknownMatches(t *testing.T) {
	a, _, _ := seedBundleFixture(t)
	payload, err := a.ExportBundle(app.ExportBundleOptions{
		MatchKeys:      []string{"match-1"},
		IncludeUnknown: true,
	})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}
	names := zipNames(t, payload)
	wantContains := []string{
		"screenshots/s1.png",
		"screenshots/sb1.png",
		"screenshots/s2.png", // unknown match included via the toggle
	}
	for _, w := range wantContains {
		found := slices.Contains(names, w)
		if !found {
			t.Errorf("bundle missing %q; have %v", w, names)
		}
	}
}

func TestExportBundle_IncludeHiddenAddsHiddenMatches(t *testing.T) {
	a, _, _ := seedBundleFixture(t)
	payload, err := a.ExportBundle(app.ExportBundleOptions{
		MatchKeys:     []string{"match-1"},
		IncludeHidden: true,
	})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}
	mb := unzip(t, payload, "manifest.json")
	var m struct {
		Screenshots map[string]string `json:"screenshots"`
		MatchCount  int               `json:"match_count"`
	}
	_ = json.Unmarshal(mb, &m)
	if got := m.Screenshots["s3.png"]; got != "match-3" {
		t.Errorf("screenshots[s3.png] = %q, want match-3 (hidden match included)", got)
	}
	if m.MatchCount < 2 {
		t.Errorf("match_count = %d, want ≥ 2 (selected + hidden)", m.MatchCount)
	}
}

func TestExportBundle_EmptySelectionAndNoToggles_ProducesEmptyBundle(t *testing.T) {
	a, _, _ := seedBundleFixture(t)
	payload, err := a.ExportBundle(app.ExportBundleOptions{})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}
	mb := unzip(t, payload, "manifest.json")
	var m struct {
		MatchCount int `json:"match_count"`
	}
	_ = json.Unmarshal(mb, &m)
	if m.MatchCount != 0 {
		t.Errorf("match_count = %d, want 0 for empty selection", m.MatchCount)
	}
	for _, n := range zipNames(t, payload) {
		if strings.HasPrefix(n, "screenshots/") {
			t.Errorf("empty bundle should have no screenshots; saw %q", n)
		}
	}
}

func TestExportBundle_MissingScreenshotIsSkippedNotErrored(t *testing.T) {
	// A row whose on-disk file was deleted between parse and export
	// should be omitted from the ZIP without failing the whole bundle.
	a, fs, dir := seedBundleFixture(t)
	if err := os.Remove(filepath.Join(dir, "s1.png")); err != nil {
		t.Fatal(err)
	}
	_ = fs
	payload, err := a.ExportBundle(app.ExportBundleOptions{
		MatchKeys: []string{"match-1"},
	})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}
	if unzip(t, payload, "screenshots/s1.png") != nil {
		t.Errorf("deleted-on-disk file shouldn't appear in the bundle")
	}
	// The other half of the match (sb1.png) is still there, so the bundle isn't empty.
	if unzip(t, payload, "screenshots/sb1.png") == nil {
		t.Errorf("sibling screenshot was wrongly omitted")
	}
	// data.json still references match-1 even when no on-disk files made it.
	d := unzip(t, payload, "data.json")
	if !strings.Contains(string(d), `"match-1"`) {
		t.Errorf("data.json lost match-1 because of a missing file")
	}
}

// TestExportBundle_DataJSONOmitsScreenshotsDirs pins the
// PII-leak fix: data.json must NOT carry the user's local filesystem
// path map. Restore via POST /api/v1/imports remaps every row's
// ScreenshotsDirID to 0 (use configured dir) naturally.
func TestExportBundle_DataJSONOmitsScreenshotsDirs(t *testing.T) {
	a, _, _ := seedBundleFixture(t)
	payload, err := a.ExportBundle(app.ExportBundleOptions{
		MatchKeys: []string{"match-1"},
	})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}
	d := unzip(t, payload, "data.json")
	if bytes.Contains(d, []byte(`"screenshots_dirs"`)) {
		t.Errorf("data.json leaks screenshots_dirs path map:\n%s", string(d))
	}
}

// TestExportBundle_ZIPEntriesCarryCurrentTimestamp pins the
// "Jan 10 1980" file-modtime bug fix. Every entry in the bundle ZIP
// must carry a Modified value within a few seconds of `time.Now()`,
// not the MS-DOS epoch the default zip writer falls back to when
// no Modified field is set.
func TestExportBundle_ZIPEntriesCarryCurrentTimestamp(t *testing.T) {
	a, _, _ := seedBundleFixture(t)
	before := time.Now().Add(-2 * time.Second)
	payload, err := a.ExportBundle(app.ExportBundleOptions{
		MatchKeys: []string{"match-1"},
	})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}
	after := time.Now().Add(2 * time.Second)

	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		t.Fatalf("zip parse: %v", err)
	}
	if len(zr.File) == 0 {
		t.Fatal("bundle has no entries")
	}
	for _, f := range zr.File {
		mt := f.Modified
		// MS-DOS epoch is 1980-01-01 UTC; anything before 2025 is the
		// bug shape. Bound by `before..after` so the assertion stays
		// tight without flaking on clock skew.
		if mt.Before(before) || mt.After(after) {
			t.Errorf("entry %q has Modified=%v outside [%v, %v]", f.Name, mt, before, after)
		}
	}
}
