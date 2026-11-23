package glyphs

import (
	"image"
	"math"
)

const (
	// inkThreshold is the TEAMS stat cell's binarization cutoff
	// (parser.ocrStatCell): the white digits clear 150, the row blue
	// behind them does not.
	inkThreshold = 150

	// punctuationHeightRatio: a blob shorter than this share of the tallest
	// one is punctuation, not a digit.
	punctuationHeightRatio = 0.5

	// thousandsGroup is how many digits follow each thousands separator.
	thousandsGroup = 3

	// maxGlyphAspect: no single digit is wider than it is tall, so a blob
	// that is holds glyphs the column projection could not part.
	maxGlyphAspect = 1.0

	glyphWidth  = 12
	glyphHeight = 18
)

// columnRun is a run of adjacent columns that each hold ink, [x0, x1).
type columnRun struct{ x0, x1 int }

// segment splits g into its digit boxes, left to right: ink columns group
// into blobs, each blob is tightened to its ink rows, and thousands
// separators are dropped. It is not ok when a blob is too wide to be one
// glyph, since guessing where touching glyphs part is how a cross-check
// misreads, nor when punctuation sits anywhere a thousands separator cannot:
// that is a decimal point or a sign, and dropping it changes the number.
func segment(g Grid) ([]image.Rectangle, bool) {
	var boxes []image.Rectangle
	tallest := 0
	for _, run := range inkColumnRuns(g) {
		box := inkBox(g, run)
		boxes = append(boxes, box)
		tallest = max(tallest, box.Dy())
	}
	digits := make([]image.Rectangle, 0, len(boxes))
	isDigit := make([]bool, len(boxes))
	for i, box := range boxes {
		if float64(box.Dy()) < punctuationHeightRatio*float64(tallest) {
			continue
		}
		if float64(box.Dx()) > maxGlyphAspect*float64(tallest) {
			return nil, false
		}
		isDigit[i] = true
		digits = append(digits, box)
	}
	return digits, thousandsGrouped(isDigit)
}

// thousandsGrouped reports whether every non-digit blob is a thousands
// separator: one to three leading digits, then groups of exactly three.
func thousandsGrouped(isDigit []bool) bool {
	groups := []int{0}
	for _, digit := range isDigit {
		if digit {
			groups[len(groups)-1]++
		} else {
			groups = append(groups, 0)
		}
	}
	if len(groups) == 1 {
		return true
	}
	if groups[0] < 1 || groups[0] > thousandsGroup {
		return false
	}
	for _, size := range groups[1:] {
		if size != thousandsGroup {
			return false
		}
	}
	return true
}

func inkColumnRuns(g Grid) []columnRun {
	var runs []columnRun
	start := -1
	for x := 0; x <= g.Width; x++ {
		inked := x < g.Width && columnHasInk(g, x)
		switch {
		case inked && start < 0:
			start = x
		case !inked && start >= 0:
			runs = append(runs, columnRun{x0: start, x1: x})
			start = -1
		}
	}
	return runs
}

func columnHasInk(g Grid, x int) bool {
	for y := range g.Height {
		if g.at(x, y) > inkThreshold {
			return true
		}
	}
	return false
}

// inkBox is run's columns cut down to the rows that hold ink.
func inkBox(g Grid, run columnRun) image.Rectangle {
	top, bottom := g.Height, 0
	for y := range g.Height {
		for x := run.x0; x < run.x1; x++ {
			if g.at(x, y) > inkThreshold {
				top, bottom = min(top, y), max(bottom, y+1)
				break
			}
		}
	}
	return image.Rect(run.x0, top, run.x1, bottom)
}

// background is g's mean luminance off the ink, the fill a narrow glyph is
// padded with so padding reads as the screen behind it.
func background(g Grid) float64 {
	var sum float64
	n := 0
	for _, v := range g.Pix {
		if v <= inkThreshold {
			sum += v
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

// normalizeGlyph scales box to the glyph cell's height, keeping its aspect so
// a narrow "1" stays narrow, and centers it in a cell filled with fill. The
// cell height is what puts a 1080p and a 1440p glyph on one grid.
func normalizeGlyph(g Grid, box image.Rectangle, fill float64) []float64 {
	width := int(math.Round(float64(box.Dx()) * glyphHeight / float64(box.Dy())))
	width = min(max(width, 1), glyphWidth)
	scaled := Resample(g.sub(box), width, glyphHeight)
	cell := make([]float64, glyphWidth*glyphHeight)
	for i := range cell {
		cell[i] = fill
	}
	left := (glyphWidth - width) / 2
	for y := range glyphHeight {
		copy(cell[y*glyphWidth+left:], scaled.Pix[y*width:(y+1)*width])
	}
	return cell
}
