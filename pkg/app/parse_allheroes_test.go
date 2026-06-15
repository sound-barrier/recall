package app_test

import (
	"context"
	"testing"

	"recall/pkg/app"
	"recall/pkg/parser"
)

// The PERSONAL "All Heroes" aggregate view is recognized but deliberately not
// stored as match data (its combat totals duplicate the TEAMS screen and its
// card icons defeat the OCR). It must be recorded into the recognized-skip
// list so the next run skips it (OCR is expensive) WITHOUT landing on the
// Unknown tab or fabricating a match row.
func TestApp_ParseScreenshots_AllHeroesRecognizedNotStored(t *testing.T) {
	a, fake := newParseReadyApp(t)
	const filename = "Overwatch Screenshot 2026.06.11 - 00.28.39.57.png"
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, filename, &parser.MatchResult{AllHeroes: true}, nil)
		return nil
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}

	recognized, _ := fake.LoadAllHeroesFilenames()
	if !recognized[filename] {
		t.Errorf("All-Heroes filename not recorded in skip list; got=%v", recognized)
	}
	if len(fake.Unknowns) != 0 {
		t.Errorf("All-Heroes must not be stored as unknown, got %d unknown rows", len(fake.Unknowns))
	}
	if n := len(fake.Summaries) + len(fake.Teams) + len(fake.Personals) + len(fake.Ranks); n != 0 {
		t.Errorf("All-Heroes must not create any match-data row, got %d", n)
	}
}

// A recognized All-Heroes file is skipped on the next normal parse run — its
// filename rides in the skip set handed to the OCR loop, so Tesseract never
// re-examines it.
func TestApp_ParseScreenshots_SkipsRecognizedAllHeroes(t *testing.T) {
	a, fake := newParseReadyApp(t)
	const filename = "recognized-all-heroes.png"
	if err := fake.UpsertAllHeroesScreenshot(filename); err != nil {
		t.Fatalf("seed UpsertAllHeroesScreenshot: %v", err)
	}

	var gotSkip map[string]bool
	prev := app.ParseScreenshotsDirFunc
	app.ParseScreenshotsDirFunc = func(_ context.Context, _ string, skip map[string]bool, _ parser.ProgressFunc) (map[string]*parser.MatchResult, error) {
		gotSkip = skip
		return nil, nil
	}
	t.Cleanup(func() { app.ParseScreenshotsDirFunc = prev })

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if !gotSkip[filename] {
		t.Errorf("recognized All-Heroes file not in next-run skip set; got=%v", gotSkip)
	}
}
