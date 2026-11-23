package glyphs_test

import (
	"image"
	"image/color"
	"slices"
	"testing"

	"recall/pkg/glyphs"
)

func TestLuminance_ReadsBT601OverTheRect(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	img.SetRGBA(1, 0, color.RGBA{R: 255, A: 255})
	img.SetRGBA(2, 0, color.RGBA{G: 255, A: 255})
	img.SetRGBA(1, 1, color.RGBA{B: 255, A: 255})
	img.SetRGBA(2, 1, color.RGBA{R: 255, G: 255, B: 255, A: 255})

	got := glyphs.Luminance(img, image.Rect(1, 0, 3, 2))

	want := glyphs.Grid{Width: 2, Height: 2, Pix: []float64{76.245, 149.685, 29.07, 255}}
	if got.Width != want.Width || got.Height != want.Height || !slices.Equal(got.Pix, want.Pix) {
		t.Fatalf("Luminance = %+v, want %+v", got, want)
	}
}

func TestLuminance_ClipsTheRectToTheImage(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	got := glyphs.Luminance(img, image.Rect(2, 2, 10, 10))
	if got.Width != 2 || got.Height != 2 || len(got.Pix) != 4 {
		t.Fatalf("Luminance over a rect hanging off the image = %dx%d (%d px), want 2x2", got.Width, got.Height, len(got.Pix))
	}
}

func TestResample_UpscalesPixelCenterAligned(t *testing.T) {
	src := glyphs.Grid{Width: 2, Height: 1, Pix: []float64{0, 100}}
	got := glyphs.Resample(src, 4, 1)
	if want := []float64{0, 25, 75, 100}; !slices.Equal(got.Pix, want) {
		t.Fatalf("Resample 2→4 = %v, want %v", got.Pix, want)
	}
}

func TestResample_EmptyGridStaysEmpty(t *testing.T) {
	got := glyphs.Resample(glyphs.Grid{}, 12, 18)
	if len(got.Pix) != 0 {
		t.Fatalf("Resample of an empty grid produced %d pixels", len(got.Pix))
	}
}
