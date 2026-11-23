package glyphs

import (
	"fmt"
	"image"
	"strconv"
)

// References is the set of reference cuts the readers compare pixels against.
// The zero value is an empty set, which reads nothing: a gap in the
// references is "no match", never a guess.
type References struct {
	digits []template
}

// AddDigit adds img, a cut holding exactly one glyph of digit, as a reference.
func (r *References) AddDigit(digit int, img image.Image) error {
	if digit < 0 || digit > 9 {
		return fmt.Errorf("digit reference %d is not a single digit", digit)
	}
	g := Luminance(img, img.Bounds())
	boxes, ok := segment(g)
	if !ok || len(boxes) != 1 {
		return fmt.Errorf("digit %d reference: want exactly one glyph, found %d (conclusive: %t)", digit, len(boxes), ok)
	}
	r.digits = append(r.digits, template{label: strconv.Itoa(digit), vec: normalizeGlyph(g, boxes[0], background(g))})
	return nil
}
