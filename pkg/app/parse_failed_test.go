package app_test

import (
	"context"
	"errors"
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
