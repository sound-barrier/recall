package app_test

import (
	"path/filepath"
	"testing"

	"recall/pkg/app"
)

// The background probe publishes a status for a missing binary and stops — a
// non-existent path won't fix itself, so it must not retry forever. a.ctx is
// nil in tests, so emitTesseractStatus skips the Wails EventsEmit and the SSE
// broadcast is a nil-safe no-op.
func TestProbeTesseractInBackground_PublishesMissingBinaryStatus(t *testing.T) {
	a := app.NewWithStore(&fakeStore{})
	app.ProbeTesseractInBackground(a, filepath.Join(t.TempDir(), "nope-tesseract"))

	got := a.GetTesseractStatus()
	if got.Found {
		t.Fatalf("expected Found=false for a missing binary, got %+v", got)
	}
	if got.Error == "" {
		t.Fatal("expected an error message for a missing binary")
	}
}
