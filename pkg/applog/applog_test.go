package applog_test

import (
	"bytes"
	"log"
	"log/slog"
	"strings"
	"testing"

	"recall/pkg/applog"
)

// Init's contract: after calling, both stdlib log.Printf and
// slog.Info route through the same handler.

func TestInit_RouteStdlibLogThroughSlog(t *testing.T) {
	// Drop a fresh handler on a bytes.Buffer so the test captures
	// the routed output without touching os.Stderr. Restore via
	// the stdlib log's own defaults on cleanup — that's reliable
	// across test ordering.
	var buf bytes.Buffer
	prevDefault := slog.Default()
	prevLogFlags := log.Flags()
	t.Cleanup(func() {
		slog.SetDefault(prevDefault)
		log.SetFlags(prevLogFlags)
		log.SetOutput(nil) // restore the package default
	})
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	log.SetOutput(applog.NewSlogWriter(slog.LevelInfo))
	log.SetFlags(0)

	log.Printf("watch: legacy line: %v", "details")

	got := buf.String()
	if !strings.Contains(got, "watch: legacy line: details") {
		t.Errorf("stdlib log did not route through slog handler; got %q", got)
	}
}

// net/http's panic recovery writes a whole goroutine stack through
// log.Printf (RunServer's http.Server sets no ErrorLog), and parser.Reload
// returns an errors.Join whose Error() is newline-separated. Those line
// breaks are also the bytes CWE-117 forges a second entry with, so the
// writer folds them: one record, frames still separated, no raw break left
// for a line-oriented reader to mistake for a new entry.
func TestSlogWriter_FoldsTheLineBreaksInsideOneLine(t *testing.T) {
	var buf bytes.Buffer
	prevDefault := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prevDefault) })
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))

	w := applog.NewSlogWriter(slog.LevelInfo)
	stack := "http: panic serving 127.0.0.1:52344: boom\ngoroutine 42 [running]:\r\nnet/http.(*conn).serve.func1()\n"
	n, err := w.Write([]byte(stack))
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if n != len(stack) {
		t.Fatalf("Write returned %d, want %d — the writer must report the whole line consumed", n, len(stack))
	}

	got := buf.String()
	// Folded, not fused: the frames stay legible with a separator between
	// them (Scrub-style deletion would read "boomgoroutine").
	if !strings.Contains(got, "boom | goroutine 42 [running]: | net/http.") {
		t.Errorf("line breaks were not folded into one readable record; got %q", got)
	}
	// One record, and no break survives in any form the handler had to
	// escape — which is what denies the forgery its bytes.
	if strings.Count(strings.TrimRight(got, "\n"), "\n") != 0 {
		t.Errorf("more than one record emitted; got %q", got)
	}
	if strings.Contains(got, `\n`) || strings.Contains(got, `\r`) {
		t.Errorf("a raw line break reached the handler and was escaped; got %q", got)
	}
}

func TestSubsystem_TagsLogger(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	applog.Subsystem("watch").Info("ready", slog.String("dir", "/foo"))

	got := buf.String()
	if !strings.Contains(got, `subsystem=watch`) {
		t.Errorf("Subsystem did not tag the logger; got %q", got)
	}
	if !strings.Contains(got, `dir=/foo`) {
		t.Errorf("Subsystem dropped the per-call field; got %q", got)
	}
}

func TestFormatFromEnv_HonorsOverride(t *testing.T) {
	t.Setenv("RECALL_LOG_FORMAT", "json")
	if got := applog.FormatFromEnv(); got != "json" {
		t.Errorf("formatFromEnv=%q, want %q", got, "json")
	}
	t.Setenv("RECALL_LOG_FORMAT", "TEXT")
	if got := applog.FormatFromEnv(); got != "text" {
		t.Errorf("formatFromEnv=%q (case-insensitive), want %q", got, "text")
	}
}
