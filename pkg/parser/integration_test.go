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
// Images default to the recall-testdata submodule (`../../testdata/images`
// from this package's working dir, which `go test ./pkg/parser/` sets to
// `pkg/parser/`); their goldens default to the parent `../../testdata`.
// RECALL_FIXTURE_DIR overrides the image dir (point it at a private
// screenshot dump to curate new fixtures); RECALL_GOLDEN_DIR overrides the
// golden dir. Setting RECALL_FIXTURE_DIR alone reads/writes goldens beside
// the images (single-dir mode — scripts/gen-goldens.sh relies on this).
//
// Layout (committed fixtures):
//
//	$RECALL_GOLDEN_DIR/            (testdata/)
//	  some-match.png.golden.json   ← {"screenshot_type": "...", "result": {MatchResult}}
//	  other.png.golden.json
//	$RECALL_FIXTURE_DIR/          (testdata/images/, the submodule)
//	  some-match.png
//	  other.png
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
//  1. Push the PNG to the recall-testdata repo and bump the submodule
//     (`git submodule update --remote testdata/images`).
//  2. `task update-goldens` to generate the `.golden.json` in testdata/.
//  3. Eyeball the JSON, then commit the submodule bump + golden together.
func TestParseScreenshot_GoldenFiles(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping golden-file parser tests in -short mode")
	}

	// Images come from the recall-testdata submodule; their goldens live
	// one level up in testdata/. Setting RECALL_FIXTURE_DIR alone collapses
	// to single-dir mode (goldens beside the images) so the ad-hoc
	// gen-goldens.sh workflow can parse an arbitrary capture folder.
	imageDir := os.Getenv("RECALL_FIXTURE_DIR")
	goldenDir := os.Getenv("RECALL_GOLDEN_DIR")
	switch {
	case imageDir == "":
		imageDir = "../../testdata/images"
		if goldenDir == "" {
			goldenDir = "../../testdata"
		}
	case goldenDir == "":
		goldenDir = imageDir
	}

	// Resolve Tesseract early — ParseScreenshot will fail with a generic
	// "not available" error otherwise, which masks the real problem.
	tp := parser.GetTesseractPath()
	if _, err := exec.LookPath(tp); err != nil {
		t.Skipf("tesseract not found at %q — install it or set RECALL_TESSERACT_PATH", tp)
	}

	update := os.Getenv("RECALL_FIXTURE_UPDATE") != ""

	entries, err := os.ReadDir(imageDir)
	if os.IsNotExist(err) {
		t.Skipf("fixture image dir %q missing — run 'task fetch-fixtures' to init the recall-testdata submodule", imageDir)
	}
	if err != nil {
		t.Fatalf("read fixture dir %q: %v", imageDir, err)
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
		t.Skipf("no .png/.jpg fixtures in %q — run 'task fetch-fixtures' to init the recall-testdata submodule", imageDir)
	}

	for _, name := range pngs {
		t.Run(name, func(t *testing.T) {
			imgPath := filepath.Join(imageDir, name)
			goldenPath := filepath.Join(goldenDir, name+".golden.json")

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
