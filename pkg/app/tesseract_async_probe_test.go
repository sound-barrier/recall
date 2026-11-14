package app_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

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

// The background probe retries a binary that exists but will not run yet
// (a cold-boot Defender scan), for seconds. A status the user set meanwhile
// — a new path, a reset — is newer than anything the probe can say, and
// the probe used to overwrite it on its next pass.
func TestProbeTesseractInBackground_NeverOverwritesANewerStatus(t *testing.T) {
	prev := *app.TesseractProbeRetryDelay
	*app.TesseractProbeRetryDelay = 20 * time.Millisecond
	t.Cleanup(func() { *app.TesseractProbeRetryDelay = prev })

	a := tesseractApp(t, "")
	notYetRunnable := filepath.Join(t.TempDir(), "tesseract")
	if err := os.WriteFile(notYetRunnable, []byte("not a binary"), 0o600); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		app.ProbeTesseractInBackground(a, notYetRunnable)
	}()
	time.Sleep(30 * time.Millisecond)
	newer, _ := a.SetTesseractPath("bin/tesseract")
	<-done

	if got := a.GetTesseractStatus(); got.Path != newer.Path || got.Error != newer.Error {
		t.Errorf("status after the probe = %+v, want the newer %+v", got, newer)
	}
}

// Before the probe has answered, the status says so — "still checking" is
// not "not found", and the UI must not raise the engine-offline halt for it.
func TestTesseractStatus_ProbingUntilTheFirstAnswer(t *testing.T) {
	a := tesseractApp(t, "")
	app.SeedTesseractPlaceholder(a, "/usr/bin/tesseract")
	if got := a.GetTesseractStatus(); got.State != app.TesseractProbing {
		t.Fatalf("state before any probe = %q, want probing", got.State)
	}
	app.ProbeTesseractInBackground(a, filepath.Join(t.TempDir(), "nope-tesseract"))
	if got := a.GetTesseractStatus(); got.State != app.TesseractUnavailable {
		t.Errorf("state after a probe of a missing binary = %q, want unavailable", got.State)
	}
}
