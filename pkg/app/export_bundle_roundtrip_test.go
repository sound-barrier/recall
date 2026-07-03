package app_test

import (
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
)

// The export bundle's data.json must carry the user layer — inline edits,
// manual matches, annotations, review / queue / play-mode state — or an
// export→wipe→import round trip silently loses every hand-entered
// correction (and a pure manual match vanishes outright, while the
// manifest still counts it). Runs against the real SQLStore end-to-end:
// export → Clear → merge import → aggregate.
func TestExportBundle_RoundTripPreservesUserLayer(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	store, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	a := app.NewWithStore(store)

	// A real screenshots dir with the OCR match's file on disk, so the
	// bundle embeds it and the manifest lists it (a missing file is
	// pruned from the manifest while its row still ships — a validator
	// axis this test doesn't target).
	shotsDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(shotsDir, "a.png"), []byte("png"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := a.SetScreenshotsDir(shotsDir); err != nil {
		t.Fatal(err)
	}

	// An OCR match carrying one of every user-layer surface.
	const edited = "match-2026-05-10T22-00-00"
	if err := store.UpsertSummary(db.SummaryRow{
		Filename: "a.png", MatchKey: edited, Map: "rialto", Result: "victory",
	}); err != nil {
		t.Fatal(err)
	}
	mapName := "dorado"
	if err := store.UpsertUserMatchData(db.UserMatchData{MatchKey: edited, Map: &mapName}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetAnnotation(db.Annotation{MatchKey: edited, Note: "clutch", Tags: []string{"stack"}}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetReview(edited, "coach"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetMatchQueue(edited, "role"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetMatchPlayMode(edited, "competitive"); err != nil {
		t.Fatal(err)
	}

	// A pure manual match — its data lives ONLY in the user layer.
	const manual = "match-2026-05-11T10-00-00"
	hero := "lucio"
	if err := store.UpsertUserMatchData(db.UserMatchData{MatchKey: manual, Map: &mapName, Hero: &hero}); err != nil {
		t.Fatal(err)
	}

	zipBytes, err := a.ExportBundle(app.ExportBundleOptions{MatchKeys: []string{edited, manual}})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}

	// The bundle must validate clean against its own manifest — pre-fix the
	// manifest counted the manual match while data.json shipped no rows for
	// it, so ValidateBundle flagged the exporter's own output.
	issues, err := app.ValidateBundle(zipBytes)
	if err != nil {
		t.Fatalf("ValidateBundle: %v", err)
	}
	if len(issues) != 0 {
		t.Fatalf("bundle fails its own validator: %+v", issues)
	}

	if err := store.Clear(); err != nil {
		t.Fatal(err)
	}

	sum, err := a.ImportMatches(zipBytes)
	if err != nil {
		t.Fatalf("ImportMatches: %v", err)
	}
	if sum.Imported != 2 {
		t.Fatalf("Imported = %d, want 2 (the edited match + the manual match)", sum.Imported)
	}

	recs, err := a.GetMatchResults()
	if err != nil {
		t.Fatal(err)
	}
	byKey := map[string]int{}
	for i, r := range recs {
		byKey[r.MatchKey] = i
	}

	ei, ok := byKey[edited]
	if !ok {
		t.Fatalf("edited match missing after round trip; got %d records", len(recs))
	}
	er := recs[ei]
	if er.Data.Map != "dorado" {
		t.Errorf("edited map = %q, want the user override %q", er.Data.Map, "dorado")
	}
	if er.Source != "ocr_edited" {
		t.Errorf("edited source = %q, want ocr_edited", er.Source)
	}
	if er.Annotation == nil || er.Annotation.Note != "clutch" {
		t.Errorf("annotation = %+v, want note=clutch", er.Annotation)
	}
	if er.ReviewedBy != "coach" {
		t.Errorf("reviewed_by = %q, want coach", er.ReviewedBy)
	}
	if er.QueueType != "role" {
		t.Errorf("queue_type = %q, want role", er.QueueType)
	}
	if er.PlayMode != "competitive" {
		t.Errorf("play_mode = %q, want competitive", er.PlayMode)
	}

	mi, ok := byKey[manual]
	if !ok {
		t.Fatalf("manual match missing after round trip; got %d records", len(recs))
	}
	mr := recs[mi]
	if mr.Source != "manual" {
		t.Errorf("manual source = %q, want manual", mr.Source)
	}
	if mr.Data.Hero != "lucio" {
		t.Errorf("manual hero = %q, want lucio", mr.Data.Hero)
	}
}
