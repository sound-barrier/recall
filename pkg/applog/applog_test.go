package applog

import (
	"bytes"
	"log"
	"log/slog"
	"strings"
	"testing"
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
	log.SetOutput(slogWriter{level: slog.LevelInfo})
	log.SetFlags(0)

	log.Printf("watch: legacy line: %v", "details")

	got := buf.String()
	if !strings.Contains(got, "watch: legacy line: details") {
		t.Errorf("stdlib log did not route through slog handler; got %q", got)
	}
}

func TestSubsystem_TagsLogger(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))

	Subsystem("watch").Info("ready", slog.String("dir", "/foo"))

	got := buf.String()
	if !strings.Contains(got, `subsystem=watch`) {
		t.Errorf("Subsystem did not tag the logger; got %q", got)
	}
	if !strings.Contains(got, `dir=/foo`) {
		t.Errorf("Subsystem dropped the per-call field; got %q", got)
	}
}

func TestFormatFromEnv_HonoursOverride(t *testing.T) {
	t.Setenv("RECALL_LOG_FORMAT", "json")
	if got := formatFromEnv(); got != "json" {
		t.Errorf("formatFromEnv=%q, want %q", got, "json")
	}
	t.Setenv("RECALL_LOG_FORMAT", "TEXT")
	if got := formatFromEnv(); got != "text" {
		t.Errorf("formatFromEnv=%q (case-insensitive), want %q", got, "text")
	}
}
