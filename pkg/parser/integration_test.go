package parser_test

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/parser"
)

// TestParseScreenshot_GoldenFiles drives ParseScreenshot against real PNG
// fixtures and compares both the parser output AND the screenshot-type
// classification to a sidecar `<filename>.golden.json`.
//
// Defaults to scanning the repo-root `testdata/` directory (resolved via
// the relative path `../../testdata` from this package's working
// directory, which `go test ./pkg/parser/` sets to `pkg/parser/`).
// Override with `RECALL_FIXTURE_DIR=/absolute/path` to point at a
// different set — useful when curating new fixtures from a private
// screenshot dump.
//
// Layout:
//
//	$RECALL_FIXTURE_DIR/
//	  some-match.png
//	  some-match.png.golden.json   ← {"screenshot_type": "...", "result": {MatchResult}}
//	  other.png
//	  other.png.golden.json
//
// Each golden captures TWO things:
//   - `screenshot_type` — the classification ScreenshotType(result)
//     returns. A drift here means either the parser stopped populating
//     a field the classifier keys off, OR ScreenshotType's thresholds
//     moved. Either is worth catching.
//   - `result` — the full parser.MatchResult struct.
//
// To regenerate goldens (e.g. after intentionally changing parser output),
// set RECALL_FIXTURE_UPDATE=1 alongside RECALL_FIXTURE_DIR — easier via
// the `task update-goldens` Taskfile task. The test will rewrite each
// .golden.json with the current parse result instead of asserting
// equality. Review the diff before committing.
//
// The test is also skipped when:
//   - The `-short` test flag is set (CI's quick lint pass uses this).
//   - The configured Tesseract binary isn't on PATH.
//   - The directory has no .png/.jpg fixtures.
//
// Adding a new fixture:
//  1. Drop the PNG into the repo-root `testdata/` directory.
//  2. `make update-goldens` to generate the `.golden.json`.
//  3. Eyeball the JSON, then commit both files.
func TestParseScreenshot_GoldenFiles(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping golden-file parser tests in -short mode")
	}

	dir := os.Getenv("RECALL_FIXTURE_DIR")
	if dir == "" {
		// Default to the repo-root testdata/ dir. `go test ./pkg/parser/`
		// runs with cwd = `pkg/parser/`, so `../../testdata` resolves
		// to the repo root. The committed fixture set lives there
		// (see testdata/README.md); when run against any other tree
		// the test skips cleanly if no PNG fixtures are present.
		dir = "../../testdata"
	}

	// Resolve Tesseract early — ParseScreenshot will fail with a generic
	// "not available" error otherwise, which masks the real problem.
	tp := parser.GetTesseractPath()
	if _, err := exec.LookPath(tp); err != nil {
		t.Skipf("tesseract not found at %q — install it or set RECALL_TESSERACT_PATH", tp)
	}

	update := os.Getenv("RECALL_FIXTURE_UPDATE") != ""

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read fixture dir %q: %v", dir, err)
	}
	var pngs []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext == ".png" || ext == ".jpg" || ext == ".jpeg" {
			pngs = append(pngs, e.Name())
		}
	}
	if len(pngs) == 0 {
		t.Skipf("no .png/.jpg fixtures found in %q", dir)
	}

	for _, name := range pngs {
		t.Run(name, func(t *testing.T) {
			imgPath := filepath.Join(dir, name)
			goldenPath := filepath.Join(dir, name+".golden.json")

			got, err := parser.ParseScreenshot(imgPath)
			if err != nil {
				t.Fatalf("ParseScreenshot(%s): %v", imgPath, err)
			}
			gotJSON, err := json.MarshalIndent(goldenSnapshot{
				ScreenshotType: parser.ScreenshotType(got),
				Result:         parser.ToGolden(got),
			}, "", "  ")
			if err != nil {
				t.Fatalf("marshal golden: %v", err)
			}
			gotJSON = append(gotJSON, '\n')

			if update {
				if err := os.WriteFile(goldenPath, gotJSON, 0o644); err != nil {
					t.Fatalf("write golden: %v", err)
				}
				t.Logf("updated %s", goldenPath)
				return
			}

			wantJSON, err := os.ReadFile(goldenPath)
			if os.IsNotExist(err) {
				t.Skipf("no golden file at %s (run with RECALL_FIXTURE_UPDATE=1 to create)", goldenPath)
			}
			if err != nil {
				t.Fatalf("read golden: %v", err)
			}

			// Byte-equal compare: marshal output is deterministic per
			// struct declaration order, so a stable parser produces a
			// byte-identical golden. Drift in either the parser or the
			// per-type golden shape (pkg/parser/golden.go) flips the
			// comparison loudly.
			if !bytes.Equal(gotJSON, wantJSON) {
				t.Errorf("parse mismatch for %s\n--- got ---\n%s\n--- want ---\n%s",
					name, gotJSON, wantJSON)
			}
		})
	}
}

// goldenSnapshot is the JSON shape of each `<filename>.golden.json`.
// Two-field wrapper so each fixture asserts both the derived
// screenshot-type classification AND the parser output. `Result` is
// `any` because the concrete shape is one of *SummaryGolden /
// *TeamsGolden / *PersonalGolden / *RankGolden (or *MatchResult
// for the unknown fallback) — see ToGolden in pkg/parser/golden.go.
type goldenSnapshot struct {
	ScreenshotType string `json:"screenshot_type"`
	Result         any    `json:"result"`
}
