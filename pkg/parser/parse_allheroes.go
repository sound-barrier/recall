package parser

import (
	"image"
	"strings"
)

// isAllHeroesScreenshot detects the PERSONAL tab's "All Heroes" view — the
// match's aggregate combat totals in a 2×3 grid. It shares the per-hero tab's
// sidebar (so isPersonalScreenshot matches it too), but its grid uses the
// aggregate labels "HERO DAMAGE DONE" / "DAMAGE MITIGATED" that the per-hero
// cards (hero-specific labels) and the TEAMS screen (bare "DAMAGE") never use.
// Must run BEFORE isPersonalScreenshot in dispatch, or the per-hero parser
// mis-reads the 2×3 grid as its 3×3 layout and the result falls to "unknown".
func isAllHeroesScreenshot(img image.Image, work string) bool {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W*55/100, H*16/100, W*99/100, H*95/100)
	text, err := ocrInverted(img, rect, work, "detect_allheroes", "11", "")
	if err != nil {
		return false
	}
	upper := strings.ToUpper(text)
	return strings.Contains(upper, "HERO DAMAGE") || strings.Contains(upper, "DAMAGE MITIGATED")
}

// parseAllHeroes recognizes the All Heroes aggregate but deliberately does NOT
// extract its stats. Every value it carries (E/A/D + damage / healing /
// mitigation) is also on the post-match TEAMS screen, which reads them
// reliably and non-redundantly — whereas the All Heroes cards' icons defeat
// the OCR (the skull-X elimination icon reads as a digit, "11" → "7 1]"), so a
// parsed value would be an unreliable correlation source. Recognizing it keeps
// the screen out of the Unknown tab; the AllHeroes marker classifies it, and
// the write path skips storing it.
func parseAllHeroes(_ image.Image, _ string) (*MatchResult, error) {
	return &MatchResult{AllHeroes: true}, nil
}
