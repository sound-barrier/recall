package parser

import (
	"errors"
	"image"
	"image/color"
	"testing"
)

// stubOCR swaps runTesseractFunc for the duration of the test. The fake
// returns text keyed on the `name` argument so each detector picks up the
// canned banner that matches its detection probe ("detect_summary",
// "detect_rank", "detect_personal"). Restoration uses t.Cleanup; do NOT
// pair these tests with t.Parallel — the var is process-global.
func stubOCR(t *testing.T, table map[string]string) {
	original := runTesseractFunc
	runTesseractFunc = func(_ image.Image, _, name, _, _ string) (string, error) {
		if s, ok := table[name]; ok {
			return s, nil
		}
		return "", nil
	}
	t.Cleanup(func() { runTesseractFunc = original })
}

func stubOCRError(t *testing.T, err error) {
	original := runTesseractFunc
	runTesseractFunc = func(_ image.Image, _, _, _, _ string) (string, error) {
		return "", err
	}
	t.Cleanup(func() { runTesseractFunc = original })
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
			if !isSummaryScreenshot(tinyImage(), t.TempDir()) {
				t.Errorf("expected SUMMARY detection for OCR text %q", text)
			}
		})
	}
}

func TestIsSummaryScreenshot_NegativeAndError(t *testing.T) {
	stubOCR(t, map[string]string{"detect_summary": "RANK PROGRESS\nALL HEROES"})
	if isSummaryScreenshot(tinyImage(), t.TempDir()) {
		t.Error("non-SUMMARY text must not trigger SUMMARY detection")
	}

	stubOCRError(t, errors.New("ocr blew up"))
	if isSummaryScreenshot(tinyImage(), t.TempDir()) {
		t.Error("OCR error must return false (fail-closed)")
	}
}

func TestIsRankScreenshot(t *testing.T) {
	stubOCR(t, map[string]string{"detect_rank": "some banner\nRANK PROGRESS\nfooter"})
	if !isRankScreenshot(tinyImage(), t.TempDir()) {
		t.Error("RANK PROGRESS keyword must trigger detection")
	}

	stubOCR(t, map[string]string{"detect_rank": "HEROES PLAYED"})
	if isRankScreenshot(tinyImage(), t.TempDir()) {
		t.Error("SUMMARY text must not trigger RANK detection")
	}

	stubOCRError(t, errors.New("boom"))
	if isRankScreenshot(tinyImage(), t.TempDir()) {
		t.Error("OCR error must return false (fail-closed)")
	}
}

func TestIsPersonalScreenshot(t *testing.T) {
	stubOCR(t, map[string]string{"detect_personal": "LUCIO\nKIRIKO\nALL HEROES"})
	if !isPersonalScreenshot(tinyImage(), t.TempDir()) {
		t.Error("ALL HEROES keyword must trigger PERSONAL detection")
	}

	stubOCR(t, map[string]string{"detect_personal": "HEROES PLAYED\nTOTAL PERFORMANCE"})
	if isPersonalScreenshot(tinyImage(), t.TempDir()) {
		t.Error("SUMMARY text must not trigger PERSONAL detection")
	}

	stubOCRError(t, errors.New("boom"))
	if isPersonalScreenshot(tinyImage(), t.TempDir()) {
		t.Error("OCR error must return false (fail-closed)")
	}
}

// Sanity check: the seam is genuinely swappable.
func TestRunTesseractFunc_Swappable(t *testing.T) {
	stubOCR(t, map[string]string{"foo": "bar"})
	got, err := runTesseractFunc(tinyImage(), t.TempDir(), "foo", "6", "")
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if got != "bar" {
		t.Errorf("got %q want bar", got)
	}
}
