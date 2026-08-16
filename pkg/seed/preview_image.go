package seed

import (
	"hash/fnv"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
)

// writeSolidColorPNG writes a small (320x180) single-color PNG. The color
// is derived from a hash of the filename so the same name always fills
// the same hue (visually distinct neighbors, stable across runs).
func writeSolidColorPNG(path, filename string) error {
	const w, h = 320, 180
	r, g, b := hsvToRGB(hueFromName(filename), 0.7, 0.9)
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	c := color.RGBA{R: r, G: g, B: b, A: 0xFF}
	for y := range h {
		for x := range w {
			img.Set(x, y, c)
		}
	}
	// #nosec G304 -- path is filepath.Join(<profile screenshots dir>, <generated fixture filename>); no external input.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return png.Encode(f, img)
}

// hueFromName maps a filename to an H value in [0, 360) via FNV-1a.
func hueFromName(name string) float64 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(name))
	return float64(h.Sum32()%3600) / 10.0
}

// hsvToRGB converts H[0,360) S[0,1] V[0,1] to 8-bit RGB.
func hsvToRGB(h, s, v float64) (uint8, uint8, uint8) {
	c := v * s
	x := c * (1 - math.Abs(math.Mod(h/60, 2)-1))
	m := v - c
	var rf, gf, bf float64
	switch {
	case h < 60:
		rf, gf, bf = c, x, 0
	case h < 120:
		rf, gf, bf = x, c, 0
	case h < 180:
		rf, gf, bf = 0, c, x
	case h < 240:
		rf, gf, bf = 0, x, c
	case h < 300:
		rf, gf, bf = x, 0, c
	default:
		rf, gf, bf = c, 0, x
	}
	return uint8((rf + m) * 255), uint8((gf + m) * 255), uint8((bf + m) * 255)
}
