package app_test

import (
	"errors"
	"os"
	"testing"

	"recall/pkg/app"
)

func TestApp_ImportMatches_AddsNewSkipsExisting(t *testing.T) {
	a := newRealApp(t)
	seedSummary(t, a, "a.png", "match-A")
	seedSummary(t, a, "b.png", "match-B")

	bundle, err := a.ExportBundle(app.ExportBundleOptions{MatchKeys: []string{"match-A", "match-B"}})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}

	// Reset to a DB that already contains match-A only, then merge the
	// two-match bundle: A is skipped, B is added.
	if err := app.AppStore(a).Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	seedSummary(t, a, "a.png", "match-A")

	summary, err := a.ImportMatches(bundle)
	if err != nil {
		t.Fatalf("ImportMatches: %v", err)
	}
	if summary.Imported != 1 || summary.Skipped != 1 {
		t.Fatalf("summary = %+v, want {Imported:1, Skipped:1}", summary)
	}

	snap, err := app.AppStore(a).LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	keys := map[string]bool{}
	for _, r := range snap.Summaries {
		keys[r.MatchKey] = true
	}
	if !keys["match-A"] || !keys["match-B"] || len(keys) != 2 {
		t.Fatalf("after merge keys = %v, want {match-A, match-B}", keys)
	}
}

func TestApp_ImportMatches_DataOnly_NoScreenshotsWritten(t *testing.T) {
	a := newRealApp(t)
	seedSummary(t, a, "a.png", "match-A")
	bundle, err := a.ExportBundle(app.ExportBundleOptions{MatchKeys: []string{"match-A"}})
	if err != nil {
		t.Fatalf("ExportBundle: %v", err)
	}

	shotsDir := t.TempDir()
	if err := a.SetScreenshotsDir(shotsDir); err != nil {
		t.Fatalf("SetScreenshotsDir: %v", err)
	}
	if err := app.AppStore(a).Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}

	if _, err := a.ImportMatches(bundle); err != nil {
		t.Fatalf("ImportMatches: %v", err)
	}

	entries, err := os.ReadDir(shotsDir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("data-only import must not write screenshot files; found %d", len(entries))
	}
}

func TestApp_ImportMatches_RejectsNonBundle(t *testing.T) {
	a := newRealApp(t)
	_, err := a.ImportMatches([]byte("this is not a zip bundle"))
	if !errors.Is(err, app.ErrImportMalformed) {
		t.Fatalf("err = %v, want ErrImportMalformed", err)
	}
}
