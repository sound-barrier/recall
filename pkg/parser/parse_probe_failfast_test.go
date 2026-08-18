package parser_test

import (
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"recall/pkg/parser"
	"recall/pkg/tesseract"
)

// A probe OCR error that survives the retry ladder means no probe result is
// trustworthy: falling through demotes the screenshot to the teams parser,
// which can manufacture an all-zero row from a rank screen's blue background
// (the 2026-07 bundle stored one as "unknown" that way). ParseScreenshot
// must fail fast instead — the per-file error lands in the failed-files
// ledger and the file is retried next run.
func TestParseScreenshot_ProbeErrorFailsFast(t *testing.T) {
	dir := t.TempDir()
	fakeTess := filepath.Join(dir, "tesseract")
	if err := os.WriteFile(fakeTess, []byte("#!/bin/sh\nexit 0\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	shot := filepath.Join(dir, "shot.png")
	f, err := os.Create(shot) // #nosec G304 -- temp dir path
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, image.NewRGBA(image.Rect(0, 0, 640, 360))); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	tesseract.SetPath(fakeTess)
	t.Cleanup(func() { tesseract.SetPath("tesseract") })

	prevDelays := *parser.TesseractRetryDelays
	*parser.TesseractRetryDelays = nil
	t.Cleanup(func() { *parser.TesseractRetryDelays = prevDelays })

	var mu sync.Mutex
	var regions []string
	original := *parser.RunTesseractFunc
	*parser.RunTesseractFunc = func(_ image.Image, spec parser.OCRSpec) (string, error) {
		mu.Lock()
		regions = append(regions, parser.SpecName(spec))
		mu.Unlock()
		return "", errors.New("ocr exploded")
	}
	t.Cleanup(func() { *parser.RunTesseractFunc = original })

	res, err := parser.ParseScreenshot(shot)
	if err == nil {
		t.Fatalf("persistent probe OCR error must fail the parse, got result %+v", res)
	}
	// Guard against a vacuous pass: if the fake binary fails LookPath (e.g.
	// no executable extension on Windows), ParseScreenshot errors BEFORE any
	// probe runs and the loop below asserts nothing. The error must be the
	// probe's, and the probe must actually have been attempted.
	if !strings.Contains(err.Error(), "rank probe") {
		t.Fatalf("error must come from the failed probe, got: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(regions) == 0 {
		t.Fatal("the rank probe was never OCR'd — the test asserted nothing")
	}
	for _, r := range regions {
		if r != "detect_rank" {
			t.Errorf("after the first probe errored, no further OCR may run; saw region %q (all: %v)", r, regions)
		}
	}
}
