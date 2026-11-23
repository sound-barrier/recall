package glyphs

import "image"

// Grid is a row-major luminance raster: Pix[y*Width+x].
type Grid struct {
	Width, Height int
	Pix           []float64
}

// Luminance is the BT.601 luminance of img inside rect, clipped to img's
// bounds.
func Luminance(img image.Image, rect image.Rectangle) Grid {
	r := rect.Intersect(img.Bounds())
	g := Grid{Width: r.Dx(), Height: r.Dy(), Pix: make([]float64, 0, r.Dx()*r.Dy())}
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			red, green, blue, _ := img.At(x, y).RGBA()
			g.Pix = append(g.Pix, (299*float64(red>>8)+587*float64(green>>8)+114*float64(blue>>8))/1000)
		}
	}
	return g
}

// Resample bilinearly rescales g to width×height, pixel-center aligned and
// clamped at the edges. An empty grid, or an empty target, resamples to an
// empty grid.
func Resample(g Grid, width, height int) Grid {
	if len(g.Pix) == 0 || width <= 0 || height <= 0 {
		return Grid{}
	}
	out := Grid{Width: width, Height: height, Pix: make([]float64, 0, width*height)}
	for oy := range height {
		fy := sourceCoord(oy, g.Height, height)
		for ox := range width {
			out.Pix = append(out.Pix, g.bilinear(sourceCoord(ox, g.Width, width), fy))
		}
	}
	return out
}

// sourceCoord maps output pixel o's center onto the source axis. Multiplying
// before dividing keeps an integer-factor upscale bit-identical to the
// (o+0.5)/scale form the TEAMS stat-cell threshold was tuned on.
func sourceCoord(o, srcLen, dstLen int) float64 {
	return max((float64(o)+0.5)*float64(srcLen)/float64(dstLen)-0.5, 0)
}

func (g Grid) bilinear(fx, fy float64) float64 {
	x0, y0 := int(fx), int(fy)
	x1, y1 := min(x0+1, g.Width-1), min(y0+1, g.Height-1)
	dx, dy := fx-float64(x0), fy-float64(y0)
	top := g.at(x0, y0)*(1-dx) + g.at(x1, y0)*dx
	bottom := g.at(x0, y1)*(1-dx) + g.at(x1, y1)*dx
	return top*(1-dy) + bottom*dy
}

func (g Grid) at(x, y int) float64 { return g.Pix[y*g.Width+x] }

// sub is the part of g inside r, which must lie within g.
func (g Grid) sub(r image.Rectangle) Grid {
	out := Grid{Width: r.Dx(), Height: r.Dy(), Pix: make([]float64, 0, r.Dx()*r.Dy())}
	for y := r.Min.Y; y < r.Max.Y; y++ {
		out.Pix = append(out.Pix, g.Pix[y*g.Width+r.Min.X:y*g.Width+r.Max.X]...)
	}
	return out
}
