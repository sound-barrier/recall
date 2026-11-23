package glyphs_test

import (
	"bytes"
	"image"
	"image/png"
	"testing"
	"testing/fstest"

	"recall/pkg/glyphs"
)

func encodePNG(t *testing.T, img image.Image) *fstest.MapFile {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return &fstest.MapFile{Data: buf.Bytes()}
}

func TestLoad_ReadsTheReferenceLayout(t *testing.T) {
	fsys := fstest.MapFS{"README.md": &fstest.MapFile{Data: []byte("layout notes")}}
	for _, d := range "0123456789" {
		img, _ := drawNumber(t, numberStrip{text: string(d), cell: cellFull, gap: cellFull})
		fsys["digit/"+string(d)+"/teams-1440p.png"] = encodePNG(t, img)
	}

	refs, err := glyphs.Load(fsys)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	num, rect := drawNumber(t, numberStrip{text: "250", cell: cellSmall, gap: cellSmall})
	if got, ok := refs.ReadNumber(num, rect); !ok || got.Value != 250 {
		t.Errorf("loaded digits read (%+v, %v), want 250", got, ok)
	}
}

func TestLoad_RefusesAFileOutsideTheLayout(t *testing.T) {
	img, _ := drawNumber(t, numberStrip{text: "4", cell: cellFull, gap: cellFull})
	cases := map[string]fstest.MapFS{
		"loose png":       {"4.png": encodePNG(t, img)},
		"unknown kind":    {"glyph/4/a.png": encodePNG(t, img)},
		"non-digit label": {"digit/four/a.png": encodePNG(t, img)},
		"not a png":       {"digit/4/a.png": &fstest.MapFile{Data: []byte("not an image")}},
		"two glyphs":      {"digit/4/a.png": encodePNG(t, mustDraw(t, "44"))},
	}
	for name, fsys := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := glyphs.Load(fsys); err == nil {
				t.Fatal("Load accepted it")
			}
		})
	}
}

func mustDraw(t *testing.T, text string) image.Image {
	t.Helper()
	img, _ := drawNumber(t, numberStrip{text: text, cell: cellFull, gap: cellFull})
	return img
}

func TestEmbeddedReferences_Load(t *testing.T) {
	if _, err := glyphs.LoadEmbedded(); err != nil {
		t.Fatalf("the embedded refs/ directory does not load: %v", err)
	}
}

func TestPackageReaders_ReadNothingFromBlankPixels(t *testing.T) {
	blank := image.NewRGBA(image.Rect(0, 0, 64, 64))
	if got, ok := glyphs.ReadNumber(blank, blank.Bounds()); ok {
		t.Errorf("ReadNumber read %+v from a blank image", got)
	}
}
