package parser

import (
	"image"
	"image/color"

	"recall/pkg/glyphs"
)

func crop(src image.Image, r image.Rectangle) image.Image {
	r = r.Intersect(src.Bounds())
	out := image.NewRGBA(image.Rect(0, 0, r.Dx(), r.Dy()))
	for y := 0; y < r.Dy(); y++ {
		for x := 0; x < r.Dx(); x++ {
			out.Set(x, y, src.At(r.Min.X+x, r.Min.Y+y))
		}
	}
	return out
}

// preprocessInverted converts a color image to inverted-luminance grayscale at
// 3x scale. Game text (white) becomes black and dark backgrounds become light —
// the orientation Tesseract is trained on. Antialiasing is preserved as a
// gradient, which Tesseract's internal binarisation handles cleanly.
func preprocessInverted(src image.Image) image.Image {
	return grayUpscale(src, 3, true)
}

// preprocessRaw is the non-inverted counterpart: grayscale + upscale with the
// luminance kept as-is. Mid-tone COLORED text — e.g. the orange "-19%" on the
// rank demotion screen — reads as dark-on-light raw, where inversion flips it
// to faint light-on-dark and Tesseract drops it. The caller picks the scale;
// thin glyphs want a higher factor than the inverted pass's default 3x.
func preprocessRaw(src image.Image, scale int) image.Image {
	return grayUpscale(src, scale, false)
}

// preprocessHighContrast renders src as a hard two-level threshold at scale×:
// pixels brighter than `thresh` become black, the rest white. For low-contrast
// bright-on-color pills — the white-on-green "+N%" rank gain — the
// gradient-preserving inverted/raw passes leave the text too faint to read once
// the capture is downscaled to 1080p; thresholding lands the bright text as
// crisp dark-on-light, the orientation Tesseract wants.
func preprocessHighContrast(src image.Image, scale int, thresh uint8) image.Image {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	out := image.NewGray(image.Rect(0, 0, w*scale, h*scale))
	for y := range h {
		for x := range w {
			r, g, b, _ := src.At(x, y).RGBA()
			// #nosec G115 -- BT.601 luminance, weights sum to 1000, each
			// channel ≤ 255 after >>8, so the result is always ≤ 255.
			lum := uint8((299*int(r>>8) + 587*int(g>>8) + 114*int(b>>8)) / 1000)
			v := uint8(255)
			if lum > thresh {
				v = 0
			}
			for dy := range scale {
				for dx := range scale {
					out.SetGray(x*scale+dx, y*scale+dy, color.Gray{Y: v})
				}
			}
		}
	}
	return out
}

// grayUpscale renders src as BT.601-luminance grayscale at scale×, optionally
// inverted (255-lum). Nearest-neighbor upscale; antialiasing rides through as
// a gradient for Tesseract's binariser.
func grayUpscale(src image.Image, scale int, invert bool) image.Image {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	out := image.NewGray(image.Rect(0, 0, w*scale, h*scale))
	for y := range h {
		for x := range w {
			r, g, b, _ := src.At(x, y).RGBA()
			// #nosec G115 -- ITU-R BT.601 luminance: weights sum to 1000,
			// each channel ≤ 255 after >>8, so the result is always ≤ 255.
			lum := uint8((299*int(r>>8) + 587*int(g>>8) + 114*int(b>>8)) / 1000)
			v := lum
			if invert {
				v = 255 - lum
			}
			for dy := range scale {
				for dx := range scale {
					out.SetGray(x*scale+dx, y*scale+dy, color.Gray{Y: v})
				}
			}
		}
	}
	return out
}

// preprocessSmoothThreshold upscales src bilinearly by scale, then applies
// preprocessHighContrast's cutoff: luminance above thresh → black, the rest
// white.
func preprocessSmoothThreshold(src image.Image, scale int, thresh uint8) image.Image {
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	up := glyphs.Resample(glyphs.Luminance(src, src.Bounds()), w*scale, h*scale)
	out := image.NewGray(image.Rect(0, 0, w*scale, h*scale))
	for i, lum := range up.Pix {
		if lum <= float64(thresh) {
			out.Pix[i] = 255
		}
	}
	return out
}

// statInkCutoff is the luminance white stat digits clear and the dark card or
// row behind them does not: the TEAMS stat-cell threshold (ocrStatCell), and
// the cut pkg/glyphs segments digits on.
const statInkCutoff = 150

// inkGrid is an area's luminance, kept with the area's origin so the boxes
// found in it map back to image coordinates.
type inkGrid struct {
	glyphs.Grid
	origin image.Point
}

func newInkGrid(img image.Image, area image.Rectangle) inkGrid {
	area = area.Intersect(img.Bounds())
	return inkGrid{Grid: glyphs.Luminance(img, area), origin: area.Min}
}

func (g inkGrid) inked(x, y int) bool { return g.Pix[y*g.Width+x] > statInkCutoff }

// span is a run of consecutive rows or columns, [from, to).
type span struct{ from, to int }

func (s span) length() int { return s.to - s.from }

// inkSpans is the runs of consecutive indices in [0, n) that hold ink.
func inkSpans(n int, holdsInk func(int) bool) []span {
	var spans []span
	start := -1
	for i := 0; i <= n; i++ {
		inked := i < n && holdsInk(i)
		switch {
		case inked && start < 0:
			start = i
		case !inked && start >= 0:
			spans = append(spans, span{start, i})
			start = -1
		}
	}
	return spans
}

// rowSpans is the runs of rows holding ink between columns x0 and x1.
func (g inkGrid) rowSpans(x0, x1 int) []span {
	return inkSpans(g.Height, func(y int) bool {
		for x := x0; x < x1; x++ {
			if g.inked(x, y) {
				return true
			}
		}
		return false
	})
}

func (g inkGrid) columnHasInk(x int) bool {
	for y := range g.Height {
		if g.inked(x, y) {
			return true
		}
	}
	return false
}

// tallestBand is the tallest run of rows holding ink, across the grid's
// width. On a stat card the number is set taller than its label and caption,
// so that band is the number.
func (g inkGrid) tallestBand() (image.Rectangle, bool) {
	var best span
	for _, rows := range g.rowSpans(0, g.Width) {
		if rows.length() > best.length() {
			best = rows
		}
	}
	return image.Rect(0, best.from, g.Width, best.to).Add(g.origin), best.length() > 0
}

// blob is a run of ink columns cut to the rows its ink spans; solid says no
// ink-free row crosses it, which holds for a digit and not for a stack of
// separate marks.
type blob struct {
	box   image.Rectangle
	solid bool
}

// blobs splits the grid into its runs of ink columns, left to right, in
// image coordinates.
func (g inkGrid) blobs() []blob {
	columns := inkSpans(g.Width, g.columnHasInk)
	out := make([]blob, 0, len(columns))
	for _, cols := range columns {
		rows := g.rowSpans(cols.from, cols.to)
		box := image.Rect(cols.from, rows[0].from, cols.to, rows[len(rows)-1].to)
		out = append(out, blob{box: box.Add(g.origin), solid: len(rows) == 1})
	}
	return out
}

// inkBounds is the box around all of the grid's ink.
func (g inkGrid) inkBounds() (image.Rectangle, bool) {
	var bounds image.Rectangle
	for _, b := range g.blobs() {
		bounds = bounds.Union(b.box)
	}
	return bounds, !bounds.Empty()
}

// inkPad is the margin left around a box cut to its ink, so a reader sees the
// glyphs' antialiased edges: 2 px at 1440p.
func inkPad(img image.Image) int { return max(img.Bounds().Dy()/720, 1) }
