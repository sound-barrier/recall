package crosscheck_test

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"recall/pkg/correlate"
	"recall/pkg/crosscheck"
	"recall/pkg/match"
	"recall/pkg/parser"
	"recall/pkg/tesseract"
)

// expectedCorpusFlags are the flags the corpus is allowed to raise, each one
// checked against the screenshot's pixels, keyed as corpusFlagKey spells
// them. It is empty: since the SUMMARY cards were read apart from their
// icons, every golden reading agrees with every other.
var expectedCorpusFlags = map[string]string{}

// corpusShot is one corpus screenshot: its golden reading (which the golden
// lane pins to the parser's output) beside the evidence a real parse records,
// which the goldens leave out.
type corpusShot struct {
	name     string
	at       time.Time
	timed    bool
	typ      parser.ScreenshotType
	data     parser.MatchResult
	evidence []parser.FieldEvidence
}

// TestCrosscheck_CorpusFalsePositives runs every check over every corpus
// screenshot alone, and over the corpus grouped into matches. The goldens are
// the readings the user's history holds, so any flag here is one a real
// player would see; it must be justified by the pixels and listed, or it is a
// false positive.
func TestCrosscheck_CorpusFalsePositives(t *testing.T) {
	shots := loadCorpus(t)
	got := map[string]string{}
	for _, shot := range shots {
		addCorpusFlags(got, crosscheck.Flags(groupOfShots(shot)))
	}
	for _, game := range corpusMatches(shots) {
		addCorpusFlags(got, crosscheck.Flags(groupOfShots(game...)))
	}
	for key, readings := range got {
		if _, ok := expectedCorpusFlags[key]; !ok {
			t.Errorf("unexpected flag %s; readings %s", key, readings)
		}
	}
	for key := range expectedCorpusFlags {
		if _, ok := got[key]; !ok {
			t.Errorf("expected flag %s no longer fires: drop it from expectedCorpusFlags", key)
		}
	}
	t.Logf("%d screenshots, %d matches, %d flags", len(shots), len(corpusMatches(shots)), len(got))
}

func addCorpusFlags(into map[string]string, flags []match.FieldFlag) {
	for _, f := range flags {
		readings := make([]string, 0, len(f.Readings))
		for _, r := range f.Readings {
			readings = append(readings, r.SourceFile+" "+string(r.Origin)+"="+r.Value)
		}
		into[corpusFlagKey(f)] = strings.Join(readings, "; ")
	}
}

func corpusFlagKey(f match.FieldFlag) string {
	files := make([]string, 0, len(f.Readings))
	for _, r := range f.Readings {
		if !slices.Contains(files, r.SourceFile) {
			files = append(files, r.SourceFile)
		}
	}
	checks := make([]string, 0, len(f.Checks))
	for _, c := range f.Checks {
		checks = append(checks, string(c))
	}
	return strings.Join(files, " + ") + " | " + string(f.Field) + " | " + strings.Join(checks, ",")
}

func groupOfShots(shots ...corpusShot) crosscheck.Group {
	var merged parser.MatchResult
	sources := make([]crosscheck.Source, 0, len(shots))
	for _, s := range shots {
		correlate.MergeMatchResult(&merged, &s.data)
		sources = append(sources, crosscheck.Source{File: s.name, Type: s.typ, Data: s.data, Evidence: s.evidence})
	}
	return crosscheck.Group{Merged: merged, Sources: sources}
}

// corpusMatches groups the timed screenshots into matches the way a capture
// session falls: a match's screens are taken within two minutes of each
// other, and a second SUMMARY, scoreboard or rank screen starts the next
// match (two SUMMARY screens seconds apart are two matches read off the
// history). An approximation of the correlator, close enough that a flag it raises is
// worth a look at the pixels.
func corpusMatches(shots []corpusShot) [][]corpusShot {
	timed := slices.DeleteFunc(slices.Clone(shots), func(s corpusShot) bool { return !s.timed })
	slices.SortFunc(timed, func(a, b corpusShot) int { return a.at.Compare(b.at) })
	var games [][]corpusShot
	for _, s := range timed {
		if n := len(games); n > 0 && joinsMatch(games[n-1], s) {
			games[n-1] = append(games[n-1], s)
			continue
		}
		games = append(games, []corpusShot{s})
	}
	return slices.DeleteFunc(games, func(g []corpusShot) bool { return len(g) < 2 })
}

func joinsMatch(game []corpusShot, s corpusShot) bool {
	if s.at.Sub(game[len(game)-1].at) > 2*time.Minute {
		return false
	}
	once := []parser.ScreenshotType{parser.TypeSummary, parser.TypeTeams, parser.TypeRank}
	return !slices.Contains(once, s.typ) || !slices.ContainsFunc(game, func(g corpusShot) bool { return g.typ == s.typ })
}

func loadCorpus(t *testing.T) []corpusShot {
	t.Helper()
	imageDir, goldenDir := requireCorpusLane(t)
	entries, err := os.ReadDir(imageDir)
	if err != nil {
		t.Fatal(err)
	}
	var shots []corpusShot
	for _, e := range entries {
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if e.IsDir() || (ext != ".png" && ext != ".jpg") {
			continue
		}
		shots = append(shots, loadShot(t, imageDir, goldenDir, e.Name()))
	}
	if len(shots) == 0 {
		t.Fatalf("no fixtures in %s", imageDir)
	}
	return shots
}

func loadShot(t *testing.T, imageDir, goldenDir, name string) corpusShot {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(goldenDir, name+".golden.json"))
	if err != nil {
		t.Fatalf("golden for %s: %v", name, err)
	}
	var golden struct {
		ScreenshotType parser.ScreenshotType `json:"screenshot_type"`
		Result         parser.MatchResult    `json:"result"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatalf("golden for %s: %v", name, err)
	}
	parsed, err := parser.ParseScreenshot(filepath.Join(imageDir, name))
	if err != nil {
		t.Fatalf("ParseScreenshot(%s): %v", name, err)
	}
	at, timed := correlate.ParseFilenameTimestamp(name)
	return corpusShot{name: name, at: at, timed: timed, typ: golden.ScreenshotType, data: golden.Result, evidence: parsed.Evidence}
}

// requireCorpusLane gates the corpus run to golden-corpus.yml: not -short, a
// real Tesseract for the evidence, and the corpus. Directories resolve as the
// parser golden lane's do: RECALL_FIXTURE_DIR set alone puts the goldens
// beside the images.
func requireCorpusLane(t *testing.T) (imageDir, goldenDir string) {
	t.Helper()
	if testing.Short() {
		t.Skip("the corpus cross-check runs in the golden lane, not -short")
	}
	if _, err := exec.LookPath(tesseract.Path()); err != nil {
		t.Skipf("tesseract not found at %q — the evidence comes from a real parse", tesseract.Path())
	}
	imageDir = filepath.Join("..", "..", "testdata", "images")
	if dir := os.Getenv("RECALL_FIXTURE_DIR"); dir != "" {
		imageDir = dir
	}
	if entries, err := os.ReadDir(imageDir); err != nil || len(entries) == 0 {
		t.Skipf("fixture image dir %q missing or empty — run 'task fetch-fixtures'", imageDir)
	}
	goldenDir = os.Getenv("RECALL_GOLDEN_DIR")
	switch {
	case goldenDir != "":
	case os.Getenv("RECALL_FIXTURE_DIR") != "":
		goldenDir = imageDir
	default:
		goldenDir = filepath.Join("..", "..", "testdata")
	}
	return imageDir, goldenDir
}
