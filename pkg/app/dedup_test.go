package app_test

import (
	"context"
	"maps"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/parser"
)

// The dedup pre-scan: byte-identical copies of an already-ingested
// file join the skip set before OCR; originals get registered so
// future copies match; the skip sticks on later runs.

// stubParseCapturingSkip swaps the OCR seam with one that records the
// skip set it was handed and parses nothing.
func stubParseCapturingSkip(t *testing.T, got *map[string]bool) {
	t.Helper()
	prev := app.ParseScreenshotsDirFunc
	app.ParseScreenshotsDirFunc = func(_ context.Context, _ string, skip map[string]bool, _ parser.ProgressFunc) (map[string]*parser.MatchResult, error) {
		copied := make(map[string]bool, len(skip))
		maps.Copy(copied, skip)
		*got = copied
		return nil, nil
	}
	t.Cleanup(func() { app.ParseScreenshotsDirFunc = prev })
}

func writeFile(t *testing.T, dir, name string, content []byte) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), content, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDedup_ByteIdenticalCopySkipsOCRAndLinks(t *testing.T) {
	a, fake := newParseReadyApp(t)
	dir := app.AppSettings(a).ScreenshotsDir
	// Lexical scan order makes a-original.png the canonical copy.
	writeFile(t, dir, "a-original.png", []byte("same-bytes"))
	writeFile(t, dir, "b-copy.png", []byte("same-bytes"))
	writeFile(t, dir, "c-distinct.png", []byte("different"))

	var skip map[string]bool
	stubParseCapturingSkip(t, &skip)
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}

	if !skip["b-copy.png"] {
		t.Error("the byte-identical copy must join the skip set")
	}
	if skip["a-original.png"] || skip["c-distinct.png"] {
		t.Errorf("originals must still parse; skip=%v", skip)
	}
	if got := fake.IngestedFiles["b-copy.png"].DuplicateOf; got != "a-original.png" {
		t.Errorf("duplicate_of = %q, want a-original.png", got)
	}
	if got := fake.IngestedFiles["a-original.png"].DuplicateOf; got != "" {
		t.Errorf("the canonical file must not be marked a duplicate, got %q", got)
	}
	if fake.IngestedFiles["c-distinct.png"].ContentHash == fake.IngestedFiles["a-original.png"].ContentHash {
		t.Error("distinct content must hash differently")
	}
}

func TestDedup_StandingDuplicateStaysSkippedOnLaterRuns(t *testing.T) {
	a, _ := newParseReadyApp(t)
	dir := app.AppSettings(a).ScreenshotsDir
	writeFile(t, dir, "a-original.png", []byte("same-bytes"))
	writeFile(t, dir, "b-copy.png", []byte("same-bytes"))

	var skip map[string]bool
	stubParseCapturingSkip(t, &skip)
	if err := a.ParseScreenshots(); err != nil {
		t.Fatal(err)
	}
	if err := a.ReParseAll(); err != nil { // force run: canonical re-parses, copy stays out
		t.Fatal(err)
	}
	if !skip["b-copy.png"] {
		t.Error("the copy must stay skipped on a force re-parse")
	}
	if skip["a-original.png"] {
		t.Error("the canonical file must re-parse on force")
	}
}
