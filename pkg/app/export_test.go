package app

import (
	"encoding/json"
	"strings"
	"testing"

	"recall/pkg/db"
)

// TestExportImport_RoundTrip seeds a fakeStore with one row per parent
// type + a screenshots_dirs entry, calls ExportData, wipes the store
// via ImportData (which Clear()s first then re-Upserts), and asserts
// every row + the dirs FK round-tripped intact.
func TestExportImport_RoundTrip(t *testing.T) {
	fs := &fakeStore{}
	dirID, err := fs.EnsureScreenshotsDir("/test/screenshots")
	if err != nil {
		t.Fatal(err)
	}
	a := NewWithStore(fs)

	// Seed one row per parent table, all FK'd to the same dir.
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
	}))
	must(fs.UpsertPersonal(db.PersonalRow{
		Filename: "p.png", MatchKey: "match-1", ScreenshotsDirID: dirID, Hero: "lucio",
		HeroStats: []db.HeroStat{{Hero: "lucio", StatKey: "weapon_accuracy", StatValue: 35}},
	}))
	must(fs.UpsertRank(db.RankRow{
		Filename: "r.png", MatchKey: "match-1", ScreenshotsDirID: dirID,
		Rank: "platinum", Level: 3,
		SR: []db.HeroSR{{Hero: "lucio", SR: 2350, Change: 23}},
	}))
	must(fs.UpsertUnknown(db.UnknownRow{
		Filename: "u.png", MatchKey: "unmatched-u.png", ScreenshotsDirID: dirID,
	}))

	// Export.
	payload, err := a.ExportData()
	if err != nil {
		t.Fatalf("ExportData: %v", err)
	}
	if !strings.Contains(string(payload), `"schema": "recall-export/v1"`) {
		t.Errorf("export missing schema envelope: %s", string(payload[:200]))
	}

	// Import (round-trip) — Clear() runs as part of ImportData so we
	// can verify the same payload reproduces the same state.
	if err := a.ImportData(payload); err != nil {
		t.Fatalf("ImportData: %v", err)
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
			t.Errorf("post-import %s: got %d rows, want 1", c.name, c.n)
		}
	}
	// FK survived: the imported summary's dir id resolves back to the
	// original path via the screenshots_dirs map.
	postID := got.Summaries[0].ScreenshotsDirID
	if got.ScreenshotsDirs[postID] != "/test/screenshots" {
		t.Errorf("ScreenshotsDirs[%d] = %q, want /test/screenshots",
			postID, got.ScreenshotsDirs[postID])
	}
	if got.Summaries[0].Map != "rialto" {
		t.Errorf("summary map didn't round-trip: %+v", got.Summaries[0])
	}
}

func TestImport_RejectsUnknownSchema(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	bad := []byte(`{"schema":"recall-export/v999","data":{}}`)
	err := a.ImportData(bad)
	if err == nil {
		t.Fatal("expected schema-mismatch error, got nil")
	}
	if !strings.Contains(err.Error(), "unsupported schema") {
		t.Errorf("error should name the schema mismatch, got: %v", err)
	}
}

func TestImport_RejectsMalformedJSON(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	err := a.ImportData([]byte("{not json"))
	if err == nil {
		t.Fatal("expected decode error, got nil")
	}
	if !strings.Contains(err.Error(), "decode") {
		t.Errorf("error should mention decode failure, got: %v", err)
	}
}

func TestGetDataLocation_ReturnsPlatformPaths(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	loc := a.GetDataLocation()
	if loc.BaseDir == "" {
		t.Error("BaseDir should never be empty")
	}
	if loc.DatabasePath == "" || !strings.HasSuffix(loc.DatabasePath, "/db/recall.db") {
		t.Errorf("DatabasePath = %q, want non-empty ending in /db/recall.db", loc.DatabasePath)
	}
	if loc.SettingsPath == "" || !strings.HasSuffix(loc.SettingsPath, "settings.json") {
		t.Errorf("SettingsPath = %q, want non-empty ending in settings.json", loc.SettingsPath)
	}

	// Export-via-byte round-trip sanity — Marshal then Unmarshal a
	// DataLocation and confirm field names match what api.gen.d.ts
	// would expect (snake_case json tags).
	b, _ := json.Marshal(loc)
	if !strings.Contains(string(b), `"base_dir"`) {
		t.Errorf("expected snake_case base_dir in JSON, got: %s", b)
	}
	if !strings.Contains(string(b), `"database_path"`) {
		t.Errorf("expected snake_case database_path in JSON, got: %s", b)
	}
}
