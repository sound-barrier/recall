// Package applog wires Recall's structured logging.
//
// Single entrypoint: [Init] swaps Go's standard log + slog defaults
// to a handler appropriate for the runtime (text on a TTY, JSON when
// piped or when RECALL_LOG_FORMAT=json forces it). After Init, both
// stdlib `log.Printf` AND `slog.Info` route through the same
// handler, so existing call sites keep working while new code can
// reach for slog's structured fields.
//
// The package is intentionally tiny — no global state beyond
// `slog.Default()`, no init-order surprises. Callers either grab
// `slog.Default()` directly or use one of the package-scoped
// helpers in their own subsystem (e.g. `applog.Subsystem("watch")`
// returns a logger pre-tagged with `subsystem=watch`).
//
// Convention from 1.0 forward:
//
//   - New code uses `slog.With(...)` / `slog.Info(...)` etc.
//   - Existing `log.Printf("subsystem: …")` call sites are left
//     in place but can migrate opportunistically; the format
//     `subsystem: message: %v` maps to
//     `slog.Error("message", "subsystem", "X", "err", err)`.
//   - Log shipping (Loki / Datadog / etc.) wants the JSON handler;
//     set `RECALL_LOG_FORMAT=json` in the systemd unit or Docker
//     env.
package applog

import (
	"context"
	"io"
	"log"
	"log/slog"
	"os"
	"strings"
)

// Init configures `slog.Default()` and the stdlib `log` package to
// route through the same handler. Safe to call multiple times; the
// last call wins. Returns the writer the handler is wired to so
// callers can shut it down if necessary (today: always stderr).
//
// Format selection precedence:
//  1. RECALL_LOG_FORMAT env: "text" or "json".
//  2. Auto-detect: text if stderr is a terminal, JSON otherwise.
func Init() io.Writer {
	w := io.Writer(os.Stderr)
	h := newHandler(w, formatFromEnv())
	logger := slog.New(h)
	slog.SetDefault(logger)
	// Route stdlib log.Printf through slog too so existing call
	// sites (~28 across pkg/) keep working without a sweep. The
	// stdlib level is INFO — slog distinguishes Warn / Error via
	// its own API, but stdlib has no level, so INFO is the right
	// floor.
	log.SetFlags(0)
	log.SetOutput(slogWriter{level: slog.LevelInfo})
	return w
}

// Subsystem returns a *slog.Logger pre-tagged with `subsystem=name`.
// Mirrors the existing `log.Printf("name: …")` convention so the
// migration path is obvious: the prefix moves into a structured
// field.
func Subsystem(name string) *slog.Logger {
	return slog.Default().With(slog.String("subsystem", name))
}

func formatFromEnv() string {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("RECALL_LOG_FORMAT")))
	if v == "json" || v == "text" {
		return v
	}
	// Auto-detect: JSON when stderr isn't a terminal (CI, systemd,
	// Docker), text when it is. Avoids pulling in golang.org/x/term
	// — file-mode bit check is good enough.
	stat, err := os.Stderr.Stat()
	if err != nil {
		return "text"
	}
	if stat.Mode()&os.ModeCharDevice == 0 {
		return "json"
	}
	return "text"
}

func newHandler(w io.Writer, format string) slog.Handler {
	opts := &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}
	if format == "json" {
		return slog.NewJSONHandler(w, opts)
	}
	return slog.NewTextHandler(w, opts)
}

// slogWriter adapts an io.Writer call to a slog.Default() call so
// stdlib log.Printf output flows through the structured handler.
// The full line becomes the log message; subsystem extraction is
// left to readers (the `subsystem: ` prefix is already baked into
// the legacy strings).
type slogWriter struct {
	level slog.Level
}

func (s slogWriter) Write(p []byte) (int, error) {
	msg := strings.TrimRight(string(p), "\n")
	slog.Default().Log(context.Background(), s.level, msg)
	return len(p), nil
}
