package applog_test

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/applog"
)

// RecoverPanic: a panicking background goroutine must be logged and
// swallowed, not kill the whole desktop app — a watcher-callback or
// parse-goroutine panic previously took the process down with nothing
// in any log to attach to a bug report.

func withCapturedLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	return &buf
}

func TestRecoverPanic_SwallowsAndLogsWithStack(t *testing.T) {
	buf := withCapturedLog(t)

	func() {
		defer applog.RecoverPanic("watch")
		panic("boom in the debounce callback")
	}() // must not propagate

	got := buf.String()
	for _, want := range []string{"panic", "boom in the debounce callback", "watch", "recover_test.go"} {
		if !strings.Contains(got, want) {
			t.Errorf("panic log missing %q; got %q", want, got)
		}
	}
}

func TestRecoverPanic_NoOpWithoutPanic(t *testing.T) {
	buf := withCapturedLog(t)
	func() {
		defer applog.RecoverPanic("parse")
	}()
	if buf.Len() != 0 {
		t.Errorf("logged without a panic: %q", buf.String())
	}
}

// AttachFile: mirrors the active handler onto an on-disk log so field
// bug reports have something to attach (stderr vanishes for a desktop
// app launched from Finder / the Start menu).

func TestAttachFile_MirrorsLogLinesToDisk(t *testing.T) {
	path := filepath.Join(t.TempDir(), "logs", "recall.log")
	closeFn, err := applog.AttachFile(path)
	if err != nil {
		t.Fatalf("AttachFile: %v", err)
	}
	t.Cleanup(func() {
		_ = closeFn()
		applog.Init() // restore the stderr-only default for later tests
	})

	slog.Info("attached line", "k", "v")

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}
	if !strings.Contains(string(data), "attached line") {
		t.Errorf("log file missing the line; got %q", string(data))
	}
}

func TestAttachFile_RotatesOversizedLogOnAttach(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "recall.log")
	// Pre-existing oversized log from previous sessions.
	if err := os.WriteFile(path, bytes.Repeat([]byte("x"), applog.MaxLogBytes+1), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}

	closeFn, err := applog.AttachFile(path)
	if err != nil {
		t.Fatalf("AttachFile: %v", err)
	}
	t.Cleanup(func() {
		_ = closeFn()
		applog.Init()
	})

	rotated, err := os.Stat(path + ".1")
	if err != nil {
		t.Fatalf("expected rotated %s.1: %v", path, err)
	}
	if rotated.Size() <= int64(applog.MaxLogBytes) {
		t.Errorf("rotated file size = %d, want the oversized original", rotated.Size())
	}
	fresh, err := os.Stat(path)
	if err != nil {
		t.Fatalf("fresh log missing: %v", err)
	}
	if fresh.Size() > 1024 {
		t.Errorf("fresh log not reset; size = %d", fresh.Size())
	}
}
