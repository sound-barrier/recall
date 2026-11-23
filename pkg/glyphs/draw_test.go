package glyphs_test

import (
	"image"
	"image/color"
	"image/draw"
	"math/rand/v2"
	"testing"

	"recall/pkg/glyphs"
)

// The synthetic fixtures below stand in for corpus pixels: blocky 5×7
// bitmap digits, white on the TEAMS row blue, drawn at a whole number of
// pixels per bitmap cell so 4 px/cell is "1.0×" and 3 px/cell is "0.75×".

const (
	cellFull  = 4
	cellSmall = 3
)

var (
	rowBlue   = color.RGBA{R: 30, G: 60, B: 140, A: 255}
	digitInk  = color.RGBA{R: 240, G: 240, B: 240, A: 255}
	bitmapsOf = map[rune][7]string{
		'0': {".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."},
		'1': {"..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."},
		'2': {".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"},
		'3': {"#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."},
		'4': {"...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."},
		'5': {"#####", "#....", "####.", "....#", "....#", "#...#", ".###."},
		'6': {"..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."},
		'7': {"#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."},
		'8': {".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."},
		'9': {".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."},
		// Not a digit: the below-threshold probe.
		'x': {"#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"},
		// A comma hangs off the baseline and is a fraction of a digit's height.
		',': {".....", ".....", ".....", ".....", ".....", "..#..", ".#..."},
		// A decimal point and a minus sign are short blobs too, but not ones
		// a reader may drop.
		'.': {".....", ".....", ".....", ".....", ".....", "..##.", "..##."},
		'-': {".....", ".....", ".....", ".###.", ".....", ".....", "....."},
	}
)

// numberStrip is how text is laid out on a synthetic strip.
type numberStrip struct {
	text string
	cell int // pixels per bitmap cell
	gap  int // pixels between glyph boxes; negative overlaps them
}

// drawNumber renders strip.text on a row-blue canvas with a margin all round
// and returns the canvas plus the rectangle the text occupies with that
// margin — the rect a parser would hand ReadNumber.
func drawNumber(t *testing.T, strip numberStrip) (*image.RGBA, image.Rectangle) {
	t.Helper()
	margin := 3 * strip.cell
	width := 0
	for range strip.text {
		width += 5*strip.cell + strip.gap
	}
	textRect := image.Rect(0, 0, width-strip.gap, 7*strip.cell).Add(image.Pt(margin, margin))
	canvas := image.NewRGBA(image.Rect(0, 0, textRect.Max.X+margin, textRect.Max.Y+margin))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(rowBlue), image.Point{}, draw.Src)
	x := textRect.Min.X
	for _, r := range strip.text {
		drawBitmap(t, canvas, r, image.Pt(x, textRect.Min.Y), strip.cell)
		x += 5*strip.cell + strip.gap
	}
	return canvas, textRect.Inset(-margin / 2)
}

func drawBitmap(t *testing.T, canvas *image.RGBA, r rune, at image.Point, cell int) {
	t.Helper()
	rows, ok := bitmapsOf[r]
	if !ok {
		t.Fatalf("no bitmap for %q", r)
	}
	for by, row := range rows {
		for bx, bit := range row {
			if bit != '#' {
				continue
			}
			block := image.Rect(0, 0, cell, cell).Add(at.Add(image.Pt(bx*cell, by*cell)))
			draw.Draw(canvas, block, image.NewUniform(digitInk), image.Point{}, draw.Src)
		}
	}
}

// addNoise jitters every channel by up to ±amplitude, deterministically.
func addNoise(img *image.RGBA, amplitude int) {
	rng := rand.New(rand.NewPCG(7, 11))
	for i := range img.Pix {
		if i%4 == 3 {
			continue
		}
		v := int(img.Pix[i]) + rng.IntN(2*amplitude+1) - amplitude
		img.Pix[i] = uint8(min(max(v, 0), 255))
	}
}

// digitReferences is a reference set holding one clean 1.0× cut per digit.
func digitReferences(t *testing.T) *glyphs.References {
	t.Helper()
	var refs glyphs.References
	for d := range 10 {
		img, _ := drawNumber(t, numberStrip{text: string(rune('0' + d)), cell: cellFull, gap: cellFull})
		if err := refs.AddDigit(d, img); err != nil {
			t.Fatalf("AddDigit(%d): %v", d, err)
		}
	}
	return &refs
}
