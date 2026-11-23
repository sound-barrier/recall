package parser_test

import (
	"image"
	"image/color"
	"testing"

	"recall/pkg/parser"
)

// ── RANK ──────────────────────────────────────────────────────────────────

var (
	rankPanelBlue = color.RGBA{R: 37, G: 76, B: 159, A: 255}
	frameCyan     = color.RGBA{R: 0, G: 190, B: 255, A: 255}
)

// srCard is one card on a rank screen's SR panel, as rankBoard draws it.
type srCard struct {
	sr string
	// largeTouchingIcon sets the SR in the larger font some cards use, its
	// icon meeting the first digit.
	largeTouchingIcon bool
}

// drawnSRCard is where rankBoard put one card's parts.
type drawnSRCard struct {
	icon, digits image.Rectangle
}

// rankCardPitch is the distance between stacked SR cards at 1440p.
const rankCardPitch = 187

// rankBoard is a 1440p rank screen's SR panel, its cards stacked from the
// top one down. Each card is drawn where a real one sits: the hexagon's flat
// cyan sides around the hero's portrait, and left of it the hero name, then the
// rank icon, taller than the SR digits it leads, and a column of placement
// pips beside them.
func rankBoard(cards ...srCard) (image.Image, []drawnSRCard) {
	canvas := image.NewRGBA(image.Rect(0, 0, boardW, boardH))
	fillRect(canvas, canvas.Bounds(), rankPanelBlue)
	drawn := make([]drawnSRCard, len(cards))
	for i, card := range cards {
		drawn[i] = drawSRCard(canvas, 588+i*rankCardPitch, card)
	}
	return canvas, drawn
}

func drawSRCard(canvas *image.RGBA, top int, card srCard) drawnSRCard {
	fillRect(canvas, image.Rect(2347, top+29, 2354, top+105), frameCyan)
	fillRect(canvas, image.Rect(2474, top+29, 2481, top+105), frameCyan)
	fillRect(canvas, image.Rect(2244, top+23, 2332, top+39), white)
	if card.largeTouchingIcon {
		icon := image.Rect(2220, top+52, 2250, top+83)
		fillRect(canvas, icon, white)
		return drawnSRCard{icon: icon, digits: drawDigits(canvas, image.Pt(2250, top+54), card.sr, 4)}
	}
	icon := image.Rect(2200, top+53, 2228, top+83)
	fillRect(canvas, icon, white)
	for pip := top + 25; pip < top+125; pip += 20 {
		fillRect(canvas, image.Rect(2318, pip, 2331, pip+13), white)
	}
	return drawnSRCard{icon: icon, digits: drawDigits(canvas, image.Pt(2235, top+56), card.sr, 3)}
}

func TestParseRank_TemplateReadsEachSRCardsDigits(t *testing.T) {
	drawnReferences(t)
	seen := stubOCRRegions(t, map[string]string{"rank_sr": "ANA SR 2238"})
	img, drawn := rankBoard(srCard{sr: "2239"})
	res, err := parser.ParseRank(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	sr := evidenceFor(t, res, parser.SRPath("ana"))
	if !drawn[0].digits.In(sr.Rect) || !sr.Rect.In(seen["rank_sr"]) || sr.Rect.Overlaps(drawn[0].icon) {
		t.Errorf("SR evidence %v should hold the digits %v, clear of the icon %v, inside the panel %v",
			sr.Rect, drawn[0].digits, drawn[0].icon, seen["rank_sr"])
	}
	assertTemplateReads(t, sr, "2239")
	if got := res.SR[0]; got.Hero != "ana" || got.SR != 2238 {
		t.Errorf("SR[0] = %+v, want OCR's ana 2238", got)
	}
}

// An icon fused to the first digit cannot be told from it, so the SR keeps
// the panel OCR read it from, with no template reading, rather than a box
// that counts the icon as a digit.
func TestParseRank_IconTouchingTheDigitsLeavesTheSRUnchecked(t *testing.T) {
	drawnReferences(t)
	seen := stubOCRRegions(t, map[string]string{"rank_sr": "ANA SR 2683"})
	img, _ := rankBoard(srCard{sr: "2683", largeTouchingIcon: true})
	res, err := parser.ParseRank(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	sr := evidenceFor(t, res, parser.SRPath("ana"))
	if sr.Rect != seen["rank_sr"] || sr.Template != nil {
		t.Errorf("SR evidence %v template %+v, want the panel %v and no template", sr.Rect, sr.Template, seen["rank_sr"])
	}
}

// Cards pair with the SR list in reading order. A name OCR printed with an
// accent ("JÚNO") is still recognized but is not found where it was printed,
// so it sorts last and the list's order is no longer the cards' order: then
// no card is paired at all, rather than one hero's pixels checking another's
// readings.
func TestParseRank_UnplacedNameLeavesTheCardsUnpaired(t *testing.T) {
	drawnReferences(t)
	stubOCRRegions(t, map[string]string{"rank_sr": "JÚNO SR 2239\nANA SR 1804"})
	img, _ := rankBoard(srCard{sr: "2239"}, srCard{sr: "1804"})
	res, err := parser.ParseRank(img, t.TempDir())
	if err != nil {
		t.Fatalf("ParseRank: %v", err)
	}
	if len(res.SR) != 2 {
		t.Fatalf("SR = %+v, want both cards read", res.SR)
	}
	for _, card := range res.SR {
		field := parser.SRPath(card.Hero)
		if ev, ok := findEvidence(res, field); ok && ev.Template != nil {
			t.Errorf("%s paired with a template reading %+v though the cards' order is unknown", field, *ev.Template)
		}
	}
}

func findEvidence(res *parser.MatchResult, field parser.FieldPath) (parser.FieldEvidence, bool) {
	for _, ev := range res.Evidence {
		if ev.Field == field {
			return ev, true
		}
	}
	return parser.FieldEvidence{}, false
}
