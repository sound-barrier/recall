package parser

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// stubParseSingle swaps parseSingleFunc for the duration of the test.
// The fake returns a result/err based on the basename of the path, so
// tests can mix "good" and "bad" files in one directory without writing
// real PNG bytes.
func stubParseSingle(t *testing.T, fn func(path string) (*MatchResult, error)) {
	original := parseSingleFunc
	parseSingleFunc = fn
	t.Cleanup(func() { parseSingleFunc = original })
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
	stubParseSingle(t, func(path string) (*MatchResult, error) {
		switch filepath.Base(path) {
		case "good1.png":
			return &MatchResult{Map: "rialto"}, nil
		case "broken.png":
			return nil, errors.New("decoding image: invalid PNG signature")
		case "good2.png":
			return &MatchResult{Map: "aatlis"}, nil
		}
		return nil, nil
	})

	dir := makeFiles(t, "good1.png", "broken.png", "good2.png")

	results, err := ParseScreenshotsDir(dir, nil, nil)
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
	stubParseSingle(t, func(path string) (*MatchResult, error) {
		if filepath.Base(path) == "broken.png" {
			return nil, errors.New("boom")
		}
		return &MatchResult{}, nil
	})

	dir := makeFiles(t, "a.png", "broken.png", "c.png")

	type call struct {
		done, total int
		filename    string
		hasResult   bool
		err         error
	}
	var calls []call
	progress := func(done, total int, filename string, result *MatchResult, err error) {
		calls = append(calls, call{done, total, filename, result != nil, err})
	}

	if _, err := ParseScreenshotsDir(dir, nil, progress); err != nil {
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
	_, err := ParseScreenshotsDir("/no/such/directory/recall-test", nil, nil)
	if err == nil {
		t.Fatal("ReadDir failure must propagate")
	}
}

// ──────────────────────────────────────────────────────────────────────────
// All-failing batch: the function returns an empty result map but no
// dir-level error — every per-file failure is a warning, not a batch abort.
// ──────────────────────────────────────────────────────────────────────────

func TestParseScreenshotsDir_AllFilesFailing(t *testing.T) {
	stubParseSingle(t, func(string) (*MatchResult, error) {
		return nil, errors.New("everything is broken")
	})
	dir := makeFiles(t, "a.png", "b.png")
	results, err := ParseScreenshotsDir(dir, nil, nil)
	if err != nil {
		t.Fatalf("all-failing batch must still return err=nil; got %v", err)
	}
	if len(results) != 0 {
		t.Errorf("all-failing batch must produce 0 results; got %d", len(results))
	}
}
