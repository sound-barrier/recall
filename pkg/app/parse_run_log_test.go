package app_test

import (
	"bytes"
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
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
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

	out := logs.String()
	var line string
	for l := range strings.SplitSeq(out, "\n") {
		if strings.Contains(l, "parse run finished") {
			line = l
		}
	}
	if line == "" {
		t.Fatalf("no parse-run line in the log:\n%s", out)
	}
	for _, want := range []string{"parsed=1", "failed=1", "force=false", "skipped=", "parked=", "duration="} {
		if !strings.Contains(line, want) {
			t.Errorf("run line missing %q: %s", want, line)
		}
	}
}
