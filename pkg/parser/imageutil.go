package parser

import (
	"image"
	"image/color"
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
	lum := luminanceGrid(src)
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	out := image.NewGray(image.Rect(0, 0, w*scale, h*scale))
	for oy := range h * scale {
		for ox := range w * scale {
			v := uint8(255)
			if bilinearAt(lum, w, h, ox, oy, scale) > float64(thresh) {
				v = 0
			}
			out.SetGray(ox, oy, color.Gray{Y: v})
		}
	}
	return out
}

// luminanceGrid is src's BT.601 luminance, row-major.
func luminanceGrid(src image.Image) []float64 {
	b := src.Bounds()
	lum := make([]float64, 0, b.Dx()*b.Dy())
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := src.At(x, y).RGBA()
			lum = append(lum, (299*float64(r>>8)+587*float64(g>>8)+114*float64(bl>>8))/1000)
		}
	}
	return lum
}

// bilinearAt samples the w×h luminance grid at output pixel (ox, oy) of a
// scale× upscale, pixel-center aligned and clamped at the edges.
func bilinearAt(lum []float64, w, h, ox, oy, scale int) float64 {
	fx := max((float64(ox)+0.5)/float64(scale)-0.5, 0)
	fy := max((float64(oy)+0.5)/float64(scale)-0.5, 0)
	x0, y0 := int(fx), int(fy)
	x1, y1 := min(x0+1, w-1), min(y0+1, h-1)
	dx, dy := fx-float64(x0), fy-float64(y0)
	top := lum[y0*w+x0]*(1-dx) + lum[y0*w+x1]*dx
	bottom := lum[y1*w+x0]*(1-dx) + lum[y1*w+x1]*dx
	return top*(1-dy) + bottom*dy
}
