package app_test

import (
	"testing"

	"recall/pkg/parser"
)

// The career HISTORY list is not a match screen. It must be recorded into the
// recognized-skip registry — no failed-ledger row (it used to park there as
// "expected 6 stat columns, found 0"), no Unknown row, no match data.
func TestApp_ParseScreenshots_HistoryRecognizedNotStoredNotFailed(t *testing.T) {
	a, fake := newParseReadyApp(t)
	const filename = "Overwatch 2 Screenshot 2026.08.08 - 22.59.11.63.png"
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, filename, &parser.MatchResult{HistoryScreen: true}, nil)
		return nil
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}

	recognized, _ := fake.LoadHistoryFilenames()
	if !recognized[filename] {
		t.Errorf("history filename not recorded in the skip registry; got=%v", recognized)
	}
	if failed, _ := fake.ListFailedFiles(); len(failed) != 0 {
		t.Errorf("a recognized history list must not be a failure, got %+v", failed)
	}
	if len(fake.Unknowns) != 0 {
		t.Errorf("history must not be stored as unknown, got %d unknown rows", len(fake.Unknowns))
	}
	if n := len(fake.Summaries) + len(fake.Teams) + len(fake.Personals) + len(fake.Ranks); n != 0 {
		t.Errorf("history must not create any match-data row, got %d", n)
	}
}

// A recognized history file is skipped on the next normal run, so Tesseract
// never re-examines it.
func TestApp_ParseScreenshots_SkipsRecognizedHistory(t *testing.T) {
	a, fake := newParseReadyApp(t)
	const filename = "recognized-history.png"
	if err := fake.UpsertHistoryScreenshot(filename); err != nil {
		t.Fatalf("seed UpsertHistoryScreenshot: %v", err)
	}

	var gotSkip map[string]bool
	stubParseCapturingSkip(t, &gotSkip)

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if !gotSkip[filename] {
		t.Errorf("recognized history file not in next-run skip set; got=%v", gotSkip)
	}
}

// Before the history probe existed, a history list could land on the Unknown
// tab by pixel accident. Recognizing it on Re-parse All must take that row
// away — unlike All-Heroes, whose registry entry never evicts a typed row,
// because a stale Unknown row would keep the screen in the triage tab forever.
func TestApp_ReParseAll_HistoryEvictsItsStaleUnknownRow(t *testing.T) {
	a, fake := newParseReadyApp(t)
	const filename = "ScreenShot_26-06-07_22-59-52-000.jpg"
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, filename, &parser.MatchResult{}, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("first ParseScreenshots: %v", err)
	}
	if len(fake.Unknowns) != 1 {
		t.Fatalf("precondition: an empty parse stores an Unknown row, got %d", len(fake.Unknowns))
	}

	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, filename, &parser.MatchResult{HistoryScreen: true}, nil)
		return nil
	})
	if err := a.ReParseAll(); err != nil {
		t.Fatalf("ReParseAll: %v", err)
	}
	if len(fake.Unknowns) != 0 {
		t.Errorf("stale Unknown row survived the history reclassification: %+v", fake.Unknowns)
	}
	if recognized, _ := fake.LoadHistoryFilenames(); !recognized[filename] {
		t.Errorf("history filename not recorded after reclassification; got=%v", recognized)
	}
}
