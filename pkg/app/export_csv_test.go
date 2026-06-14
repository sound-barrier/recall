package app_test

import (
	"archive/zip"
	"bytes"
	"errors"
	"strings"
	"testing"

	"recall/pkg/app"
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
	a := app.NewWithStore(fs)

	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	must(fs.UpsertSummary(db.SummaryRow{
		Filename: "s.png", MatchKey: "match-1", ScreenshotsDirID: dirID,
		Map: "rialto", Playlist: "competitive", Hero: "lucio", Result: "victory",
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100, PlayTime: "09:32"}},
	}))
	must(fs.UpsertTeams(db.TeamsRow{
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
	if !app.LooksLikeZIP(payload) {
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
		"teams.csv", "teams_hero_stats.csv",
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
		{"teams", len(got.Teams)},
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
	a := app.NewWithStore(&fakeStore{})

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

	a := app.NewWithStore(&fakeStore{})
	err := a.ImportData(buf.Bytes())
	if err == nil || !strings.Contains(err.Error(), "unsupported schema") {
		t.Errorf("expected schema-version rejection, got: %v", err)
	}
}

// TestImportDataCSV_RejectsZipBomb confirms an archive entry whose
// DECOMPRESSED size exceeds *app.MaxZipEntryBytes is rejected as a
// malformed import (ErrImportMalformed → HTTP 400), rather than read
// fully into memory. The 50 MiB HTTP body cap bounds the COMPRESSED
// upload; this cap bounds the decompressed read so a high-ratio bomb
// can't OOM the process.
//
// Lowers the package cap to a tiny value (test-seam pattern) so the
// fixture stays small and fast under -race instead of generating a
// real 64 MiB+ entry.
func TestImportDataCSV_RejectsZipBomb(t *testing.T) {
	prev := *app.MaxZipEntryBytes
	*app.MaxZipEntryBytes = 1 << 10 // 1 KiB
	t.Cleanup(func() { *app.MaxZipEntryBytes = prev })

	// manifest.json is the first entry read (readZipFile), so an
	// oversized manifest exercises the cap before any schema parsing.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	mw, _ := zw.Create("manifest.json")
	// 2 KiB of a single repeated byte — compresses to almost nothing
	// in the archive but decompresses past the 1 KiB cap.
	_, _ = mw.Write(bytes.Repeat([]byte("A"), 2<<10))
	_ = zw.Close()

	a := app.NewWithStore(&fakeStore{})
	err := a.ImportData(buf.Bytes())
	if err == nil {
		t.Fatal("expected zip-bomb rejection, got nil")
	}
	if !errors.Is(err, app.ErrImportMalformed) {
		t.Errorf("expected ErrImportMalformed (→ HTTP 400), got: %v", err)
	}
	if !strings.Contains(err.Error(), "zip bomb") {
		t.Errorf("expected a zip-bomb message, got: %v", err)
	}
}
