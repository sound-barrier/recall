package app_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
)

func TestApp_GetMatchByKey(t *testing.T) {
	const key = "match-2026-01-05T21-30-00"
	fake := dbtest.New()
	fake.Summaries = []db.SummaryRow{
		{Filename: "s.png", MatchKey: key, Map: "rialto", Hero: "lucio", Result: "victory"},
	}
	a := app.NewWithStore(fake)

	rec, err := a.GetMatchByKey(key)
	if err != nil {
		t.Fatalf("GetMatchByKey: %v", err)
	}
	if rec.MatchKey != key {
		t.Errorf("MatchKey = %q, want %q", rec.MatchKey, key)
	}

	if _, err := a.GetMatchByKey("match-does-not-exist"); !errors.Is(err, match.ErrMatchNotFound) {
		t.Errorf("missing key: got %v, want match.ErrMatchNotFound", err)
	}
}

func TestApp_GetNewScreenshotCount(t *testing.T) {
	// No screenshots dir configured → 0, no error.
	if n, err := app.NewWithStore(dbtest.New()).GetNewScreenshotCount(); err != nil || n != 0 {
		t.Errorf("unset dir: got (%d, %v), want (0, nil)", n, err)
	}

	// A dir of 3 images + a non-image; one image is already parsed → 2 new.
	dir := t.TempDir()
	for _, f := range []string{"a.png", "b.jpg", "c.png", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(dir, f), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	fake := dbtest.New()
	fake.Summaries = []db.SummaryRow{{Filename: "a.png", MatchKey: "k"}}
	a := app.NewWithStore(fake)
	app.AppSettings(a).ScreenshotsDir = dir

	n, err := a.GetNewScreenshotCount()
	if err != nil {
		t.Fatalf("GetNewScreenshotCount: %v", err)
	}
	if n != 2 {
		t.Errorf("got %d new screenshots, want 2 (b.jpg + c.png; a.png parsed, notes.txt non-image)", n)
	}
}
