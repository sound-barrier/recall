package app_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"recall/pkg/parser"
)

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func captureAppLogs(t *testing.T) *lockedBuffer {
	t.Helper()
	buf := &lockedBuffer{}
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })
	slog.SetDefault(slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	return buf
}

// The log is what a diagnostic bundle carries home. A run that logged nothing
// but its per-file failures (and nothing at all on success) left a bundle's
// recall.log unable to say whether a parse ever ran, how many files it
// skipped as parked, or whether the failures in the manifest were this
// build's or a stale ledger's. Each run now leaves one line with its tally.
func TestParseScreenshots_LogsOneLineWithTheRunTally(t *testing.T) {
	a, _ := newParseReadyApp(t)
	logs := captureAppLogs(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 2, "good.png", &parser.MatchResult{Result: "victory"}, nil)
		progress(2, 2, "bad.png", nil, errors.New("row OCR: expected 6 stat columns, found 0"))
		return nil
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}

	line := logLine(t, logs.String(), "parse run finished")
	// JSON, as the shipped log is: a time.Duration there is bare nanoseconds
	// ("duration":2881000000) unless it is written as text.
	for _, want := range []string{`"parsed":1`, `"failed":1`, `"force":false`, `"parked":0`, `"duration":"`} {
		if !strings.Contains(line, want) {
			t.Errorf("run line missing %s: %s", want, line)
		}
	}
}

// A run the user stops is a run too — without a line, a bundle's log cannot
// show one started and was abandoned.
func TestParseScreenshots_LogsACanceledRun(t *testing.T) {
	a, _ := newParseReadyApp(t)
	logs := captureAppLogs(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 2, "good.png", &parser.MatchResult{Result: "victory"}, nil)
		return context.Canceled
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	line := logLine(t, logs.String(), "parse run canceled")
	if !strings.Contains(line, `"parsed":1`) {
		t.Errorf("canceled-run line missing its tally: %s", line)
	}
}

func logLine(t *testing.T, out, msg string) string {
	t.Helper()
	for l := range strings.SplitSeq(out, "\n") {
		if strings.Contains(l, msg) {
			return l
		}
	}
	t.Fatalf("no %q line in the log:\n%s", msg, out)
	return ""
}
