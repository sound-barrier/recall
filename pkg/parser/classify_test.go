package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

// The All-Heroes aggregate view is recognized via a dedicated marker rather
// than by which combat fields are populated (it deliberately populates none).
// These pin the classify + golden-projection contract without Tesseract, so CI
// (which -short-skips the image golden test) still guards the behavior.

func TestScreenshotType_AllHeroesMarkerClassifies(t *testing.T) {
	if got := parser.Classify(&parser.MatchResult{AllHeroes: true}); got != parser.TypeAllHeroes {
		t.Errorf("Classify(AllHeroes) = %q, want %q", got, parser.TypeAllHeroes)
	}
}

// A rank parse whose tier OCR garbled must still classify as rank — the
// parseRank marker, not the extracted tier text, is the classification
// signal. Pre-marker, a rank screen with a readable "defeat" pill but no
// tier landed in the summary table (and poisoned correlation with a fake
// summary row), and a fully-garbled one landed in unknown.
func TestScreenshotType_RankScreenMarkerClassifies(t *testing.T) {
	cases := []struct {
		name string
		in   parser.MatchResult
		want parser.ScreenshotType
	}{
		{"marker with result but no tier", parser.MatchResult{RankScreen: true, Result: "defeat"}, parser.TypeRank},
		{"marker with nothing else readable", parser.MatchResult{RankScreen: true}, parser.TypeRank},
		{"marker with tier (normal path)", parser.MatchResult{RankScreen: true, Rank: "gold"}, parser.TypeRank},
		{"no marker: summary unchanged", parser.MatchResult{Result: "defeat"}, parser.TypeSummary},
		{"all_heroes outranks the marker", parser.MatchResult{AllHeroes: true, RankScreen: true}, parser.TypeAllHeroes},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parser.Classify(&c.in); got != c.want {
				t.Errorf("Classify(%+v) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// The golden projection must follow the marker too: a tier-garbled rank
// parse pins as a RankGolden with honest empty rank/level, not as the raw
// unknown dump or a summary shape.
func TestToGolden_RankScreenMarkerProjection(t *testing.T) {
	g, ok := parser.ToGolden(&parser.MatchResult{RankScreen: true, Result: "victory", RankProgress: new(100)}).(*parser.RankGolden)
	if !ok {
		t.Fatalf("ToGolden(RankScreen) = %T, want *RankGolden", parser.ToGolden(&parser.MatchResult{RankScreen: true}))
	}
	if g.Rank != "" || g.Result != "victory" || *g.RankProgress != 100 {
		t.Errorf("RankGolden = %+v, want empty rank with result/progress preserved", g)
	}
}

func TestToGolden_AllHeroesProjection(t *testing.T) {
	g, ok := parser.ToGolden(&parser.MatchResult{AllHeroes: true}).(*parser.AllHeroesGolden)
	if !ok {
		t.Fatalf("ToGolden(AllHeroes) = %T, want *AllHeroesGolden", parser.ToGolden(&parser.MatchResult{AllHeroes: true}))
	}
	if !g.AllHeroes {
		t.Error("AllHeroesGolden.AllHeroes = false, want true")
	}
}
