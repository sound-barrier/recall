package glyphs

import "image"

var (
	// LoadEmbedded loads the references compiled into the binary, so a test
	// can hold refs/ to the layout Load accepts.
	LoadEmbedded = loadEmbedded

	// ScoreNumber reads without the accept rule, so the corpus calibration
	// can see how far a rejected read fell short of it.
	ScoreNumber = (*References).scoreNumber
)

// Segment is the glyph boxes ReadNumber would read in rect, in img's
// coordinates, so the reference-labeling aid proposes exactly those boxes.
func Segment(img image.Image, rect image.Rectangle) ([]image.Rectangle, bool) {
	clipped := rect.Intersect(img.Bounds())
	boxes, ok := segment(Luminance(img, clipped))
	for i := range boxes {
		boxes[i] = boxes[i].Add(clipped.Min)
	}
	return boxes, ok
}
