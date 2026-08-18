package tesseract_test

import (
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"recall/pkg/parser"
	"recall/pkg/tesseract"
)

// A hung Tesseract process must not wedge the parse — every invocation is
// bounded by the package timeout. The fake binary sleeps far longer than
// the shortened timeout; if invocations were unbounded the first OCR pass
// alone would blow the elapsed assertion.
func TestParseScreenshot_BoundsHungTesseract(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake tesseract is a shell script")
	}
	dir := t.TempDir()
	fake := filepath.Join(dir, "tesseract")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\nsleep 30\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	shot := filepath.Join(dir, "shot.png")
	f, err := os.Create(shot) // #nosec G304 -- temp dir path
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, image.NewRGBA(image.Rect(0, 0, 1920, 1080))); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	tesseract.SetPath(fake)
	t.Cleanup(func() { tesseract.SetPath("tesseract") })
	tesseract.SetTimeout(100 * time.Millisecond)
	t.Cleanup(func() { tesseract.SetTimeout(0) })

	// The bound leaves generous headroom for a loaded machine (each of the
	// classifier's OCR passes costs timeout + WaitDelay + spawn overhead);
	// an UNBOUNDED run blocks ≥30s on the very first invocation, so the
	// separation stays unambiguous.
	start := time.Now()
	_, _ = parser.ParseScreenshot(shot) // classifiers tolerate OCR failures; the contract is the bound
	if elapsed := time.Since(start); elapsed > 15*time.Second {
		t.Fatalf("ParseScreenshot took %v with a hung tesseract — invocations are unbounded", elapsed)
	}
}
