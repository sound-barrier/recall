package glyphs_test

import (
	"encoding/json"
	"fmt"
	"image"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"recall/pkg/glyphs"
	"recall/pkg/parser"
	"recall/pkg/tesseract"
)

// The calibration tests run the references over the whole corpus and report
// how their reads compare with the goldens: how often they agree, and how the
// scores and margins of agreeing and disagreeing reads fall against the accept
// rule. They fail when an accepted read disagrees with a golden the pixels
// confirm, since that is the one outcome a cross-check cannot have, and when
// fewer reads agree than a screen's floor, since a matcher that rejects
// everything would otherwise pass. The goldens are OCR output, so a
// disagreement can be a golden's misread; the known ones are listed, each
// checked against the screenshot by eye.

// goldenMisreads are golden values the screenshot's own pixels refute, keyed
// by fixture and field, each mapped to the value the pixels show. The
// templates must read exactly that value, accepted, and an entry whose golden
// has been corrected to it is stale. It is empty since the SUMMARY cards were
// read apart from their icons, which corrected the four it held.
var goldenMisreads = map[string]int{}

// agreementFloors are the fewest reads on each screen that must be accepted
// and agree with their golden, set two below the count measured when they
// were last ratcheted. A matcher change that leaves reads rejected or
// unscorable, a locator that drifts off the value, or a lane that finds no
// goldens, falls below one.
var agreementFloors = map[string]int{
	"teams":   46,
	"summary": 82,
	"rank":    60,
}

// numberRead is one template read beside the value its golden holds.
type numberRead struct {
	where  string
	golden int
	got    glyphs.NumberReading
	scored bool
}

func (r numberRead) accepted() bool {
	return r.scored && r.got.Score >= glyphs.MinScore && r.got.Margin >= glyphs.MinMargin
}

func (r numberRead) agrees() bool { return r.scored && r.got.Value == r.golden }

// TestCalibration_DigitsAgainstGoldens scores, on every TEAMS, SUMMARY and
// rank screenshot, each number region the parser recorded evidence for: the
// TEAMS stat cells, the SUMMARY totals and the rank SR digits.
func TestCalibration_DigitsAgainstGoldens(t *testing.T) {
	imageDir, goldenDir := requireCalibrationLane(t)
	refsFor := digitRefsLeavingOutSource(t)
	byScreen := map[string][]numberRead{}
	for _, name := range fixtureNames(t, imageDir) {
		golden, ok := readGolden(t, goldenDir, name)
		if !ok || !slices.Contains(numberScreens, golden.ScreenshotType) {
			continue
		}
		img := decodeFixture(t, filepath.Join(imageDir, name))
		res := parseFixture(t, imageDir, name)
		byScreen[golden.ScreenshotType] = append(byScreen[golden.ScreenshotType], numberReads(refsFor(name), img, name, golden, res)...)
	}
	for _, screen := range numberScreens {
		reportNumberReads(t, screen, byScreen[screen])
	}
	checkGoldenMisreads(t, slices.Concat(byScreen["teams"], byScreen["summary"], byScreen["rank"]))
}

var numberScreens = []string{"teams", "summary", "rank"}

// digitRefsLeavingOutSource returns the references to read each fixture
// with: the embedded set, less any digit cut from that fixture, since a glyph
// read against its own cut scores 1 and proves nothing.
func digitRefsLeavingOutSource(t *testing.T) func(fixture string) *glyphs.References {
	t.Helper()
	embedded := loadEmbeddedRefs(t)
	entries := loadManifest(t)
	paths := refPaths(entries)
	return func(fixture string) *glyphs.References {
		cutFrom := func(e refEntry) bool { return e.Source == fixture }
		if !slices.ContainsFunc(entries, cutFrom) {
			return embedded
		}
		var refs glyphs.References
		for i, e := range entries {
			if cutFrom(e) {
				continue
			}
			addDigitCut(t, &refs, e, paths[i])
		}
		return &refs
	}
}

func addDigitCut(t *testing.T, refs *glyphs.References, e refEntry, path string) {
	t.Helper()
	digit, err := strconv.Atoi(e.Label)
	if err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	if err := refs.AddDigit(digit, decodeRef(t, path)); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
}

// numberReads scores every number region the parser recorded evidence for
// whose golden holds a value: the region is the parser's own, so this
// measures the cross-check exactly as a parse runs it.
func numberReads(refs *glyphs.References, img image.Image, name string, golden goldenFile, res *parser.MatchResult) []numberRead {
	var reads []numberRead
	for _, ev := range res.Evidence {
		want, ok := golden.number(ev.Field)
		if !ok {
			continue
		}
		got, scored := glyphs.ScoreNumber(refs, img, ev.Rect)
		where := name + " " + strings.TrimPrefix(string(ev.Field), "data.")
		reads = append(reads, numberRead{where: where, golden: want, got: got, scored: scored})
	}
	return reads
}

// numberFields are the top-level fields the templates read digits for.
var numberFields = []string{"eliminations", "assists", "deaths", "damage", "healing", "mitigation"}

// number is the golden's value for a number field the templates read: a
// TEAMS or SUMMARY stat, or a rank card's SR.
func (g goldenFile) number(field parser.FieldPath) (int, bool) {
	name, _ := strings.CutPrefix(string(field), "data.")
	if slices.Contains(numberFields, name) {
		value, ok := g.Result[name].(float64)
		return int(value), ok
	}
	for _, card := range g.srCards() {
		if parser.SRPath(card.hero) == field {
			return card.sr, true
		}
	}
	return 0, false
}

type goldenSRCard struct {
	hero string
	sr   int
}

// srCards is the golden's rank SR cards, top to bottom.
func (g goldenFile) srCards() []goldenSRCard {
	entries, _ := g.Result["sr"].([]any)
	var cards []goldenSRCard
	for _, entry := range entries {
		fields, _ := entry.(map[string]any)
		hero, _ := fields["hero"].(string)
		sr, _ := fields["sr"].(float64)
		cards = append(cards, goldenSRCard{hero: hero, sr: int(sr)})
	}
	return cards
}

func parseFixture(t *testing.T, imageDir, name string) *parser.MatchResult {
	t.Helper()
	res, err := parser.ParseScreenshot(filepath.Join(imageDir, name))
	if err != nil {
		t.Fatalf("ParseScreenshot(%s): %v", name, err)
	}
	return res
}

func reportNumberReads(t *testing.T, screen string, reads []numberRead) {
	t.Helper()
	var agreeing, disagreeing []numberRead
	unscored := 0
	for _, r := range reads {
		switch {
		case !r.scored:
			unscored++
		case r.agrees():
			agreeing = append(agreeing, r)
		default:
			disagreeing = append(disagreeing, r)
		}
	}
	accepted := countWhere(agreeing, numberRead.accepted)
	t.Logf("%s: %d reads; %d agree with the golden (%d accepted, %.1f%% of all reads), %d disagree, %d unscorable (no glyphs, fused glyphs, or punctuation)",
		screen, len(reads), len(agreeing), accepted, percent(accepted, len(reads)), len(disagreeing), unscored)
	t.Logf("%s agreeing: score %s; margin %s", screen,
		distribution(agreeing, func(r numberRead) float64 { return r.got.Score }),
		distribution(agreeing, func(r numberRead) float64 { return r.got.Margin }))
	for _, r := range disagreeing {
		reportNumberDisagreement(t, screen, r)
	}
	requireAgreementFloor(t, screen, accepted)
}

// reportNumberDisagreement fails an accepted read that disagrees with its
// golden, unless the golden is a known misread, which checkGoldenMisreads
// holds to the value its pixels show.
func reportNumberDisagreement(t *testing.T, screen string, r numberRead) {
	t.Helper()
	t.Logf("%s disagreeing: %s golden %d, read %d (score %.3f, margin %.3f, accepted %v)",
		screen, r.where, r.golden, r.got.Value, r.got.Score, r.got.Margin, r.accepted())
	if _, known := goldenMisreads[r.where]; r.accepted() && !known {
		t.Errorf("%s: an accepted template read (%d) disagrees with golden %d", r.where, r.got.Value, r.golden)
	}
}

// checkGoldenMisreads holds each known misread to the value its pixels show:
// the templates must read it, accepted, and the golden must still be wrong.
func checkGoldenMisreads(t *testing.T, reads []numberRead) {
	t.Helper()
	found := map[string]bool{}
	for _, r := range reads {
		shows, known := goldenMisreads[r.where]
		if !known {
			continue
		}
		found[r.where] = true
		switch {
		case r.golden == shows:
			t.Errorf("%s: the golden now holds %d, the value the pixels show; drop its goldenMisreads entry", r.where, shows)
		case !r.accepted() || r.got.Value != shows:
			t.Errorf("%s: the pixels show %d, the templates read %d (scored %v, accepted %v)",
				r.where, shows, r.got.Value, r.scored, r.accepted())
		}
	}
	for where := range goldenMisreads {
		if !found[where] {
			t.Errorf("%s: goldenMisreads names a read the calibration never made", where)
		}
	}
}

func requireAgreementFloor(t *testing.T, screen string, accepted int) {
	t.Helper()
	if floor := agreementFloors[screen]; accepted < floor {
		t.Errorf("%s: %d reads accepted and agree with their golden, below the floor of %d", screen, accepted, floor)
	}
}

func countWhere(reads []numberRead, keep func(numberRead) bool) int {
	n := 0
	for _, r := range reads {
		if keep(r) {
			n++
		}
	}
	return n
}

func percent(n, of int) float64 {
	if of == 0 {
		return 0
	}
	return 100 * float64(n) / float64(of)
}

// distribution summarizes the values reads take: min, 5th, 50th percentile.
func distribution[T any](items []T, value func(T) float64) string {
	if len(items) == 0 {
		return "n/a"
	}
	values := make([]float64, len(items))
	for i, item := range items {
		values[i] = value(item)
	}
	slices.Sort(values)
	at := func(p int) float64 { return values[(len(values)-1)*p/100] }
	return fmt.Sprintf("min %.3f p5 %.3f p50 %.3f", values[0], at(5), at(50))
}

// goldenFile is the part of a parser golden the calibration compares with.
type goldenFile struct {
	ScreenshotType string         `json:"screenshot_type"`
	Result         map[string]any `json:"result"`
}

func readGolden(t *testing.T, goldenDir, name string) (goldenFile, bool) {
	t.Helper()
	file := filepath.Join(goldenDir, name+".golden.json")
	data, err := os.ReadFile(file)
	if os.IsNotExist(err) {
		t.Errorf("no golden at %s: the calibration cannot score %s", file, name)
		return goldenFile{}, false
	}
	if err != nil {
		t.Fatal(err)
	}
	var golden goldenFile
	if err := json.Unmarshal(data, &golden); err != nil {
		t.Fatalf("%s golden: %v", name, err)
	}
	return golden, true
}

func loadEmbeddedRefs(t *testing.T) *glyphs.References {
	t.Helper()
	refs, err := glyphs.LoadEmbedded()
	if err != nil {
		t.Fatal(err)
	}
	return refs
}

func fixtureNames(t *testing.T, imageDir string) []string {
	t.Helper()
	entries, err := os.ReadDir(imageDir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if !e.IsDir() && (ext == ".png" || ext == ".jpg") {
			names = append(names, e.Name())
		}
	}
	return names
}

// requireCalibrationLane gates the calibration to golden-corpus.yml: not
// -short, a real Tesseract for the TEAMS cell regions, and the corpus. Its
// directories resolve as the parser golden lane's do: RECALL_FIXTURE_DIR set
// alone puts the goldens beside the images.
func requireCalibrationLane(t *testing.T) (imageDir, goldenDir string) {
	t.Helper()
	if testing.Short() {
		t.Skip("corpus calibration runs in the golden lane, not -short")
	}
	if _, err := exec.LookPath(tesseract.Path()); err != nil {
		t.Skipf("tesseract not found at %q — the TEAMS cell regions come from a real parse", tesseract.Path())
	}
	imageDir = requireFixtureImages(t)
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
