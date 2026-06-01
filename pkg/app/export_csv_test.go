package app

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"recall/pkg/db"
)

// TestExportImportCSV_RoundTrip mirrors TestExportImport_RoundTrip but
// exercises the zip-of-CSVs path. Same fixture rows, same assertions,
// different container.
func TestExportImportCSV_RoundTrip(t *testing.T) {
	fs := &fakeStore{}
	dirID, err := fs.EnsureScreenshotsDir("/test/screenshots")
	if err != nil {
		t.Fatal(err)
	}
	a := NewWithStore(fs)

	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	must(fs.UpsertSummary(db.SummaryRow{
		Filename: "s.png", MatchKey: "match-1", ScreenshotsDirID: dirID,
		Map: "rialto", Mode: "competitive", Hero: "lucio", Result: "victory",
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100, PlayTime: "09:32"}},
	}))
	must(fs.UpsertScoreboard(db.ScoreboardRow{
		Filename: "sb.png", MatchKey: "match-1", ScreenshotsDirID: dirID,
		Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200,
		HeroStats: []db.HeroStat{{Hero: "lucio", StatKey: "weapon_accuracy", StatValue: 35}},
	}))
	must(fs.UpsertPersonal(db.PersonalRow{
		Filename: "p.png", MatchKey: "match-1", ScreenshotsDirID: dirID, Hero: "lucio",
		HeroStats: []db.HeroStat{{Hero: "lucio", StatKey: "weapon_accuracy", StatValue: 35}},
	}))
	must(fs.UpsertRank(db.RankRow{
		Filename: "r.png", MatchKey: "match-1", ScreenshotsDirID: dirID,
		Rank: "platinum", Level: 3,
		Modifiers: []string{"expected", "victory"},
		SR:        []db.HeroSR{{Hero: "lucio", SR: 2350, Change: 23}},
	}))
	must(fs.UpsertUnknown(db.UnknownRow{
		Filename: "u.png", MatchKey: "unmatched-u.png", ScreenshotsDirID: dirID,
	}))

	payload, err := a.ExportDataCSV()
	if err != nil {
		t.Fatalf("ExportDataCSV: %v", err)
	}
	// Sanity: payload IS a ZIP.
	if !looksLikeZIP(payload) {
		t.Fatalf("payload does not start with ZIP magic")
	}
	// Sanity: every expected file is in the archive.
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	wantFiles := []string{
		"manifest.json", "screenshots_dirs.csv",
		"summaries.csv", "summary_heroes_played.csv",
		"scoreboards.csv", "scoreboard_hero_stats.csv",
		"personals.csv", "personal_hero_stats.csv",
		"ranks.csv", "rank_modifiers.csv", "rank_sr.csv",
		"unknowns.csv",
	}
	seen := map[string]bool{}
	for _, f := range zr.File {
		seen[f.Name] = true
	}
	for _, n := range wantFiles {
		if !seen[n] {
			t.Errorf("archive missing %q", n)
		}
	}

	// Round-trip via the auto-detecting ImportData path.
	if err := a.ImportData(payload); err != nil {
		t.Fatalf("ImportData(zip): %v", err)
	}
	got, err := fs.LoadAll()
	if err != nil {
		t.Fatal(err)
	}
	checks := []struct {
		name string
		n    int
	}{
		{"summaries", len(got.Summaries)},
		{"scoreboards", len(got.Scoreboards)},
		{"personals", len(got.Personals)},
		{"ranks", len(got.Ranks)},
		{"unknowns", len(got.Unknowns)},
	}
	for _, c := range checks {
		if c.n != 1 {
			t.Errorf("post-import %s: got %d, want 1", c.name, c.n)
		}
	}
	if got.Summaries[0].Map != "rialto" {
		t.Errorf("summary map lost in CSV round-trip: %+v", got.Summaries[0])
	}
	if len(got.Summaries[0].HeroesPlayed) != 1 || got.Summaries[0].HeroesPlayed[0].Hero != "lucio" {
		t.Errorf("summary heroes_played not re-attached: %+v", got.Summaries[0].HeroesPlayed)
	}
	if len(got.Ranks[0].Modifiers) != 2 {
		t.Errorf("rank modifiers not re-attached: %+v", got.Ranks[0].Modifiers)
	}
	if len(got.Ranks[0].SR) != 1 || got.Ranks[0].SR[0].SR != 2350 {
		t.Errorf("rank SR not re-attached: %+v", got.Ranks[0].SR)
	}
	// FK survives the remap.
	postID := got.Summaries[0].ScreenshotsDirID
	if got.ScreenshotsDirs[postID] != "/test/screenshots" {
		t.Errorf("ScreenshotsDirs[%d] = %q, want /test/screenshots",
			postID, got.ScreenshotsDirs[postID])
	}
}

func TestImport_DetectsZIPVsJSON(t *testing.T) {
	a := NewWithStore(&fakeStore{})

	// Garbage that's neither — should error out clean.
	err := a.ImportData([]byte("not a backup at all"))
	if err == nil || !strings.Contains(err.Error(), "neither JSON nor a ZIP") {
		t.Errorf("expected neither-JSON-nor-ZIP error, got: %v", err)
	}

	// BOM-prefixed JSON should still be accepted.
	jsonWithBOM := append([]byte("\xef\xbb\xbf"), []byte(`{"schema":"recall-export/v1"}`)...)
	if err := a.ImportData(jsonWithBOM); err != nil {
		t.Errorf("BOM-prefixed JSON should import cleanly, got: %v", err)
	}
}

func TestImportDataCSV_RejectsUnknownSchema(t *testing.T) {
	// Build a fake zip with a manifest that has the wrong schema.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	mw, _ := zw.Create("manifest.json")
	_, _ = mw.Write([]byte(`{"schema":"recall-export/v999"}`))
	_ = zw.Close()

	a := NewWithStore(&fakeStore{})
	err := a.ImportData(buf.Bytes())
	if err == nil || !strings.Contains(err.Error(), "unsupported schema") {
		t.Errorf("expected schema-version rejection, got: %v", err)
	}
}
