package parser

import (
	"image"
	"strings"
)

// isHistoryScreenshot detects the career profile's HISTORY → GAME REPORTS
// list by the "RESETS EVERY PATCH" caption above it — the one caption on the
// screen no match screen carries. The band spans the caption's left edge to
// the list's midpoint, where it sits at every resolution in the corpus.
//
// It runs BEFORE the parseTeams fall-through, which is the point: parseTeams
// errors on this screen ("expected 6 stat columns, found 0") and the capture
// was parked in the failed-files ledger, re-failing on every Re-parse All.
func isHistoryScreenshot(img image.Image, work string) (bool, error) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W*20/100, H*28/100, W*55/100, H*35/100)
	text, err := ocrInverted(img, rect, ocrSpec{workDir: work, name: "detect_history", psm: "6", whitelist: ""})
	if err != nil {
		return false, err
	}
	return strings.Contains(strings.ToUpper(text), "RESETS EVERY PATCH"), nil
}

// parseHistory recognizes the history list without reading it: the rows are
// other matches' summaries, already captured by their own post-match screens.
// The always-nil error is part of the shared parse-func shape the
// screenshotProbes dispatch table requires.
func parseHistory(_ image.Image, _ string) (*MatchResult, error) {
	return &MatchResult{HistoryScreen: true}, nil
}
