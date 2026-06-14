package parser_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"recall/pkg/parser"
)

// stubParseSingle swaps parseSingleFunc for the duration of the test.
// The fake returns a result/err based on the basename of the path, so
// tests can mix "good" and "bad" files in one directory without writing
// real PNG bytes.
func stubParseSingle(t *testing.T, fn func(path string) (*parser.MatchResult, error)) {
	original := *parser.ParseSingleFunc
	*parser.ParseSingleFunc = fn
	t.Cleanup(func() { *parser.ParseSingleFunc = original })
}

// makeFiles drops zero-byte placeholder files into a temp dir so
// ParseScreenshotsDir's os.ReadDir + extension filter sees them. The
// actual file contents are irrelevant because parseSingleFunc is stubbed.
func makeFiles(t *testing.T, names ...string) string {
	dir := t.TempDir()
	for _, n := range names {
		path := filepath.Join(dir, n)
		if err := os.WriteFile(path, []byte{}, 0o600); err != nil {
			t.Fatalf("WriteFile %s: %v", n, err)
		}
	}
	return dir
}

// ──────────────────────────────────────────────────────────────────────────
// The bug under test: when one file fails to parse, the others must still
// be processed. Before the fix this test failed because ParseScreenshotsDir
// returned early on the first error.
// ──────────────────────────────────────────────────────────────────────────

func TestParseScreenshotsDir_ContinuesAfterPerFileFailure(t *testing.T) {
	stubParseSingle(t, func(path string) (*parser.MatchResult, error) {
		switch filepath.Base(path) {
		case "good1.png":
			return &parser.MatchResult{Map: "rialto"}, nil
		case "broken.png":
			return nil, errors.New("decoding image: invalid PNG signature")
		case "good2.png":
			return &parser.MatchResult{Map: "aatlis"}, nil
		}
		return nil, nil
	})

	dir := makeFiles(t, "good1.png", "broken.png", "good2.png")

	results, err := parser.ParseScreenshotsDir(t.Context(), dir, nil, nil)
	if err != nil {
		t.Fatalf("a single bad screenshot must not abort the batch; got err=%v", err)
	}

	got := make([]string, 0, len(results))
	for name := range results {
		got = append(got, name)
	}
	sort.Strings(got)
	want := []string{"good1.png", "good2.png"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("expected only the parseable files in results; got %v want %v", got, want)
	}
	if _, present := results["broken.png"]; present {
		t.Errorf("the broken file must not appear in results (it has no MatchResult)")
	}
}

// ──────────────────────────────────────────────────────────────────────────
// The progress callback surfaces both successes and failures so the UI can
// render per-file warnings without aborting.
// ──────────────────────────────────────────────────────────────────────────

func TestParseScreenshotsDir_ProgressReceivesPerFileErrors(t *testing.T) {
	stubParseSingle(t, func(path string) (*parser.MatchResult, error) {
		if filepath.Base(path) == "broken.png" {
			return nil, errors.New("boom")
		}
		return &parser.MatchResult{}, nil
	})

	dir := makeFiles(t, "a.png", "broken.png", "c.png")

	type call struct {
		done, total int
		filename    string
		hasResult   bool
		err         error
	}
	var calls []call
	progress := func(done, total int, filename string, result *parser.MatchResult, err error) {
		calls = append(calls, call{done, total, filename, result != nil, err})
	}

	if _, err := parser.ParseScreenshotsDir(t.Context(), dir, nil, progress); err != nil {
		t.Fatalf("dir-level err must be nil; got %v", err)
	}
	if len(calls) != 3 {
		t.Fatalf("progress must fire for every file (including failures); got %d calls", len(calls))
	}
	// done counts up 1..total even when a file fails — the user wants
	// monotonic progress, not "1, 1, 2" stalls.
	for i, c := range calls {
		if c.done != i+1 || c.total != 3 {
			t.Errorf("calls[%d]: got done=%d total=%d; want %d/3", i, c.done, c.total, i+1)
		}
	}
	// The failing entry must carry err != nil and result == nil; the
	// healthy entries the inverse.
	for _, c := range calls {
		switch c.filename {
		case "broken.png":
			if c.err == nil {
				t.Errorf("broken.png must carry a non-nil err; got nil")
			}
			if c.hasResult {
				t.Errorf("broken.png must not carry a result")
			}
		default:
			if c.err != nil {
				t.Errorf("healthy file %s should not carry err; got %v", c.filename, c.err)
			}
			if !c.hasResult {
				t.Errorf("healthy file %s should carry a result", c.filename)
			}
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Sanity: a directory-level failure (ReadDir error) still returns the
// dir-level error — only per-file errors are downgraded to warnings.
// ──────────────────────────────────────────────────────────────────────────

func TestParseScreenshotsDir_DirLevelErrorStillReturned(t *testing.T) {
	_, err := parser.ParseScreenshotsDir(t.Context(), "/no/such/directory/recall-test", nil, nil)
	if err == nil {
		t.Fatal("ReadDir failure must propagate")
	}
}

// ──────────────────────────────────────────────────────────────────────────
// All-failing batch: the function returns an empty result map but no
// dir-level error — every per-file failure is a warning, not a batch abort.
// ──────────────────────────────────────────────────────────────────────────

func TestParseScreenshotsDir_AllFilesFailing(t *testing.T) {
	stubParseSingle(t, func(string) (*parser.MatchResult, error) {
		return nil, errors.New("everything is broken")
	})
	dir := makeFiles(t, "a.png", "b.png")
	results, err := parser.ParseScreenshotsDir(t.Context(), dir, nil, nil)
	if err != nil {
		t.Fatalf("all-failing batch must still return err=nil; got %v", err)
	}
	if len(results) != 0 {
		t.Errorf("all-failing batch must produce 0 results; got %d", len(results))
	}
}

// Cancellation contract: when ctx is cancelled, the loop returns its
// partial results + ctx.Err() at the next between-files boundary. Files
// already completed stay in the returned map; the rest are skipped. The
// stub's Cancel() call mid-batch lets us assert "stops at the boundary
// immediately after the file we cancelled in".
func TestParseScreenshotsDir_CtxCancelStopsBetweenFiles(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()

	var processed []string
	stubParseSingle(t, func(path string) (*parser.MatchResult, error) {
		processed = append(processed, filepath.Base(path))
		// Cancel mid-batch after the first file completes. The next
		// iteration's ctx.Err() check should fire and return.
		if len(processed) == 1 {
			cancel()
		}
		return &parser.MatchResult{}, nil
	})

	dir := makeFiles(t, "a.png", "b.png", "c.png", "d.png")
	results, err := parser.ParseScreenshotsDir(ctx, dir, nil, nil)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
	if len(processed) != 1 {
		t.Errorf("processed %d files, want exactly 1 before cancellation", len(processed))
	}
	if len(results) != 1 {
		t.Errorf("results = %d, want 1 (the completed file)", len(results))
	}
}

// Pre-cancelled ctx aborts before the first OCR shell-out — guards the
// common "user clicked Stop just as Parse fired" race.
func TestParseScreenshotsDir_PreCancelledCtxStopsImmediately(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	var called int
	stubParseSingle(t, func(string) (*parser.MatchResult, error) {
		called++
		return &parser.MatchResult{}, nil
	})

	dir := makeFiles(t, "a.png", "b.png")
	results, err := parser.ParseScreenshotsDir(ctx, dir, nil, nil)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
	if called != 0 {
		t.Errorf("parseSingleFunc called %d times, want 0 (ctx pre-cancelled)", called)
	}
	if len(results) != 0 {
		t.Errorf("results = %d, want 0", len(results))
	}
}
