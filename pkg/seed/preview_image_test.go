package seed_test

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/seed"
)

// The preview PNG is what the ambiguous-resolution cards actually render, and
// its color math is pure — but in production it is reachable only by running a
// whole profile seed, so nothing below was ever asserted directly.

// hsvToRGB is a standard HSV→RGB conversion over a six-arm branch ladder.
// The six primaries sit ON the sector boundaries, where the secondary
// component is zero and NEIGHBORING ARMS AGREE — so a boundary-only table
// cannot tell two swapped arms apart. Each sector's midpoint is therefore in
// the table too, and that is the case that pins which arm owns which hue.
func TestHSVToRGB_SectorLadder(t *testing.T) {
	cases := []struct {
		name    string
		h       float64
		r, g, b uint8
	}{
		{"red", 0, 255, 0, 0},
		{"orange (0-60 interior)", 30, 255, 127, 0},
		{"yellow", 60, 255, 255, 0},
		// Hues carry one decimal place, so a half-degree past a boundary is a
		// real production input and is where a shifted arm (`h < 61`) first shows.
		{"just past yellow", 60.5, 252, 255, 0},
		{"chartreuse (60-120 interior)", 90, 127, 255, 0},
		{"green", 120, 0, 255, 0},
		{"spring (120-180 interior)", 150, 0, 255, 127},
		{"cyan", 180, 0, 255, 255},
		{"azure (180-240 interior)", 210, 0, 127, 255},
		{"blue", 240, 0, 0, 255},
		{"violet (240-300 interior)", 270, 127, 0, 255},
		{"magenta", 300, 255, 0, 255},
		{"rose (300-360 interior)", 330, 255, 0, 127},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, g, b := seed.HSVToRGB(tc.h, 1, 1)
			if r != tc.r || g != tc.g || b != tc.b {
				t.Errorf("HSVToRGB(%v, 1, 1) = (%d, %d, %d), want (%d, %d, %d)", tc.h, r, g, b, tc.r, tc.g, tc.b)
			}
		})
	}
}

// Zero saturation is gray at every hue, and zero value is black — the two
// degenerate inputs where a sign error in the m = v - c offset survives every
// primary-color assertion above.
func TestHSVToRGB_DegenerateSaturationAndValue(t *testing.T) {
	for _, h := range []float64{0, 59, 60, 119, 200, 359.9} {
		r, g, b := seed.HSVToRGB(h, 0, 1)
		if r != 255 || g != 255 || b != 255 {
			t.Errorf("HSVToRGB(%v, 0, 1) = (%d, %d, %d), want white — zero saturation is gray at every hue", h, r, g, b)
		}
		r, g, b = seed.HSVToRGB(h, 1, 0)
		if r != 0 || g != 0 || b != 0 {
			t.Errorf("HSVToRGB(%v, 1, 0) = (%d, %d, %d), want black", h, r, g, b)
		}
	}
}

// The seed writer calls hsvToRGB with a FIXED saturation/value pair chosen so
// every preview is mid-tone: distinguishable from its neighbors, never so dark
// the card reads as broken and never so washed out it reads as blank. Pin the
// band rather than six exact triples — the contract is the tone, not the float.
func TestHSVToRGB_SeedToneStaysMidRange(t *testing.T) {
	const seedSaturation, seedValue = 0.7, 0.9
	for h := 0.0; h < 360; h += 0.5 {
		r, g, b := seed.HSVToRGB(h, seedSaturation, seedValue)
		lo, hi := minChannel(r, g, b), maxChannel(r, g, b)
		if hi < 200 {
			t.Fatalf("hue %v: brightest channel %d — too dark for a preview tile", h, hi)
		}
		if lo > 120 {
			t.Fatalf("hue %v: dimmest channel %d — too washed out to tell neighbors apart", h, lo)
		}
	}
}

func minChannel(r, g, b uint8) uint8 {
	return min(r, min(g, b))
}

func maxChannel(r, g, b uint8) uint8 {
	return max(r, max(g, b))
}

// The whole point of hashing the name is that a filename always paints the
// same tile: a re-seed must not reshuffle the preview colors under a user
// mid-triage.
func TestHueFromName_DeterministicAndInRange(t *testing.T) {
	names := []string{
		"", "a", "Overwatch_2026-08-15_19-04-11.png", "Overwatch_2026-08-15_19-04-12.png",
		"screenshot.png", "SCREENSHOT.PNG", "ünïcodé.png",
	}
	hues := make(map[string]float64, len(names))
	for _, name := range names {
		h := seed.HueFromName(name)
		if h < 0 || h >= 360 {
			t.Errorf("HueFromName(%q) = %v, want [0, 360)", name, h)
		}
		if again := seed.HueFromName(name); again != h {
			t.Errorf("HueFromName(%q) = %v then %v — not deterministic", name, h, again)
		}
		hues[name] = h
	}
	// Consecutive capture filenames differ by one character; they must not
	// land on the same tile color or a queue of them reads as one blob.
	if hues["Overwatch_2026-08-15_19-04-11.png"] == hues["Overwatch_2026-08-15_19-04-12.png"] {
		t.Error("adjacent capture filenames hash to the same hue — neighbors are indistinguishable")
	}
	if hues["screenshot.png"] == hues["SCREENSHOT.PNG"] {
		t.Error("hue is case-insensitive; the hash should distinguish case")
	}
}

// writeSolidColorPNG's output is a file another process decodes, so the bytes
// are the contract: a real PNG, the fixed preview geometry, one flat opaque
// color, and 0600 because it lands in the user's profile directory.
func TestWriteSolidColorPNG_Bytes(t *testing.T) {
	const filename = "Overwatch_2026-08-15_19-04-11.png"
	path := filepath.Join(t.TempDir(), filename)
	if err := seed.WriteSolidColorPNG(path, filename); err != nil {
		t.Fatalf("WriteSolidColorPNG: %v", err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !bytes.HasPrefix(raw, []byte("\x89PNG\r\n\x1a\n")) {
		t.Fatalf("file does not start with the PNG signature: % x", raw[:min(8, len(raw))])
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("mode = %v, want 0600 — previews land in the user's profile dir", perm)
	}

	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got, want := img.Bounds(), image.Rect(0, 0, 320, 180); got != want {
		t.Fatalf("bounds = %v, want %v", got, want)
	}
	assertFlatOpaqueColor(t, img, filename)
}

// assertFlatOpaqueColor pins every pixel to the one color the filename's hue
// derives, fully opaque — a preview tile with a transparent or gradient
// interior would render as the missing-image state it exists to replace.
func assertFlatOpaqueColor(t *testing.T, img image.Image, filename string) {
	t.Helper()
	r8, g8, b8 := seed.HSVToRGB(seed.HueFromName(filename), 0.7, 0.9)
	wantR, wantG, wantB := uint32(r8)*0x101, uint32(g8)*0x101, uint32(b8)*0x101
	bounds := img.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			if r != wantR || g != wantG || b != wantB || a != 0xFFFF {
				t.Fatalf("pixel (%d,%d) = (%d,%d,%d,%d), want (%d,%d,%d,%d)",
					x, y, r, g, b, a, wantR, wantG, wantB, 0xFFFF)
			}
		}
	}
}

// Two different filenames must not produce byte-identical files, and one
// filename must produce the same bytes every time — that pair is what makes
// the previews stable AND distinguishable.
func TestWriteSolidColorPNG_StablePerNameDistinctAcrossNames(t *testing.T) {
	dir := t.TempDir()
	write := func(name string) []byte {
		t.Helper()
		path := filepath.Join(dir, name)
		if err := seed.WriteSolidColorPNG(path, name); err != nil {
			t.Fatalf("WriteSolidColorPNG(%q): %v", name, err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %q: %v", name, err)
		}
		return raw
	}
	first := write("ambiguous-a.png")
	if !bytes.Equal(first, write("ambiguous-a.png")) {
		t.Error("rewriting the same filename produced different bytes — previews would flicker on reseed")
	}
	if bytes.Equal(first, write("ambiguous-b.png")) {
		t.Error("two filenames produced identical previews — candidate thumbnails would be indistinguishable")
	}
}

// The writer truncates, so reseeding over a longer stale file must not leave a
// tail of the old bytes glued onto the new PNG.
func TestWriteSolidColorPNG_TruncatesAnExistingFile(t *testing.T) {
	const filename = "stale.png"
	path := filepath.Join(t.TempDir(), filename)
	if err := os.WriteFile(path, bytes.Repeat([]byte{'x'}, 200_000), 0o600); err != nil {
		t.Fatalf("plant stale file: %v", err)
	}
	if err := seed.WriteSolidColorPNG(path, filename); err != nil {
		t.Fatalf("WriteSolidColorPNG: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if bytes.Contains(raw, bytes.Repeat([]byte{'x'}, 64)) {
		t.Fatal("stale bytes survived the rewrite — the file was not truncated")
	}
	if _, err := png.Decode(bytes.NewReader(raw)); err != nil {
		t.Fatalf("decode after rewrite: %v", err)
	}
}
