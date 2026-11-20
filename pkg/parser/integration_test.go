package parser_test

import (
	"bytes"
	"encoding/json"
	"image"
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
//   - `screenshot_type` — the classification Classify(result)
//     returns. A drift here means either the parser stopped populating
//     a field the classifier keys off, OR Classify's thresholds
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
	imageDir, goldenDir := requireGoldenLane(t)
	update := os.Getenv("RECALL_FIXTURE_UPDATE") != ""

	for _, name := range fixtureImages(t, imageDir) {
		t.Run(name, func(t *testing.T) {
			imgPath := filepath.Join(imageDir, name)
			goldenPath := filepath.Join(goldenDir, name+".golden.json")
			assertGoldenFixture(t, imgPath, goldenPath, update)
		})
	}
}

// requireGoldenLane skips unless the corpus can run — not -short, and a real
// Tesseract binary — and resolves the fixture directories.
func requireGoldenLane(t *testing.T) (imageDir, goldenDir string) {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping golden-file parser tests in -short mode")
	}
	// Resolve Tesseract early — ParseScreenshot will fail with a generic
	// "not available" error otherwise, which masks the real problem.
	tp := parser.GetTesseractPath()
	if _, err := exec.LookPath(tp); err != nil {
		t.Skipf("tesseract not found at %q — install it or set RECALL_TESSERACT_PATH", tp)
	}
	return fixtureDirs()
}

// fixtureDirs resolves the image + golden directories. Images come from the
// recall-testdata submodule; their goldens live one level up in testdata/.
// Setting RECALL_FIXTURE_DIR alone collapses to single-dir mode (goldens
// beside the images) so the ad-hoc gen-goldens.sh workflow can parse an
// arbitrary capture folder.
func fixtureDirs() (imageDir, goldenDir string) {
	imageDir = os.Getenv("RECALL_FIXTURE_DIR")
	goldenDir = os.Getenv("RECALL_GOLDEN_DIR")
	switch {
	case imageDir == "":
		imageDir = "../../testdata/images"
		if goldenDir == "" {
			goldenDir = "../../testdata"
		}
	case goldenDir == "":
		goldenDir = imageDir
	}
	return imageDir, goldenDir
}

// fixtureImages lists the fixture image filenames in imageDir, skipping the
// whole test when the submodule isn't initialized (missing dir or no images).
func fixtureImages(t *testing.T, imageDir string) []string {
	t.Helper()
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
	return pngs
}

// assertGoldenFixture parses one fixture and byte-compares its snapshot
// against the sidecar golden — or rewrites the golden in update mode.
func assertGoldenFixture(t *testing.T, imgPath, goldenPath string, update bool) {
	t.Helper()
	got, err := parser.ParseScreenshot(imgPath)
	if err != nil {
		t.Fatalf("ParseScreenshot(%s): %v", imgPath, err)
	}
	gotJSON, err := json.MarshalIndent(goldenSnapshot{
		ScreenshotType: parser.Classify(got),
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
			imgPath, gotJSON, wantJSON)
	}
}

// goldenSnapshot is the JSON shape of each `<filename>.golden.json`.
// Two-field wrapper so each fixture asserts both the derived
// screenshot-type classification AND the parser output. `Result` is
// `any` because the concrete shape is one of *SummaryGolden /
// *TeamsGolden / *PersonalGolden / *RankGolden (or *MatchResult
// for the unknown fallback) — see ToGolden in pkg/parser/golden.go.
type goldenSnapshot struct {
	ScreenshotType parser.ScreenshotType `json:"screenshot_type"`
	Result         any                   `json:"result"`
}

// TestParseScreenshot_EvidenceCoversReadFields is the corpus-wide invariant
// behind field evidence, which the byte-for-byte goldens deliberately leave
// out: every field a fixture's golden carries a value for names the region of
// the screenshot it was read from, and that region lies inside the image.
func TestParseScreenshot_EvidenceCoversReadFields(t *testing.T) {
	imageDir, _ := requireGoldenLane(t)
	for _, name := range fixtureImages(t, imageDir) {
		t.Run(name, func(t *testing.T) {
			res, err := parser.ParseScreenshot(filepath.Join(imageDir, name))
			if err != nil {
				t.Fatalf("ParseScreenshot: %v", err)
			}
			assertEvidenceCoversReadFields(t, res)
		})
	}
}

func assertEvidenceCoversReadFields(t *testing.T, res *parser.MatchResult) {
	t.Helper()
	bounds := image.Rectangle{Max: res.ImageSize}
	if bounds.Empty() {
		t.Fatal("ImageSize was not recorded")
	}
	recorded := map[parser.FieldPath]image.Rectangle{}
	for _, ev := range res.Evidence {
		recorded[ev.Field] = ev.Rect
	}
	for _, field := range readFields[parser.Classify(res)](res) {
		rect, ok := recorded[field]
		switch {
		case !ok:
			t.Errorf("%s carries a value but no evidence region", field)
		case rect.Empty() || !rect.In(bounds):
			t.Errorf("%s evidence %v is not a region inside the %v image", field, rect, res.ImageSize)
		}
	}
}

// readFields lists, per screenshot type, the evidence-bearing fields its
// golden shape carries a non-zero value for. Derived fields (role, game_mode,
// playlist), play times, per-10-minute averages, SR changes, modifiers_raw and
// queue_type carry no evidence of their own, so they are not listed. The list
// is hand-kept: a field a parser starts reading is unchecked until it is added
// here.
var readFields = map[parser.ScreenshotType]func(*parser.MatchResult) []parser.FieldPath{
	parser.TypeSummary:   summaryReadFields,
	parser.TypeTeams:     teamsReadFields,
	parser.TypePersonal:  personalReadFields,
	parser.TypeRank:      rankReadFields,
	parser.TypeAllHeroes: noReadFields,
	parser.TypeHistory:   noReadFields,
	parser.TypeUnknown:   noReadFields,
}

func noReadFields(*parser.MatchResult) []parser.FieldPath { return nil }

// nonEmpty keeps the paths whose value is set.
func nonEmpty(fields map[string]bool) []parser.FieldPath {
	var out []parser.FieldPath
	for name, set := range fields {
		if set {
			out = append(out, parser.ScalarPath(name))
		}
	}
	return out
}

func heroPercentFields(res *parser.MatchResult) []parser.FieldPath {
	var out []parser.FieldPath
	for _, hp := range res.HeroesPlayed {
		if hp.PercentPlayed > 0 {
			out = append(out, parser.HeroPercentPath(hp.Hero))
		}
	}
	return out
}

func summaryReadFields(res *parser.MatchResult) []parser.FieldPath {
	return append(nonEmpty(map[string]bool{
		"map": res.Map != "", "hero": res.Hero != "",
		"eliminations": res.Eliminations != 0, "assists": res.Assists != 0, "deaths": res.Deaths != 0,
		"result": res.Result != "", "final_score": res.FinalScore != "", "date": res.Date != "",
		"finished_at": res.FinishedAt != "", "game_length": res.GameLength != "",
	}), heroPercentFields(res)...)
}

func teamsReadFields(res *parser.MatchResult) []parser.FieldPath {
	return nonEmpty(map[string]bool{
		"eliminations": res.Eliminations != 0, "assists": res.Assists != 0, "deaths": res.Deaths != 0,
		"damage": res.Damage != 0, "healing": res.Healing != 0, "mitigation": res.Mitigation != 0,
	})
}

func personalReadFields(res *parser.MatchResult) []parser.FieldPath {
	out := append(nonEmpty(map[string]bool{"hero": res.Hero != ""}), heroPercentFields(res)...)
	for _, hp := range res.HeroesPlayed {
		for key := range hp.Stats {
			out = append(out, parser.HeroStatPath(hp.Hero, key))
		}
	}
	return out
}

func rankReadFields(res *parser.MatchResult) []parser.FieldPath {
	out := nonEmpty(map[string]bool{
		"result": res.Result != "", "hero": res.Hero != "", "rank": res.Rank != "", "level": res.Level != 0,
		"rank_progress": res.RankProgress != nil, "change_percent": res.ChangePercent != nil,
		"modifiers": len(res.Modifiers) > 0, "rank_percentile": res.RankPercentile != nil,
	})
	for _, card := range res.SR {
		if card.SR != 0 {
			out = append(out, parser.SRPath(card.Hero))
		}
	}
	return out
}
