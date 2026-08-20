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
	"recall/pkg/parser"
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
	// The parsed row has to name the folder it came from: the skip set is
	// folder-scoped now, because a same-named capture in a DIFFERENT folder
	// is a different screenshot and must not read as already parsed.
	dirID, dirErr := fake.EnsureScreenshotsDir(dir)
	if dirErr != nil {
		t.Fatal(dirErr)
	}
	fake.Summaries = []db.SummaryRow{{Filename: "a.png", MatchKey: "k", ScreenshotsDirID: dirID}}
	a := app.NewWithStore(fake)
	app.SettingsOf(a).ScreenshotsDir = dir

	n, err := a.GetNewScreenshotCount()
	if err != nil {
		t.Fatalf("GetNewScreenshotCount: %v", err)
	}
	if n != 2 {
		t.Errorf("got %d new screenshots, want 2 (b.jpg + c.png; a.png parsed, notes.txt non-image)", n)
	}

	// A configured folder that has since moved or unmounted reports 0, not an
	// error — the count feeds a button label, and an unreachable folder is the
	// parse's error to report, not the count's.
	app.SettingsOf(a).ScreenshotsDir = filepath.Join(dir, "gone")
	if n, err := a.GetNewScreenshotCount(); err != nil || n != 0 {
		t.Errorf("vanished dir: got (%d, %v), want (0, nil)", n, err)
	}
}

// The Parse button's "Run Parse · N" and the progress panel's "X / N files"
// are the same promise — how many screenshots the next run will OCR — so they
// must be the same number. They used to come from two different skip sets: the
// count consulted only the five parent tables, while the run also skips
// All-Heroes screens, "Delete forever" files, and registered byte-identical
// duplicates. None of those three ever return to a parent table, so each one
// inflated the button permanently: it read "Run Parse · 4", the panel read
// "0 / 1 files", and the button still read 4 afterwards.
func TestApp_GetNewScreenshotCount_AgreesWithParseSkipSet(t *testing.T) {
	a, fake := newParseReadyApp(t)
	dir := app.SettingsOf(a).ScreenshotsDir
	for _, f := range []string{"a.png", "b.png", "c.png", "d.png", "e.png"} {
		writeFile(t, dir, f, []byte(f))
	}
	writeFile(t, dir, "notes.txt", []byte("not an image"))
	dirID, err := fake.EnsureScreenshotsDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	fake.Summaries = []db.SummaryRow{{Filename: "a.png", MatchKey: "k", ScreenshotsDirID: dirID}}
	fake.AllHeroes = map[string]bool{"b.png": true}
	fake.Ignored = map[string]bool{"c.png": true}
	fake.IngestedFiles = map[string]db.IngestedFile{
		"d.png": {ContentHash: "h", DuplicateOf: "a.png"},
	}

	count, err := a.GetNewScreenshotCount()
	if err != nil {
		t.Fatalf("GetNewScreenshotCount: %v", err)
	}
	if count != 1 {
		t.Errorf("count = %d, want 1 — only e.png is new (a.png parsed, b.png all-heroes, c.png ignored, d.png duplicate)", count)
	}

	// ...and the run agrees: what the button promises is exactly what the
	// parser will report as its total.
	var skip map[string]bool
	stubParseCapturingSkip(t, &skip)
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	pending, err := parser.PendingFiles(dir, skip)
	if err != nil {
		t.Fatalf("PendingFiles: %v", err)
	}
	if len(pending) != count {
		t.Errorf("parse total = %d %v, button count = %d; the two must agree", len(pending), pending, count)
	}
}
