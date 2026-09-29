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

// A probe false positive must not cost a real row. History is the last probe
// before the TEAMS fall-through, so a misfire lands on a genuine scoreboard;
// recognizing a file as history keeps its typed row — the rule All-Heroes
// already follows — and only the Unknown row, which claims nothing, is retired.
func TestApp_ReParseAll_HistoryKeepsATypedRow(t *testing.T) {
	a, fake := newParseReadyApp(t)
	const filename = "Overwatch 2 Screenshot 2026.09.20 - 02.28.09.26.png"
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, filename, &parser.MatchResult{Eliminations: 14, Assists: 14, Deaths: 5, Damage: 6146}, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("first ParseScreenshots: %v", err)
	}
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, filename, &parser.MatchResult{HistoryScreen: true}, nil)
		return nil
	})
	if err := a.ReParseAll(); err != nil {
		t.Fatalf("ReParseAll: %v", err)
	}
	if len(fake.Teams) != 1 {
		t.Errorf("a history misfire evicted the typed TEAMS row: %d teams rows left", len(fake.Teams))
	}
}

// A screen that is not a match has no match to correlate with. History lists
// are captured in menus between games, so running it through the timestamp
// window could tie two neighboring matches and file the list as an ambiguous
// screenshot waiting on the user.
func TestApp_ParseScreenshots_HistoryRaisesNoAmbiguity(t *testing.T) {
	a, fake := newParseReadyApp(t)
	const (
		before  = "Overwatch 2 Screenshot 2026.09.20 - 02.00.00.00.png"
		after   = "Overwatch 2 Screenshot 2026.09.20 - 02.03.00.00.png"
		history = "Overwatch 2 Screenshot 2026.09.20 - 02.01.30.00.png"
	)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 3, before, &parser.MatchResult{Result: "victory", Map: "Ilios"}, nil)
		progress(2, 3, after, &parser.MatchResult{Result: "defeat", Map: "Dorado"}, nil)
		progress(3, 3, history, &parser.MatchResult{HistoryScreen: true}, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if cands := fake.Ambiguous[history]; len(cands) != 0 {
		t.Errorf("history list filed as ambiguous between %d matches", len(cands))
	}
}
