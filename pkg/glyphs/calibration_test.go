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
// has been corrected to it is stale.
var goldenMisreads = map[string]int{
	// The heavily compressed JPG SUMMARY card shows 9 eliminations (its 12.97
	// per 10 min over 06:56 agrees); OCR read 74.
	"ScreenShot_26-06-07_23-00-04-000.jpg eliminations": 9,
	// The card shows 0 eliminations, AVG PER 10 MIN: 0.00; OCR read 4.
	"Overwatch 2 Screenshot 2026.07.05 - 14.54.57.71.png eliminations": 0,
	// The card shows 3 eliminations, AVG PER 10 MIN: 2.63; OCR read 7.
	"Overwatch 2 Screenshot 2026.07.05 - 19.32.17.22.png eliminations": 3,
	// The card shows 1 DEATH, AVG PER 10 MIN: 1.87; OCR read 0. The summary
	// digit 1 is cut from this card, so it is read without that cut.
	"Overwatch 2 Screenshot 2026.07.30 - 23.08.52.32.png deaths": 1,
}

// agreementFloors are the fewest reads on each screen that must be accepted
// and agree with their golden, set two below the count measured when they
// were last ratcheted. A matcher change that leaves reads rejected or
// unscorable, or a lane that finds no goldens, falls below one.
var agreementFloors = map[string]int{
	"teams":   46,
	"summary": 78,
}

var teamsStatFields = []string{"eliminations", "assists", "deaths", "damage", "healing", "mitigation"}

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

func TestCalibration_DigitsAgainstGoldens(t *testing.T) {
	imageDir, goldenDir := requireCalibrationLane(t)
	refsFor := digitRefsLeavingOutSource(t)
	byScreen := map[string][]numberRead{}
	for _, name := range fixtureNames(t, imageDir) {
		golden, ok := readGolden(t, goldenDir, name)
		if !ok {
			continue
		}
		img := decodeFixture(t, filepath.Join(imageDir, name))
		refs := refsFor(name)
		switch golden.ScreenshotType {
		case "teams":
			byScreen["teams"] = append(byScreen["teams"], teamsReads(t, refs, img, imageDir, name, golden)...)
		case "summary":
			byScreen["summary"] = append(byScreen["summary"], summaryReads(refs, img, name, golden)...)
		}
	}
	for _, screen := range []string{"teams", "summary"} {
		reportNumberReads(t, screen, byScreen[screen])
	}
	checkGoldenMisreads(t, slices.Concat(byScreen["teams"], byScreen["summary"]))
}

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

// teamsReads scores every TEAMS stat cell the parser recorded a region for.
func teamsReads(t *testing.T, refs *glyphs.References, img image.Image, imageDir, name string, golden goldenFile) []numberRead {
	t.Helper()
	res, err := parser.ParseScreenshot(filepath.Join(imageDir, name))
	if err != nil {
		t.Fatalf("ParseScreenshot(%s): %v", name, err)
	}
	var reads []numberRead
	for _, ev := range res.Evidence {
		field, isStat := strings.CutPrefix(string(ev.Field), "data.")
		want, hasGolden := golden.Result[field].(float64)
		if !isStat || !hasGolden || !slices.Contains(teamsStatFields, field) {
			continue
		}
		got, scored := glyphs.ScoreNumber(refs, img, ev.Rect)
		reads = append(reads, numberRead{where: name + " " + field, golden: int(want), got: got, scored: scored})
	}
	return reads
}

// summaryReads scores the big total on each SUMMARY performance card. The
// parser records only the whole column for these, so the box is found here:
// the tallest band of ink rows in the card's number column is the total.
func summaryReads(refs *glyphs.References, img image.Image, name string, golden goldenFile) []numberRead {
	var reads []numberRead
	for card, field := range []string{"eliminations", "assists", "deaths"} {
		want, ok := golden.Result[field].(float64)
		if !ok {
			continue
		}
		box, found := tallestInkBand(img, perfNumberColumn(img.Bounds(), card))
		read := numberRead{where: name + " " + field, golden: int(want)}
		if found {
			read.got, read.scored = glyphs.ScoreNumber(refs, img, box)
		}
		reads = append(reads, read)
	}
	return reads
}

// perfNumberColumn is the column right of a SUMMARY performance card's icon,
// where its total, label and per-10-minute average stack, card 0 to 2 from
// the top, scaled from the 2560x1440 layout.
func perfNumberColumn(bounds image.Rectangle, card int) image.Rectangle {
	w, h := bounds.Dx(), bounds.Dy()
	top := 324 + 321*card
	return image.Rect(w*1170/2560, h*top/1440, w*1500/2560, h*(top+312)/1440)
}

// tallestInkBand is the tallest run of rows in column holding ink, the band
// the total sits in: its label and average are set smaller.
func tallestInkBand(img image.Image, column image.Rectangle) (image.Rectangle, bool) {
	g := glyphs.Luminance(img, column)
	best, start := image.Rectangle{}, -1
	for y := 0; y <= g.Height; y++ {
		if y < g.Height && rowHasInk(g, y) {
			if start < 0 {
				start = y
			}
			continue
		}
		if start >= 0 && y-start > best.Dy() {
			best = image.Rect(0, start, g.Width, y)
		}
		start = -1
	}
	return best.Add(column.Min).Inset(-2).Intersect(column), !best.Empty()
}

// inkCutoff mirrors the matcher's binarization: white text clears it, the
// card behind it does not.
const inkCutoff = 150

func rowHasInk(g glyphs.Grid, y int) bool {
	return slices.ContainsFunc(g.Pix[y*g.Width:(y+1)*g.Width], func(v float64) bool { return v > inkCutoff })
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
