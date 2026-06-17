package app_test

import (
	"context"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
)

// The CSV-ZIP backup shares the JSON export's user-layer omission: a manual
// match + annotation + hidden flag live outside the OCR parent CSVs. Export
// (CSV) -> wipe -> import must round-trip them too.
func TestApp_ExportImportCSV_RoundTripsUserLayer(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.Startup(context.Background())

	const key = "match-2026-05-10T22-00-00"
	mapName, hero := "rialto", "lucio"
	if err := app.AppStore(a).UpsertUserMatchData(db.UserMatchData{MatchKey: key, Map: &mapName, Hero: &hero}); err != nil {
		t.Fatalf("seed user_match_data: %v", err)
	}
	if err := a.SetMatchAnnotation(app.AnnotationInput{MatchKey: key, Note: "great comeback"}); err != nil {
		t.Fatalf("seed annotation: %v", err)
	}
	if err := a.HideMatch(key); err != nil {
		t.Fatalf("seed hidden: %v", err)
	}

	payload, err := a.ExportDataCSV()
	if err != nil {
		t.Fatalf("ExportDataCSV: %v", err)
	}
	if err := a.ClearDatabase(false); err != nil {
		t.Fatalf("ClearDatabase: %v", err)
	}
	if err := a.ImportData(payload); err != nil { // sniffs ZIP -> importDataCSV
		t.Fatalf("ImportData(csv): %v", err)
	}

	recs, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(recs) != 1 || recs[0].MatchKey != key {
		t.Fatalf("matches = %+v, want 1 with key %s", recs, key)
	}
	if recs[0].Data.Map != "rialto" || recs[0].Data.Hero != "lucio" {
		t.Errorf("map/hero = %q/%q, want rialto/lucio", recs[0].Data.Map, recs[0].Data.Hero)
	}
	if !recs[0].Hidden {
		t.Errorf("Hidden = false, want true")
	}
	if recs[0].Annotation == nil || recs[0].Annotation.Note != "great comeback" {
		t.Errorf("Annotation = %+v, want note 'great comeback'", recs[0].Annotation)
	}
}
