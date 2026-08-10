package app_test

import (
	"context"
	"testing"

	"recall/pkg/parser"
)

// The auto-optimize scheduler: PRAGMA optimize runs at the end of any
// parse run that changed at least one match (SQLite self-gates the
// actual work, so per-run is cheap), and never when the run changed
// nothing or aborted — an idle watcher debounce must not touch the DB.

func TestAutoOptimize_RunsAfterParseThatChangedMatches(t *testing.T) {
	a, fake := newParseReadyApp(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		res := &parser.MatchResult{Result: "victory", Map: "rialto", Hero: "lucio"}
		progress(1, 1, "Overwatch Screenshot 2026.01.05 - 21.30.00.00.png", res, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if fake.OptimizeCalls != 1 {
		t.Errorf("OptimizeCalls = %d, want 1 after a match-changing run", fake.OptimizeCalls)
	}
}

func TestAutoOptimize_SkipsRunsThatChangedNothing(t *testing.T) {
	a, fake := newParseReadyApp(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, "bad.png", nil, context.DeadlineExceeded) // per-file failure
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if fake.OptimizeCalls != 0 {
		t.Errorf("OptimizeCalls = %d, want 0 when no match changed", fake.OptimizeCalls)
	}
}

func TestAutoOptimize_SkipsCanceledRuns(t *testing.T) {
	a, fake := newParseReadyApp(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		res := &parser.MatchResult{Result: "victory", Map: "rialto", Hero: "lucio"}
		progress(1, 2, "Overwatch Screenshot 2026.01.05 - 21.30.00.00.png", res, nil)
		return context.Canceled // user hit Stop mid-batch
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if fake.OptimizeCalls != 0 {
		t.Errorf("OptimizeCalls = %d, want 0 on a canceled run", fake.OptimizeCalls)
	}
}
