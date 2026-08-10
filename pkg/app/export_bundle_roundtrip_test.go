package app_test

import (
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/match"
)

// The two match keys the round-trip corpus carries: an OCR match with one of
// every user-layer surface, and a pure manual match whose data lives ONLY in
// the user layer.
const (
	roundTripEditedKey = "match-2026-05-10T22-00-00"
	roundTripManualKey = "match-2026-05-11T10-00-00"
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
	mustNoErr(t, err)
	t.Cleanup(func() { _ = store.Close() })
	a := app.NewWithStore(store)
	seedUserLayerCorpus(t, a, store)

	zipBytes, err := a.ExportBundle(app.ExportBundleOptions{MatchKeys: []string{roundTripEditedKey, roundTripManualKey}})
	mustNoErr(t, err)

	// The bundle must validate clean against its own manifest — pre-fix the
	// manifest counted the manual match while data.json shipped no rows for
	// it, so ValidateBundle flagged the exporter's own output.
	issues, err := app.ValidateBundle(zipBytes)
	mustNoErr(t, err)
	if len(issues) != 0 {
		t.Fatalf("bundle fails its own validator: %+v", issues)
	}

	mustNoErr(t, store.Clear())

	sum, err := a.ImportMatches(zipBytes)
	mustNoErr(t, err)
	if sum.Imported != 2 {
		t.Fatalf("Imported = %d, want 2 (the edited match + the manual match)", sum.Imported)
	}

	recs, err := a.GetMatchResults()
	mustNoErr(t, err)
	byKey := map[string]int{}
	for i, r := range recs {
		byKey[r.MatchKey] = i
	}

	ei, ok := byKey[roundTripEditedKey]
	if !ok {
		t.Fatalf("edited match missing after round trip; got %d records", len(recs))
	}
	assertEditedRoundTrip(t, recs[ei])

	mi, ok := byKey[roundTripManualKey]
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

// seedUserLayerCorpus writes the round-trip corpus: a real screenshots dir
// with the OCR match's file on disk, so the bundle embeds it and the manifest
// lists it (a missing file is pruned from the manifest while its row still
// ships — a validator axis this test doesn't target); the OCR match carrying
// one of every user-layer surface; and a pure manual match.
func seedUserLayerCorpus(t *testing.T, a *app.App, store db.Store) {
	t.Helper()
	shotsDir := t.TempDir()
	mustNoErr(t, os.WriteFile(filepath.Join(shotsDir, "a.png"), []byte("png"), 0o600))
	mustNoErr(t, a.SetScreenshotsDir(shotsDir))

	mustNoErr(t, store.UpsertSummary(db.SummaryRow{
		Filename: "a.png", MatchKey: roundTripEditedKey, Map: "rialto", Result: "victory",
	}))
	mapName := "dorado"
	mustNoErr(t, store.UpsertUserMatchData(db.UserMatchData{MatchKey: roundTripEditedKey, Map: &mapName}))
	mustNoErr(t, store.SetAnnotation(db.Annotation{MatchKey: roundTripEditedKey, Note: "clutch", Tags: []string{"stack"}}))
	mustNoErr(t, store.SetReview(roundTripEditedKey, "coach"))
	mustNoErr(t, store.SetMatchQueue(roundTripEditedKey, "role"))
	mustNoErr(t, store.SetMatchPlayMode(roundTripEditedKey, "competitive"))

	hero := "lucio"
	mustNoErr(t, store.UpsertUserMatchData(db.UserMatchData{MatchKey: roundTripManualKey, Map: &mapName, Hero: &hero}))
}

// assertEditedRoundTrip pins every user-layer surface on the re-imported
// OCR match.
func assertEditedRoundTrip(t *testing.T, er match.Record) {
	t.Helper()
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
}
