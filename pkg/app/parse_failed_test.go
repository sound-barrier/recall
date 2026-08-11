package app_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/parser"
)

// The failed-file ledger: a per-file OCR failure is recorded so the
// Unknown tab can triage it, a later successful parse clears it, and
// "Delete forever" clears it. Failures are deliberately NOT added to
// the skip set — every run re-attempts them.

func TestApp_ParseScreenshots_RecordsFailedFile(t *testing.T) {
	a, fake := newParseReadyApp(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, "corrupt.png", nil, errors.New("decoding image: png: invalid format"))
		return nil
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	row, ok := fake.FailedFiles["corrupt.png"]
	if !ok {
		t.Fatalf("expected a failed_files row for corrupt.png, got %v", fake.FailedFiles)
	}
	if row.Error != "decoding image: png: invalid format" {
		t.Errorf("error = %q", row.Error)
	}
	if row.Attempts != 1 {
		t.Errorf("attempts = %d, want 1", row.Attempts)
	}
}

func TestApp_ParseScreenshots_NilResultWithoutErrorRecordsFallback(t *testing.T) {
	a, fake := newParseReadyApp(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, "empty.png", nil, nil)
		return nil
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	row, ok := fake.FailedFiles["empty.png"]
	if !ok {
		t.Fatalf("expected a failed_files row for empty.png, got %v", fake.FailedFiles)
	}
	if row.Error == "" {
		t.Error("nil-result failure must carry a non-empty fallback message")
	}
}

func TestApp_ParseScreenshots_SuccessClearsFailedFile(t *testing.T) {
	a, fake := newParseReadyApp(t)
	if err := fake.RecordFailedFile("flaky.png", 1, "tesseract failed: exit status 1"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	stubParse(t, func(progress parser.ProgressFunc) error {
		res := &parser.MatchResult{Result: "victory", Map: "rialto", Hero: "lucio"}
		progress(1, 1, "flaky.png", res, nil)
		return nil
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if _, still := fake.FailedFiles["flaky.png"]; still {
		t.Error("a successful parse must remove the file's failure row")
	}
}

// A parse that SUCCEEDED but degraded (the parser recorded a non-fatal
// warning: a stat cell whose OCR failed, a hero card that lost its timing)
// must land BOTH ways — the data it did read is stored, and the file keeps a
// triage-ledger row so the Unknown tab can offer a deliberate re-parse.
// Without the second half the success path's RemoveFailedFile clears the row
// and the degradation is invisible forever.
func TestApp_ParseScreenshots_DegradedParseIsLedgeredAndStillStored(t *testing.T) {
	a, fake := newParseReadyApp(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		res := &parser.MatchResult{
			Hero: "kiriko",
			HeroesPlayed: []parser.HeroPlay{
				{Hero: "kiriko", Stats: map[string]int{"solo_kills": 13}},
			},
			Warnings: []string{"personal_r0c2 OCR failed: tesseract failed: exit status 1"},
		}
		progress(1, 1, "degraded.png", res, nil)
		return nil
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	row, ok := fake.FailedFiles["degraded.png"]
	if !ok {
		t.Fatalf("a degraded parse must stay in the triage ledger, got %v", fake.FailedFiles)
	}
	if !strings.Contains(row.Error, "personal_r0c2") {
		t.Errorf("ledger error = %q, want the parser's warning carried verbatim", row.Error)
	}
	if len(fake.Personals) != 1 {
		t.Fatalf("stored personals = %d, want 1 — a degraded parse still stores what it read", len(fake.Personals))
	}
}

// The ledger must not become a graveyard: once a re-parse comes back clean,
// the standing row from an earlier degraded run is cleared.
func TestApp_ParseScreenshots_CleanReparseClearsADegradedLedgerRow(t *testing.T) {
	a, fake := newParseReadyApp(t)
	if err := fake.RecordFailedFile("degraded.png", 1, "personal_r0c2 OCR failed"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	stubParse(t, func(progress parser.ProgressFunc) error {
		res := &parser.MatchResult{
			Hero:         "kiriko",
			HeroesPlayed: []parser.HeroPlay{{Hero: "kiriko", PercentPlayed: 100, PlayTime: "9:12", Stats: map[string]int{"solo_kills": 13}}},
		}
		progress(1, 1, "degraded.png", res, nil)
		return nil
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if _, still := fake.FailedFiles["degraded.png"]; still {
		t.Error("a warning-free re-parse must clear the standing ledger row")
	}
}

func TestApp_IgnoreScreenshot_ClearsFailedFile(t *testing.T) {
	a, fake := newParseReadyApp(t)
	if err := fake.RecordFailedFile("junk.png", 1, "could not locate the highlighted row"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := a.IgnoreScreenshot("junk.png"); err != nil {
		t.Fatalf("IgnoreScreenshot: %v", err)
	}
	if _, still := fake.FailedFiles["junk.png"]; still {
		t.Error("Delete forever must remove the file's failure row")
	}
	if !fake.Ignored["junk.png"] {
		t.Error("file must still land on the suppress list")
	}
}

func TestApp_ParseScreenshots_FailedFileNotAddedToSkipSet(t *testing.T) {
	a, fake := newParseReadyApp(t)
	if err := fake.RecordFailedFile("corrupt.png", 1, "boom"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Capture the skip set the OCR loop receives: a ledgered failure
	// must NOT be in it (retry-every-run policy) and must not have been
	// auto-ignored.
	var skipSeen map[string]bool
	prev := app.ParseScreenshotsDirFunc
	app.ParseScreenshotsDirFunc = func(_ context.Context, _ string, skip map[string]bool, _ parser.ProgressFunc) (map[string]*parser.MatchResult, error) {
		skipSeen = skip
		return nil, nil
	}
	t.Cleanup(func() { app.ParseScreenshotsDirFunc = prev })

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if skipSeen["corrupt.png"] {
		t.Error("failed files must be retried every run — not in the skip set")
	}
	if fake.Ignored["corrupt.png"] {
		t.Error("failure must not auto-ignore the file")
	}
}
