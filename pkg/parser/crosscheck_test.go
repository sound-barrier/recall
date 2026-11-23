package parser_test

import (
	"image"
	"image/color"
	"testing"

	"recall/pkg/glyphs"
	"recall/pkg/parser"
)

// ──────────────────────────────────────────────────────────────────────────
// Template cross-check: beside each stat number the parser OCRs, the
// reference templates read the same pixels, and what they read is
// recorded on that field's evidence. It is a second opinion only: the value
// OCR read stays the value the result holds, whatever the templates say.
//
// The boards below are painted at 2560x1440 (the SUMMARY one at 1280x720,
// to prove the layout scales) with the cards where a real screenshot puts
// them, so the locators run against the geometry they were calibrated on.
// Digits are blocky 5x7 bitmaps; the references are drawn from the same
// bitmaps.
// ──────────────────────────────────────────────────────────────────────────

var digitBitmaps = map[rune][7]string{
	'0': {".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."},
	'1': {"..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."},
	'2': {".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"},
	'3': {"#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."},
	'4': {"...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."},
	'5': {"#####", "#....", "####.", "....#", "....#", "#...#", ".###."},
	'6': {"..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."},
	'7': {"#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."},
	'8': {".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."},
	'9': {".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."},
}

// drawDigits paints text from its top-left corner at cell pixels per bitmap
// cell, one cell between glyphs, and returns the rectangle the glyphs span.
func drawDigits(img *image.RGBA, at image.Point, text string, cell int) image.Rectangle {
	x := at.X
	for _, r := range text {
		for row, line := range digitBitmaps[r] {
			for col, c := range line {
				if c == '#' {
					fillRect(img, image.Rect(x+col*cell, at.Y+row*cell, x+(col+1)*cell, at.Y+(row+1)*cell), white)
				}
			}
		}
		x += 6 * cell
	}
	return image.Rect(at.X, at.Y, x-cell, at.Y+7*cell)
}

// drawnReferences holds the ten bitmap digits and points the parser's
// cross-check at them.
func drawnReferences(t *testing.T) {
	t.Helper()
	var refs glyphs.References
	for d := '0'; d <= '9'; d++ {
		img := image.NewRGBA(image.Rect(0, 0, 40, 40))
		fillRect(img, img.Bounds(), black)
		drawDigits(img, image.Pt(8, 6), string(d), 4)
		if err := refs.AddDigit(int(d-'0'), img); err != nil {
			t.Fatal(err)
		}
	}
	useReferences(t, &refs)
}

func useReferences(t *testing.T, refs *glyphs.References) {
	t.Helper()
	t.Cleanup(parser.UseGlyphReferences(refs))
}

func evidenceFor(t *testing.T, res *parser.MatchResult, field parser.FieldPath) parser.FieldEvidence {
	t.Helper()
	for _, ev := range res.Evidence {
		if ev.Field == field {
			return ev
		}
	}
	t.Fatalf("no evidence for %s; have %+v", field, res.Evidence)
	return parser.FieldEvidence{}
}

func assertTemplateReads(t *testing.T, ev parser.FieldEvidence, want string) {
	t.Helper()
	if ev.Template == nil {
		t.Fatalf("%s: no template reading, want %q", ev.Field, want)
	}
	if ev.Template.Value != want {
		t.Errorf("%s: template read %q, want %q", ev.Field, ev.Template.Value, want)
	}
	if ev.Template.Score < glyphs.MinScore || ev.Template.Margin < glyphs.MinMargin {
		t.Errorf("%s: template reading %+v does not clear the accept rule it was recorded under", ev.Field, *ev.Template)
	}
}

// ── TEAMS ─────────────────────────────────────────────────────────────────

const (
	boardW, boardH = 2560, 1440
	rowTop, rowBot = 584, 666
	tableLeft      = 713
)

// realTeamsBoard is a 1440p scoreboard: the friendly table and the
// highlighted row with six stat cells, E drawn as 9.
func realTeamsBoard() image.Image {
	img := image.NewRGBA(image.Rect(0, 0, boardW, boardH))
	fillRect(img, img.Bounds(), black)
	fillRect(img, image.Rect(tableLeft, 300, 1846, 720), tableBlue)
	fillRect(img, image.Rect(tableLeft, rowTop, 1846, rowBot), highlightedBlue)
	fillRect(img, image.Rect(870, 600, 1000, 625), white)
	drawDigits(img, image.Pt(1240, 611), "9", 4)
	for _, x := range []int{1310, 1385, 1470, 1600, 1761} {
		fillRect(img, image.Rect(x, 611, x+24, 639), white)
	}
	return img
}

var teamsStatAnswers = map[string]string{
	"col_e_bin": "74", "col_a_bin": "9", "col_d_bin": "4",
	"col_dmg_bin": "13,432", "col_h_bin": "1,204", "col_mit_bin": "2,860",
}

func TestParseTeams_TemplateReadsEachStatCellBesideOCR(t *testing.T) {
	drawnReferences(t)
	stubOCRRegions(t, teamsStatAnswers)
	res, err := parser.ParseTeams(realTeamsBoard(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseTeams: %v", err)
	}
	assertTemplateReads(t, evidenceFor(t, res, parser.ScalarPath("eliminations")), "9")
	if res.Eliminations != 74 {
		t.Errorf("Eliminations = %d, want OCR's 74: the template is a cross-check, never the value", res.Eliminations)
	}
}

// A reference set without the digit has nothing to compare with, and "no
// match" must read as no reading, never as a guess.
func TestParseTeams_NoReferenceLeavesTheTemplateEmpty(t *testing.T) {
	useReferences(t, &glyphs.References{})
	stubOCRRegions(t, teamsStatAnswers)
	res, err := parser.ParseTeams(realTeamsBoard(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseTeams: %v", err)
	}
	if ev := evidenceFor(t, res, parser.ScalarPath("eliminations")); ev.Template != nil {
		t.Errorf("eliminations: template %+v recorded with no references to read against", *ev.Template)
	}
	for _, ev := range res.Evidence {
		if ev.Template != nil {
			t.Errorf("%s: template %+v recorded with no references", ev.Field, *ev.Template)
		}
	}
}

// ── SUMMARY ───────────────────────────────────────────────────────────────

// summaryBoard is a 720p SUMMARY tab: the first performance card's total
// drawn as eliminations above a smaller label.
func summaryBoard(eliminations string) (img image.Image, digits image.Rectangle) {
	canvas := image.NewRGBA(image.Rect(0, 0, 1280, 720))
	fillRect(canvas, canvas.Bounds(), color.RGBA{R: 20, G: 25, B: 45, A: 255})
	digits = drawDigits(canvas, image.Pt(600, 190), eliminations, 3)
	fillRect(canvas, image.Rect(600, 230, 700, 238), white)
	return canvas, digits
}

func TestParseSummary_TightensEachTotalToItsDigitsAndReadsThem(t *testing.T) {
	drawnReferences(t)
	seen := stubOCRRegions(t, map[string]string{
		"summary_perf": "74\nELIMINATIONS\nAVG PER 10 MIN: 12.97",
	})
	img, digits := summaryBoard("9")
	res, err := parser.ParseSummary(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseSummary: %v", err)
	}
	ev := evidenceFor(t, res, parser.ScalarPath("eliminations"))
	column := seen["summary_perf"]
	if !ev.Rect.In(column) || ev.Rect == column {
		t.Errorf("eliminations evidence %v should tighten inside the column OCR read, %v", ev.Rect, column)
	}
	if !digits.In(ev.Rect) {
		t.Errorf("eliminations evidence %v should hold the drawn total %v", ev.Rect, digits)
	}
	if ev.Rect.Dy() > 2*digits.Dy() {
		t.Errorf("eliminations evidence %v is not tight on the %dpx total %v", ev.Rect, digits.Dy(), digits)
	}
	assertTemplateReads(t, ev, "9")
	if res.Eliminations != 74 {
		t.Errorf("Eliminations = %d, want OCR's 74", res.Eliminations)
	}
}
