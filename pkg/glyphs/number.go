package glyphs

import (
	"image"
	"math"
	"strconv"
	"strings"
)

// NumberReading is a number read off the pixels. Score is the lowest score
// and Margin the lowest margin among its glyphs, each taken on its own, so
// the two may come from different glyphs: together they say how near the
// read came to each accept threshold, not how any one glyph scored.
type NumberReading struct {
	Value  int
	Score  float64
	Margin float64
}

// ReadNumber reads the white digits inside rect. It is not ok when rect holds
// no glyph, when glyphs touch, or when any one glyph fails the accept rule.
func (r *References) ReadNumber(img image.Image, rect image.Rectangle) (NumberReading, bool) {
	g := Luminance(img, rect)
	boxes, ok := segment(g)
	if !ok || len(boxes) == 0 {
		return NumberReading{}, false
	}
	fill := background(g)
	var digits strings.Builder
	reading := NumberReading{Score: math.Inf(1), Margin: math.Inf(1)}
	for _, box := range boxes {
		glyph, ok := classify(normalizeGlyph(g, box, fill), r.digits)
		if !ok {
			return NumberReading{}, false
		}
		digits.WriteString(glyph.label)
		reading.Score = min(reading.Score, glyph.score)
		reading.Margin = min(reading.Margin, glyph.margin)
	}
	value, err := strconv.Atoi(digits.String())
	if err != nil {
		return NumberReading{}, false
	}
	reading.Value = value
	return reading, true
}
