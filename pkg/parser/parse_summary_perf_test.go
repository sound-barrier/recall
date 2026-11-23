package parser_test

import (
	"image"
	"strings"
	"testing"

	"recall/pkg/parser"
)

// ──────────────────────────────────────────────────────────────────────────
// SUMMARY Total Performance — three cards, each an icon beside a column that
// stacks the total, its label and the per-10-minute average. The texts below
// are what Tesseract returned on real fixtures, so the stub answers each
// region the way the binary answered the pixels in it.
// ──────────────────────────────────────────────────────────────────────────

// perfScreen is the Total Performance column of a 2560x1440 SUMMARY tab, its
// cards top to bottom.
type perfScreen [3]perfCard

// perfCard is what Tesseract reads off one card: icon where a region takes in
// the card's icon, digits on a digits-only pass over the column right of it,
// and text on any other pass there.
type perfCard struct{ icon, text, digits string }

// The 1440p geometry of the cards: each spans perfCardBand(k), and its icon
// lies left of perfIconRight.
const perfIconRight = 1170

func perfCardBand(card int) image.Rectangle {
	top := 324 + 321*card
	return image.Rect(780, top, 1580, top+312)
}

// read answers one OCR region: every card the region reaches contributes its
// lines, top to bottom, with the icon's misread ahead of them when the region
// takes in the icon.
func (s perfScreen) read(region image.Rectangle, digitsOnly bool) string {
	var lines []string
	for k, card := range s {
		if !region.Overlaps(perfCardBand(k)) {
			continue
		}
		if region.Min.X < perfIconRight && card.icon != "" {
			lines = append(lines, card.icon)
		}
		if digitsOnly {
			lines = append(lines, card.digits)
		} else {
			lines = append(lines, card.text)
		}
	}
	return strings.Join(lines, "\n")
}

// stubPerfScreen answers every OCR call from screen and returns the SUMMARY
// tab it stands for.
func stubPerfScreen(t *testing.T, screen perfScreen) image.Image {
	t.Helper()
	original := *parser.RunTesseractFunc
	*parser.RunTesseractFunc = func(_ image.Image, spec parser.OCRSpec) (string, error) { //nolint:unparam // signature fixed by RunTesseractFunc
		return screen.read(parser.SpecRect(spec), parser.SpecWhitelist(spec) != ""), nil
	}
	t.Cleanup(func() { *parser.RunTesseractFunc = original })
	return image.NewRGBA(image.Rect(0, 0, 2560, 1440))
}

func parsePerfScreen(t *testing.T, screen perfScreen) *parser.MatchResult {
	t.Helper()
	res, err := parser.ParseSummary(stubPerfScreen(t, screen), t.TempDir())
	if err != nil {
		t.Fatalf("ParseSummary: %v", err)
	}
	if res.Performance == nil {
		t.Fatal("performance cards were not parsed")
	}
	return res
}

// card builds a perfCard whose plain and digits-only passes agree on total.
func card(icon, total, label, avg string) perfCard {
	return perfCard{
		icon:   icon,
		text:   total + "\n" + label + "\nAVG PER 10 MIN: " + avg,
		digits: total + "\n10" + avg,
	}
}

var (
	assistsCard = card("Ww", "10", "ASSISTS", "14.41")
	deathsCard  = card("", "5", "DEATHS", "7.21")
)

// The crossed-swords ELIMINATIONS icon's upper blade reads as a digit line of
// its own, and a pass that takes in the icon keeps it ahead of the real
// total. Picking the larger of the two kept the blade whenever the total was
// smaller than what it read as: the compressed JPG read 74 for 9, and two
// PNG cards read 4 for 0 and 7 for 3.
func TestParseSummary_TheEliminationsIconIsNotReadAsTheTotal(t *testing.T) {
	cases := []struct {
		fixture, blade, total, avg string
		want                       int
	}{
		{"ScreenShot_26-06-07_23-00-04-000.jpg", "74", "9", "12.97", 9},
		{"2026.07.05 - 14.54.57.71", "4", "0", "0.00", 0},
		{"2026.07.05 - 19.32.17.22", "7", "3", "2.63", 3},
	}
	for _, c := range cases {
		t.Run(c.fixture, func(t *testing.T) {
			res := parsePerfScreen(t, perfScreen{
				card("‘\n"+c.blade+"\nS 4", c.total, "ELIMINATIONS", c.avg),
				assistsCard, deathsCard,
			})
			if res.Eliminations != c.want || res.Performance.Eliminations.Total != c.want {
				t.Errorf("eliminations = %d (card %d), want %d", res.Eliminations, res.Performance.Eliminations.Total, c.want)
			}
			if res.Assists != 10 || res.Deaths != 5 {
				t.Errorf("assists/deaths = %d/%d, want 10/5", res.Assists, res.Deaths)
			}
		})
	}
}

// The OW font's 1 reads as "T" on a plain pass, which is no digit at all, so
// the card's total was lost and deaths stayed 0. A digits-only pass over the
// same pixels has no T to offer and reads the 1 (2026.07.30 - 23.08.52.32).
func TestParseSummary_ADeathTotalReadAsALetterIsRecovered(t *testing.T) {
	res := parsePerfScreen(t, perfScreen{
		card("", "10", "ELIMINATIONS", "18.74"),
		card("", "10", "ASSISTS", "18.74"),
		{text: "T\nDEATH\nAVG PER 10 MIN: 1.87", digits: "1\n101.87"},
	})
	if res.Deaths != 1 || res.Performance.Deaths.Total != 1 {
		t.Errorf("deaths = %d (card %d), want 1", res.Deaths, res.Performance.Deaths.Total)
	}
	if res.Performance.Deaths.AvgPer10Min != 1.87 {
		t.Errorf("deaths avg = %v, want 1.87", res.Performance.Deaths.AvgPer10Min)
	}
}

// Each card's total and average come from that card alone, and the flat E/A/D
// fields mirror the totals the dossier reads. The "10" in "AVG PER 10 MIN" is
// never the average.
func TestParseSummary_ReadsEachPerformanceCardsTotalAndAverage(t *testing.T) {
	res := parsePerfScreen(t, perfScreen{
		card("", "17", "ELIMINATIONS", "14.5"),
		card("", "16", "ASSISTS", "13.0"),
		card("", "11", "DEATHS", "9.1"),
	})
	assertPerfStat(t, "eliminations", res.Performance.Eliminations, 17, 14.5)
	assertPerfStat(t, "assists", res.Performance.Assists, 16, 13.0)
	assertPerfStat(t, "deaths", res.Performance.Deaths, 11, 9.1)
	if res.Eliminations != 17 || res.Assists != 16 || res.Deaths != 11 {
		t.Errorf("flat E/A/D = %d/%d/%d, want 17/16/11", res.Eliminations, res.Assists, res.Deaths)
	}
}

func assertPerfStat(t *testing.T, label string, got parser.PerformanceStat, wantTotal int, wantAvg float64) {
	t.Helper()
	if got.Total != wantTotal || got.AvgPer10Min != wantAvg {
		t.Errorf("%s: %+v, want total=%d avg=%v", label, got, wantTotal, wantAvg)
	}
}

// A card whose AVG line went unread has no average; the next card's is not
// its to borrow, however close it sits in a pass over the whole column.
func TestParseSummary_ACardWithoutItsAverageDoesNotTakeTheNextCards(t *testing.T) {
	res := parsePerfScreen(t, perfScreen{
		{text: "9\nELIMINATIONS", digits: "9"},
		assistsCard, deathsCard,
	})
	assertPerfStat(t, "eliminations", res.Performance.Eliminations, 9, 0)
}

// The total is the first line a digits-only pass reads: the card stacks the
// total above everything else, and the digits below it — the "10" of "AVG
// PER 10 MIN" run into the average — are larger without being the total.
func TestParseSummary_TheTotalIsTheCardsTopDigitLine(t *testing.T) {
	res := parsePerfScreen(t, perfScreen{
		{text: "3\nELIMINATIONS\nAVG PER 10 MIN: 2.63", digits: "3\n102.63"},
		assistsCard, deathsCard,
	})
	assertPerfStat(t, "eliminations", res.Performance.Eliminations, 3, 2.63)
}

// "11" scans as "1]" on a plain pass — the italic numeral's trailing stroke
// degrades into a bracket — beside an icon that reads "4". The digits-only
// pass reads the 11 (00.28.29.05, the Hollywood open-queue SUMMARY).
func TestParseSummary_ABracketMangledTotalReadsAsDigits(t *testing.T) {
	res := parsePerfScreen(t, perfScreen{
		{icon: "4\nS 4", text: "1]\nELIMINATIONS\nAVG PER 10 MIN: 14.38", digits: "11\n1014.38"},
		card("W", "12", "ASSISTS", "15.69"),
		card("", "3", "DEATHS", "3.92"),
	})
	if res.Eliminations != 11 || res.Assists != 12 || res.Deaths != 3 {
		t.Errorf("E/A/D = %d/%d/%d, want 11/12/3", res.Eliminations, res.Assists, res.Deaths)
	}
}

// A card is read beside its own label: without it the column is not the
// card the parser takes it for, and its digits name no stat.
func TestParseSummary_ACardWhoseLabelWentUnreadIsNotRead(t *testing.T) {
	res := parsePerfScreen(t, perfScreen{
		card("", "17", "ELIMINATIONS", "14.5"),
		{text: "16\nAVG PER 10 MIN: 13.0", digits: "16\n1013.0"},
		deathsCard,
	})
	assertPerfStat(t, "assists", res.Performance.Assists, 0, 0)
	if r, ok := evidenceRect(res, parser.ScalarPath("assists")); ok {
		t.Errorf("assists was not read but recorded evidence %v", r)
	}
}

// Cards that read nothing leave Performance nil rather than an all-zero card
// that reads as "played and scored nothing".
func TestParseSummary_NoReadableCardLeavesPerformanceNil(t *testing.T) {
	res, err := parser.ParseSummary(stubPerfScreen(t, perfScreen{{text: "just noise"}}), t.TempDir())
	if err != nil {
		t.Fatalf("ParseSummary: %v", err)
	}
	if res.Performance != nil {
		t.Errorf("performance = %+v, want nil", res.Performance)
	}
}
