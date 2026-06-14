package app_test

import (
	"context"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
	"recall/pkg/parser"
)

// newParseReadyApp wires a fake store + an App whose parse preconditions pass
// (screenshots dir set to a real temp dir, Tesseract marked found) WITHOUT
// calling Startup — so a.ctx stays nil and the Wails emit path is a no-op. The
// OCR loop itself is stubbed per-test via app.ParseScreenshotsDirFunc.
func newParseReadyApp(t *testing.T) (*app.App, *dbtest.Fake) {
	t.Helper()
	fake := dbtest.New()
	a := app.NewWithStore(fake)
	app.AppSettings(a).ScreenshotsDir = t.TempDir()
	app.AppTessStatus(a).Found = true
	return a, fake
}

// stubParse swaps the OCR-loop seam for the duration of a test.
func stubParse(t *testing.T, fn func(progress parser.ProgressFunc) error) {
	t.Helper()
	prev := app.ParseScreenshotsDirFunc
	app.ParseScreenshotsDirFunc = func(_ context.Context, _ string, _ map[string]bool, progress parser.ProgressFunc) (map[string]*parser.MatchResult, error) {
		return nil, fn(progress)
	}
	t.Cleanup(func() { app.ParseScreenshotsDirFunc = prev })
}

func TestApp_ParseScreenshots_PersistsParsedResult(t *testing.T) {
	a, fake := newParseReadyApp(t)
	// One synthetic SUMMARY result (Result != "" → ScreenshotType "summary").
	stubParse(t, func(progress parser.ProgressFunc) error {
		res := &parser.MatchResult{Result: "victory", Map: "rialto", Hero: "lucio"}
		progress(1, 1, "Overwatch Screenshot 2026.01.05 - 21.30.00.00.png", res, nil)
		return nil
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if fake.UpsertCalls == 0 {
		t.Error("expected the parsed summary to be upserted, got 0 Upsert calls")
	}
	if len(fake.Summaries) != 1 {
		t.Fatalf("expected 1 stored summary, got %d", len(fake.Summaries))
	}
	if got := fake.Summaries[0]; got.Result != "victory" || got.Map != "rialto" || got.Hero != "lucio" {
		t.Errorf("stored summary fields wrong: %+v", got)
	}
}

func TestApp_ParseScreenshots_SkipsRowOnPerFileError(t *testing.T) {
	a, fake := newParseReadyApp(t)
	// A per-file parse error → handleFile emits progress but writes nothing.
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, "bad.png", nil, context.DeadlineExceeded)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if fake.UpsertCalls != 0 {
		t.Errorf("a per-file error must not upsert, got %d calls", fake.UpsertCalls)
	}
}

func TestApp_ParseScreenshots_MissingDirIsError(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	app.AppTessStatus(a).Found = true // dir is the unset precondition
	if err := a.ParseScreenshots(); err == nil {
		t.Fatal("expected an error when the screenshots dir is unset")
	}
}

func TestApp_ClaimParse_SingleFlight(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	if _, ok := app.ClaimParse(a, false); !ok {
		t.Fatal("first claim should take the slot")
	}
	if _, ok := app.ClaimParse(a, false); ok {
		t.Error("second claim must fail while a parse holds the slot")
	}
	app.EndParse(a)
	if _, ok := app.ClaimParse(a, false); !ok {
		t.Error("claim should succeed again after EndParse")
	}
	app.EndParse(a)
}

func TestApp_ParseScreenshots_DispatchesEachScreenshotType(t *testing.T) {
	cases := []struct {
		name  string
		res   *parser.MatchResult
		count func(*dbtest.Fake) int
	}{
		{"teams", &parser.MatchResult{Eliminations: 12}, func(f *dbtest.Fake) int { return len(f.Teams) }},
		{"personal", &parser.MatchResult{HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", Stats: map[string]int{"weapon_accuracy": 35}}}}, func(f *dbtest.Fake) int { return len(f.Personals) }},
		{"rank", &parser.MatchResult{Rank: "platinum"}, func(f *dbtest.Fake) int { return len(f.Ranks) }},
		{"unknown", &parser.MatchResult{}, func(f *dbtest.Fake) int { return len(f.Unknowns) }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			a, fake := newParseReadyApp(t)
			res := c.res
			stubParse(t, func(progress parser.ProgressFunc) error {
				progress(1, 1, "shot.png", res, nil)
				return nil
			})
			if err := a.ParseScreenshots(); err != nil {
				t.Fatalf("ParseScreenshots: %v", err)
			}
			if got := c.count(fake); got != 1 {
				t.Errorf("%s: stored %d rows, want 1", c.name, got)
			}
		})
	}
}
