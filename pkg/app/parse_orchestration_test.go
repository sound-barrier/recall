package app_test

import (
	"context"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
	"recall/pkg/parser"
	"recall/pkg/snapshot"
)

// newParseReadyApp wires a fake store + an App whose parse preconditions pass
// (screenshots dir set to a real temp dir, Tesseract marked found) WITHOUT
// calling Startup — so a.ctx stays nil and the Wails emit path is a no-op. The
// OCR loop itself is stubbed per-test via app.ParseScreenshotsDirFunc.
func newParseReadyApp(t *testing.T) (*app.App, *dbtest.Fake) {
	t.Helper()
	fake := dbtest.New()
	a := app.NewWithStore(fake)
	app.SettingsOf(a).ScreenshotsDir = t.TempDir()
	app.TessStatus(a).Found = true
	// Snapshot hooks (pre-reparse + auto-backup) run inside the parse
	// path; stub the VACUUM INTO seam so unit tests never touch a real
	// SQLite file. Backup-specific tests re-stub with their recorders.
	prevBackup := snapshot.BackupToFunc
	snapshot.BackupToFunc = func(src, dest string) error { return nil }
	t.Cleanup(func() { snapshot.BackupToFunc = prevBackup })
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
	app.TessStatus(a).Found = true // dir is the unset precondition
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
	// Keyed by type and checked against parser.ScreenshotTypes below, because
	// this table used to cover FOUR of the six while its name promised all of
	// them — summary and all_heroes were simply absent, and nothing said so.
	cases := map[parser.ScreenshotType]struct {
		res   *parser.MatchResult
		count func(*dbtest.Fake) int
	}{
		parser.TypeSummary:  {&parser.MatchResult{Result: "victory"}, func(f *dbtest.Fake) int { return len(f.Summaries) }},
		parser.TypeTeams:    {&parser.MatchResult{Eliminations: 12}, func(f *dbtest.Fake) int { return len(f.Teams) }},
		parser.TypePersonal: {&parser.MatchResult{HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", Stats: map[string]int{"weapon_accuracy": 35}}}}, func(f *dbtest.Fake) int { return len(f.Personals) }},
		parser.TypeRank:     {&parser.MatchResult{Rank: "platinum"}, func(f *dbtest.Fake) int { return len(f.Ranks) }},
		// all_heroes is recognized but deliberately stores no match row — only
		// the skip-registry filename, so a re-parse does not re-OCR it.
		parser.TypeAllHeroes: {&parser.MatchResult{AllHeroes: true}, func(f *dbtest.Fake) int { return len(f.AllHeroes) }},
		parser.TypeUnknown:   {&parser.MatchResult{}, func(f *dbtest.Fake) int { return len(f.Unknowns) }},
	}

	// The vocabulary is the checklist: a seventh screenshot type fails here
	// until it is dispatched AND covered, rather than falling through to
	// unknown and writing a garbage row in silence.
	for _, typ := range parser.ScreenshotTypes {
		if _, ok := cases[typ]; !ok {
			t.Errorf("no dispatch case for screenshot type %q — this test must learn about a "+
				"new type rather than silently cover less", typ)
		}
	}

	for typ, c := range cases {
		t.Run(string(typ), func(t *testing.T) {
			if got := parser.Classify(c.res); got != typ {
				t.Fatalf("fixture for %q classifies as %q — the case no longer exercises the arm it names", typ, got)
			}
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
				t.Errorf("%s: stored %d rows, want 1", typ, got)
			}
		})
	}
}
