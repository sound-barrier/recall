package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

// The career profile's HISTORY → GAME REPORTS list is not a match screen, but
// players capture it. With no probe claiming it, it fell through to parseTeams,
// whose row OCR either errored ("expected 6 stat columns, found 0" — parked in
// the failed-files ledger, re-failing forever) or, by pixel accident, handed
// back an all-zero row that landed on the Unknown tab. Every band string below
// is verbatim OCR of the caption crop from a real capture.
func TestIsHistoryScreenshot_AcceptsTheGameReportsList(t *testing.T) {
	for name, band := range map[string]string{
		"2026.06.17 - 01.33.59.99":  "AQ RESETS EVERY PATCH",
		"2026.08.08 - 22.59.11.63":  "AQ RESETS EVERY PATCH",
		"lowercase garble survives": "a\\ Resets every patch",
	} {
		t.Run(name, func(t *testing.T) {
			stubOCR(t, map[string]string{"detect_history": band})
			ok, err := parser.IsHistoryScreenshot(tinyImage(), t.TempDir())
			if err != nil {
				t.Fatalf("IsHistoryScreenshot: %v", err)
			}
			if !ok {
				t.Errorf("history list not detected from band %q", band)
			}
		})
	}
}

func TestIsHistoryScreenshot_DoesNotClaimMatchScreens(t *testing.T) {
	for name, band := range map[string]string{
		"teams":   "SYSTEMCTL 20 5 12\nKENNETH117 19 2 7",
		"summary": "HEROES PLAYED\nTOTAL PERFORMANCE",
		"rank":    "PLATINUM 2\nRANK PROGRESS: 67%",
		"empty":   "",
	} {
		t.Run(name, func(t *testing.T) {
			stubOCR(t, map[string]string{"detect_history": band})
			ok, err := parser.IsHistoryScreenshot(tinyImage(), t.TempDir())
			if err != nil {
				t.Fatalf("IsHistoryScreenshot: %v", err)
			}
			if ok {
				t.Errorf("history probe claimed a %s band", name)
			}
		})
	}
}

// A recognized history list is a parse SUCCESS carrying only its marker: no
// error (which would park it in the failed ledger) and no fields (which would
// classify it as a match screen).
func TestParseScreenshot_HistoryListIsRecognizedNotFailed(t *testing.T) {
	stubOCR(t, map[string]string{"detect_history": "AQ RESETS EVERY PATCH"})
	res, err := parser.ParseImage(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("a history list must not fail the parse: %v", err)
	}
	if got := parser.Classify(res); got != parser.TypeHistory {
		t.Errorf("Classify = %q, want %q", got, parser.TypeHistory)
	}
}

func TestToGolden_HistoryProjection(t *testing.T) {
	g, ok := parser.ToGolden(&parser.MatchResult{HistoryScreen: true}).(*parser.HistoryGolden)
	if !ok {
		t.Fatalf("ToGolden(HistoryScreen) = %T, want *HistoryGolden", parser.ToGolden(&parser.MatchResult{HistoryScreen: true}))
	}
	if !g.History {
		t.Error("HistoryGolden.History = false, want true")
	}
}
