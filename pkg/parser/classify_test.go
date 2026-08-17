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
	if got := parser.ScreenshotType(&parser.MatchResult{AllHeroes: true}); got != "all_heroes" {
		t.Errorf("ScreenshotType(AllHeroes) = %q, want all_heroes", got)
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
		want string
	}{
		{"marker with result but no tier", parser.MatchResult{RankScreen: true, Result: "defeat"}, "rank"},
		{"marker with nothing else readable", parser.MatchResult{RankScreen: true}, "rank"},
		{"marker with tier (normal path)", parser.MatchResult{RankScreen: true, Rank: "gold"}, "rank"},
		{"no marker: summary unchanged", parser.MatchResult{Result: "defeat"}, "summary"},
		{"all_heroes outranks the marker", parser.MatchResult{AllHeroes: true, RankScreen: true}, "all_heroes"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parser.ScreenshotType(&c.in); got != c.want {
				t.Errorf("ScreenshotType(%+v) = %q, want %q", c.in, got, c.want)
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
