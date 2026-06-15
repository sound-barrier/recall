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

func TestToGolden_AllHeroesProjection(t *testing.T) {
	g, ok := parser.ToGolden(&parser.MatchResult{AllHeroes: true}).(*parser.AllHeroesGolden)
	if !ok {
		t.Fatalf("ToGolden(AllHeroes) = %T, want *AllHeroesGolden", parser.ToGolden(&parser.MatchResult{AllHeroes: true}))
	}
	if !g.AllHeroes {
		t.Error("AllHeroesGolden.AllHeroes = false, want true")
	}
}
