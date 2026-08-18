package parser

import (
	"errors"
	"image"
	"time"

	"recall/pkg/tesseract"
)

// Preparing a region and reading it: the crop, the preprocessing variant, and
// the retry policy around the invocation.
//
// The invocation itself lives in pkg/tesseract. The retry policy stays HERE
// because it is a judgment about the parser's own failure modes — a screenshot
// still being flushed by the capture tool, an AV scan briefly holding the temp
// PNG — and because runTesseractFunc is the seam every parser test swaps to
// run without a Tesseract binary. A seam below the retry is what lets a test
// prove the retry.

// ocrSpec names one OCR invocation: where the debug artifacts land
// (workDir), the region's identifier in the dispatch vocabulary (name,
// also the debug filename), Tesseract's page-segmentation mode (psm)
// and character whitelist, and — for the raw/threshold preprocessors —
// the upscale factor and brightness cutoff. Bundled because the four
// strings traveled through every OCR helper positionally, and at a
// call site nothing said which string was which (the data-clump rule).
type ocrSpec struct {
	workDir   string
	name      string
	psm       string
	whitelist string
	// scale is the preprocess upscale factor; used by the raw and
	// threshold variants (the inverted pass is fixed at 3x).
	scale int
	// thresh is the brightness cutoff for the threshold variant only.
	thresh uint8
}

// runTesseractFunc is the indirection ocrInverted routes through.
// Production points at runTesseract; tests swap it (with t.Cleanup) to
// return canned strings keyed on spec.name — no Tesseract binary, no
// temp files, no exec.

// runTesseractFunc is the indirection every OCR call routes through.
// Production points at pkg/tesseract; tests swap it (with t.Cleanup) to
// return canned strings keyed on spec.name — no Tesseract binary, no
// temp files, no exec.
var runTesseractFunc = func(pre image.Image, spec ocrSpec) (string, error) {
	return tesseract.Run(pre, tesseract.Spec{
		WorkDir:   spec.workDir,
		Name:      spec.name,
		PSM:       spec.psm,
		Whitelist: spec.whitelist,
	})
}

// tesseractRetryDelays paces runTesseractWithRetry. Transient failures
// (a screenshot still being flushed by the capture tool, an AV scan
// briefly holding the binary or the temp PNG) resolve within a beat,
// so two short retries recover them while a genuinely broken call adds
// well under a second before failing for real. Tests shrink these.
var tesseractRetryDelays = []time.Duration{100 * time.Millisecond, 500 * time.Millisecond}

// runTesseractWithRetry is the retrying front for every OCR call:
// non-timeout failures get tesseractRetryDelays' worth of re-attempts. A
// timeout is never retried — it already consumed the full budget, and
// retrying a hung binary would triple every affected region's stall.
func runTesseractWithRetry(pre image.Image, spec ocrSpec) (string, error) {
	out, err := runTesseractFunc(pre, spec)
	for _, delay := range tesseractRetryDelays {
		if err == nil || errors.Is(err, tesseract.ErrTimeout) {
			return out, err
		}
		time.Sleep(delay)
		out, err = runTesseractFunc(pre, spec)
	}
	return out, err
}

// ocrInverted writes the cropped region as inverted-luminance grayscale (white
// in-game text becomes black, dark backgrounds become white) and 3x upscaled.
// Best for the row stats and header where text is solid white.
func ocrInverted(img image.Image, rect image.Rectangle, spec ocrSpec) (string, error) {
	sub := crop(img, rect)
	pre := preprocessInverted(sub)
	return runTesseractWithRetry(pre, spec)
}

// ocrRaw is ocrInverted's non-inverted sibling for colored / mid-tone text that
// inversion flattens. `scale` is the upscale factor — thin glyphs like the rank
// "-19%" want 6x where the default inverted pass uses 3x.
func ocrRaw(img image.Image, rect image.Rectangle, spec ocrSpec) (string, error) {
	sub := crop(img, rect)
	pre := preprocessRaw(sub, spec.scale)
	return runTesseractWithRetry(pre, spec)
}

// ocrThreshold binarises a bright-on-color region (pixels brighter than
// `thresh` → black, the rest → white) before OCR — for low-contrast pills like
// the rank "+N%" gain that the inverted and raw passes leave too faint to read
// at 1080p.
func ocrThreshold(img image.Image, rect image.Rectangle, spec ocrSpec) (string, error) {
	sub := crop(img, rect)
	pre := preprocessHighContrast(sub, spec.scale, spec.thresh)
	return runTesseractWithRetry(pre, spec)
}
