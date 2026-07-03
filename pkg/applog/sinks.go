package applog

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime/debug"
)

// MaxLogBytes is the on-disk log's rotation threshold: a log file
// larger than this at attach time is renamed to `<name>.1` (replacing
// any previous rotation) and a fresh file starts. Rotation happens
// only at attach — one long session can exceed the cap, and the next
// launch reclaims it. Sized so two generations stay trivially
// attachable to a bug report.
const MaxLogBytes = 5 << 20

// RecoverPanic logs and swallows a panic on a background goroutine.
// Use as `defer applog.RecoverPanic("watch")` at the top of every
// goroutine the app spawns: an unrecovered panic there kills the
// whole desktop process, historically with nothing in any log to
// attach to a bug report. The stack is captured at recover time so
// the log line alone locates the fault.
func RecoverPanic(scope string) {
	r := recover()
	if r == nil {
		return
	}
	slog.Error("panic recovered on a background goroutine",
		slog.String("subsystem", scope),
		slog.Any("panic", r),
		slog.String("stack", string(debug.Stack())),
	)
}

// AttachFile mirrors the log stream onto an on-disk file in addition
// to stderr — stderr vanishes for a desktop app launched from Finder
// or the Start menu, leaving field bug reports with nothing to
// attach. Creates the parent directory, rotates an oversized log
// (see MaxLogBytes), re-runs the Init wiring against the combined
// writer, and returns a close function for shutdown. Callers treat
// failure as non-fatal: logging keeps flowing to stderr.
func AttachFile(path string) (func() error, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, fmt.Errorf("applog: create log dir: %w", err)
	}
	if info, err := os.Stat(path); err == nil && info.Size() > MaxLogBytes {
		if err := os.Rename(path, path+".1"); err != nil {
			return nil, fmt.Errorf("applog: rotate: %w", err)
		}
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600) // #nosec G304 -- path is built from appBaseDir, not user input
	if err != nil {
		return nil, fmt.Errorf("applog: open log file: %w", err)
	}
	initTo(io.MultiWriter(os.Stderr, f))
	return f.Close, nil
}

// initTo is Init's body against an arbitrary writer; Init keeps its
// zero-argument signature (stderr only) for the two mains' boot call,
// and AttachFile re-runs the same wiring once the data dir is known.
func initTo(w io.Writer) {
	h := newHandler(w, formatFromEnv())
	slog.SetDefault(slog.New(h))
	logSetup()
}
