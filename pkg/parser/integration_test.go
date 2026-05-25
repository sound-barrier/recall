package parser

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// TestParseScreenshot_GoldenFiles drives ParseScreenshot against real PNG
// fixtures and compares the result to a sidecar `<filename>.golden.json`.
//
// Defaults to scanning `pkg/parser/testdata/golden/`. Set
// RECALL_FIXTURE_DIR=/some/other/path to point at a different set
// (typically the maintainer's local screenshot dump while curating
// new fixtures).
//
// Layout:
//
//	$RECALL_FIXTURE_DIR/
//	  some-match.png
//	  some-match.png.golden.json   ← expected MatchResult, JSON-encoded
//	  other.png
//	  other.png.golden.json
//
// To regenerate goldens (e.g. after intentionally changing parser output),
// set RECALL_FIXTURE_UPDATE=1 alongside RECALL_FIXTURE_DIR — easier via
// the `make update-goldens` Makefile target. The test will rewrite each
// .golden.json with the current parse result instead of asserting
// equality. Review the diff before committing.
//
// The test is also skipped when:
//   - The `-short` test flag is set (CI's quick lint pass uses this).
//   - The configured Tesseract binary isn't on PATH.
//   - The directory has no .png/.jpg fixtures (the committed default
//     state — see testdata/golden/README.md).
//
// Adding a new fixture:
//  1. Drop the PNG into testdata/golden/ (or your $RECALL_FIXTURE_DIR).
//  2. `make update-goldens` to generate the `.golden.json`.
//  3. Eyeball the JSON, then commit both files.
func TestParseScreenshot_GoldenFiles(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping golden-file parser tests in -short mode")
	}

	dir := os.Getenv("RECALL_FIXTURE_DIR")
	if dir == "" {
		// Default to the committed fixture directory so `go test
		// ./pkg/parser/` picks up real fixtures without needing the
		// env var. The committed default is currently empty (see
		// testdata/golden/README.md for the privacy/licensing
		// rationale), so the test still skips cleanly on a fresh
		// checkout.
		dir = "testdata/golden"
	}

	// Resolve Tesseract early — ParseScreenshot will fail with a generic
	// "not available" error otherwise, which masks the real problem.
	tp := getTesseractPath()
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

			got, err := ParseScreenshot(imgPath)
			if err != nil {
				t.Fatalf("ParseScreenshot(%s): %v", imgPath, err)
			}

			if update {
				b, err := json.MarshalIndent(got, "", "  ")
				if err != nil {
					t.Fatalf("marshal golden: %v", err)
				}
				if err := os.WriteFile(goldenPath, append(b, '\n'), 0o644); err != nil {
					t.Fatalf("write golden: %v", err)
				}
				t.Logf("updated %s", goldenPath)
				return
			}

			rawWant, err := os.ReadFile(goldenPath)
			if os.IsNotExist(err) {
				t.Skipf("no golden file at %s (run with RECALL_FIXTURE_UPDATE=1 to create)", goldenPath)
			}
			if err != nil {
				t.Fatalf("read golden: %v", err)
			}

			var want MatchResult
			if err := json.Unmarshal(rawWant, &want); err != nil {
				t.Fatalf("unmarshal golden: %v", err)
			}

			if !reflect.DeepEqual(*got, want) {
				gotJSON, _ := json.MarshalIndent(got, "", "  ")
				wantJSON, _ := json.MarshalIndent(want, "", "  ")
				t.Errorf("parse mismatch for %s\n--- got ---\n%s\n--- want ---\n%s",
					name, gotJSON, wantJSON)
			}
		})
	}
}
