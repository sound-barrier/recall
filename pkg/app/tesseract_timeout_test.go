//go:build !windows

package app_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"recall/pkg/app"
)

// A cold-boot Windows Defender scan can hold `tesseract --version` for many
// seconds the first time the binary is executed. Before the fix the exec had no
// deadline, so Startup → resolveSettings → checkTesseract stalled the entire app
// boot (the user-reported "loading screen, no data" after a Windows restart).
// The probe must now give up after tesseractProbeTimeout and report a retryable
// status instead of hanging.
//
// Constrained to non-Windows because it uses a POSIX shell sleep script as a
// stand-in slow binary; the timeout behaviour (exec.CommandContext kills the
// held probe) is identical cross-platform.
func TestCheckTesseract_TimeoutDoesNotHang(t *testing.T) {
	fakeBin := filepath.Join(t.TempDir(), "tesseract")
	// A "tesseract" that hangs far past the (shortened) probe timeout. `exec`
	// so the shell BECOMES sleep — otherwise SIGKILL hits the shell but the
	// orphaned `sleep` child keeps the inherited stdout pipe open and Run()
	// blocks until it exits anyway.
	if err := os.WriteFile(fakeBin, []byte("#!/bin/sh\nexec sleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	restore := *app.TesseractProbeTimeout
	*app.TesseractProbeTimeout = 150 * time.Millisecond
	t.Cleanup(func() { *app.TesseractProbeTimeout = restore })

	start := time.Now()
	s := app.CheckTesseract(fakeBin)
	elapsed := time.Since(start)

	if elapsed > 5*time.Second {
		t.Fatalf("checkTesseract hung for %s — the timeout should have bounded it to ~150ms", elapsed)
	}
	if s.Found {
		t.Fatal("expected Found=false on a timed-out probe")
	}
	if !strings.Contains(s.Error, "timed out") {
		t.Fatalf("expected a 'timed out' error, got %q", s.Error)
	}
}
