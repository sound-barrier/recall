package parser_test

import (
	"errors"
	"image"
	"image/color"
	"testing"

	"recall/pkg/parser"
)

// stubOCR swaps runTesseractFunc for the duration of the test. The fake
// returns text keyed on the `name` argument so each detector picks up the
// canned banner that matches its detection probe ("detect_summary",
// "detect_rank", "detect_personal"). Restoration uses t.Cleanup; do NOT
// pair these tests with t.Parallel — the var is process-global.
func stubOCR(t *testing.T, table map[string]string) {
	t.Helper()
	original := *parser.RunTesseractFunc
	*parser.RunTesseractFunc = func(_ image.Image, spec parser.OCRSpec) (string, error) { //nolint:unparam // signature fixed by RunTesseractFunc
		if s, ok := table[parser.SpecName(spec)]; ok {
			return s, nil
		}
		return "", nil
	}
	t.Cleanup(func() { *parser.RunTesseractFunc = original })
}

func stubOCRError(t *testing.T, err error) {
	t.Helper()
	original := *parser.RunTesseractFunc
	*parser.RunTesseractFunc = func(_ image.Image, _ parser.OCRSpec) (string, error) {
		return "", err
	}
	t.Cleanup(func() { *parser.RunTesseractFunc = original })
}

// tinyImage returns a 200×200 black image — large enough that the
// detectors' crop math doesn't degenerate, small enough that preprocessing
// is fast.
func tinyImage() image.Image {
	img := image.NewRGBA(image.Rect(0, 0, 200, 200))
	for y := range 200 {
		for x := range 200 {
			img.Set(x, y, color.Black)
		}
	}
	return img
}

func TestIsSummaryScreenshot_PositiveKeywords(t *testing.T) {
	positives := []string{
		"some chrome\nHEROES PLAYED\nmore",
		"TOTAL PERFORMANCE",
		"junk PERCENT PLAYED junk",
		// Case-insensitive: the detector upper-cases before checking.
		"heroes played",
	}
	for _, text := range positives {
		t.Run(text, func(t *testing.T) {
			stubOCR(t, map[string]string{"detect_summary": text})
			ok, err := parser.IsSummaryScreenshot(tinyImage(), t.TempDir())
			if err != nil {
				t.Fatalf("probe error: %v", err)
			}
			if !ok {
				t.Errorf("expected SUMMARY detection for OCR text %q", text)
			}
		})
	}
}

func TestIsSummaryScreenshot_NegativeAndError(t *testing.T) {
	stubOCR(t, map[string]string{"detect_summary": "RANK PROGRESS\nALL HEROES"})
	if ok, err := parser.IsSummaryScreenshot(tinyImage(), t.TempDir()); err != nil || ok {
		t.Errorf("non-SUMMARY text must not trigger SUMMARY detection (ok=%v err=%v)", ok, err)
	}

	// An OCR error must PROPAGATE — the old fail-closed false silently
	// demoted the screenshot to the teams fall-through.
	stubOCRError(t, errors.New("ocr blew up"))
	if ok, err := parser.IsSummaryScreenshot(tinyImage(), t.TempDir()); err == nil || ok {
		t.Errorf("OCR error must propagate, got (ok=%v err=%v)", ok, err)
	}
}

func TestIsRankScreenshot(t *testing.T) {
	stubOCR(t, map[string]string{"detect_rank": "some banner\nRANK PROGRESS\nfooter"})
	if ok, err := parser.IsRankScreenshot(tinyImage(), t.TempDir()); err != nil || !ok {
		t.Errorf("RANK PROGRESS keyword must trigger detection (ok=%v err=%v)", ok, err)
	}

	stubOCR(t, map[string]string{"detect_rank": "HEROES PLAYED"})
	if ok, err := parser.IsRankScreenshot(tinyImage(), t.TempDir()); err != nil || ok {
		t.Errorf("SUMMARY text must not trigger RANK detection (ok=%v err=%v)", ok, err)
	}

	stubOCRError(t, errors.New("boom"))
	if ok, err := parser.IsRankScreenshot(tinyImage(), t.TempDir()); err == nil || ok {
		t.Errorf("OCR error must propagate, got (ok=%v err=%v)", ok, err)
	}
}

func TestIsPersonalScreenshot(t *testing.T) {
	stubOCR(t, map[string]string{"detect_personal": "LUCIO\nKIRIKO\nALL HEROES"})
	if ok, err := parser.IsPersonalScreenshot(tinyImage(), t.TempDir()); err != nil || !ok {
		t.Errorf("ALL HEROES keyword must trigger PERSONAL detection (ok=%v err=%v)", ok, err)
	}

	stubOCR(t, map[string]string{"detect_personal": "HEROES PLAYED\nTOTAL PERFORMANCE"})
	if ok, err := parser.IsPersonalScreenshot(tinyImage(), t.TempDir()); err != nil || ok {
		t.Errorf("SUMMARY text must not trigger PERSONAL detection (ok=%v err=%v)", ok, err)
	}

	stubOCRError(t, errors.New("boom"))
	if ok, err := parser.IsPersonalScreenshot(tinyImage(), t.TempDir()); err == nil || ok {
		t.Errorf("OCR error must propagate, got (ok=%v err=%v)", ok, err)
	}
}

// Sanity check: the seam is genuinely swappable.
func TestRunTesseractFunc_Swappable(t *testing.T) {
	stubOCR(t, map[string]string{"foo": "bar"})
	got, err := (*parser.RunTesseractFunc)(tinyImage(), parser.NewOCRSpec(t.TempDir(), "foo", "6", ""))
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if got != "bar" {
		t.Errorf("got %q want bar", got)
	}
}
