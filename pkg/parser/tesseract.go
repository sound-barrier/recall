package parser

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// tessPath is the path or command name used to invoke Tesseract.
// Defaults to a bare "tesseract" (PATH lookup) so unit tests and
// command-line use keep working without any configuration. The Wails
// app overrides this at startup via SetTesseractPath, sourcing the
// value from data/settings.json.
var (
	tessPathMu sync.RWMutex
	tessPath   = "tesseract"
)

// SetTesseractPath swaps the binary path the package will use for
// subsequent OCR calls. Safe to call concurrently with parses; a
// torn read across a path change yields either the old or new value,
// both of which are valid choices for that particular invocation.
func SetTesseractPath(p string) {
	p = strings.TrimSpace(p)
	if p == "" {
		return
	}
	tessPathMu.Lock()
	tessPath = p
	tessPathMu.Unlock()
}

func getTesseractPath() string {
	tessPathMu.RLock()
	defer tessPathMu.RUnlock()
	return tessPath
}

// defaultTesseractTimeout bounds a single Tesseract invocation. OCR on one
// screenshot region takes 1-3s on ordinary hardware; without a bound, a
// hung binary wedges the single-flight parse slot until app restart.
const defaultTesseractTimeout = 2 * time.Minute

var (
	tessTimeoutMu sync.RWMutex
	tessTimeout   = defaultTesseractTimeout
)

// SetTesseractTimeout bounds each Tesseract invocation for subsequent OCR
// calls. Non-positive durations restore the default. Same concurrency
// contract as SetTesseractPath: a torn read across a change yields either
// the old or new value, both valid for that invocation.
func SetTesseractTimeout(d time.Duration) {
	if d <= 0 {
		d = defaultTesseractTimeout
	}
	tessTimeoutMu.Lock()
	tessTimeout = d
	tessTimeoutMu.Unlock()
}

func getTesseractTimeout() time.Duration {
	tessTimeoutMu.RLock()
	defer tessTimeoutMu.RUnlock()
	return tessTimeout
}

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
var runTesseractFunc = runTesseract

// errTesseractTimeout marks an invocation killed by the per-call
// timeout. Distinguished so the retry wrapper can skip it — a timeout
// already consumed the full budget, and retrying a hung binary would
// triple every affected region's stall.
var errTesseractTimeout = errors.New("tesseract timed out")

// tesseractRetryDelays paces runTesseractWithRetry. Transient failures
// (a screenshot still being flushed by the capture tool, an AV scan
// briefly holding the binary or the temp PNG) resolve within a beat,
// so two short retries recover them while a genuinely broken call adds
// well under a second before failing for real. Tests shrink these.
var tesseractRetryDelays = []time.Duration{100 * time.Millisecond, 500 * time.Millisecond}

// runTesseractWithRetry is the retrying front for every OCR call:
// non-timeout failures get tesseractRetryDelays' worth of re-attempts.
func runTesseractWithRetry(pre image.Image, spec ocrSpec) (string, error) {
	out, err := runTesseractFunc(pre, spec)
	for _, delay := range tesseractRetryDelays {
		if err == nil || errors.Is(err, errTesseractTimeout) {
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

func runTesseract(pre image.Image, spec ocrSpec) (string, error) {
	inPath := filepath.Join(spec.workDir, spec.name+".png")
	// #nosec G304,G703 -- workDir is always os.MkdirTemp output or
	// RECALL_DEBUG_DIR (developer opt-in); `name` is a fixed
	// identifier from the dispatch table, never user input.
	f, err := os.Create(inPath)
	if err != nil {
		return "", err
	}
	if err := png.Encode(f, pre); err != nil {
		_ = f.Close()
		return "", err
	}
	_ = f.Close()

	args := []string{inPath, "-", "--psm", spec.psm}
	if spec.whitelist != "" {
		args = append(args, "-c", "tessedit_char_whitelist="+spec.whitelist)
	}
	var stdout, stderr bytes.Buffer
	timeout := getTesseractTimeout()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	// #nosec G204,G702 -- getTesseractPath() returns a value vetted by
	// validateTesseractPath at the boundary (safePathChars + canonical
	// + absolute + basename pinned to tesseract|tesseract.exe).
	cmd := exec.CommandContext(ctx, getTesseractPath(), args...)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	// The context kill only reaches the direct child. If that child spawned
	// helpers holding the stdout/stderr pipes open, Wait would block until
	// THEY exit — WaitDelay force-closes the pipes after the kill so the
	// invocation stays bounded even then.
	cmd.WaitDelay = timeout
	HideWindow(cmd) // no-op on macOS/Linux; suppresses console flash on Windows
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("%w after %s: %w", errTesseractTimeout, timeout, err)
		}
		return "", fmt.Errorf("tesseract failed: %w (%s)", err, stderr.String())
	}
	out := stdout.String()
	if os.Getenv("RECALL_DEBUG_DIR") != "" {
		// #nosec G703 -- workDir is from RECALL_DEBUG_DIR when this branch
		// is reachable (the env var also gates this whole block).
		_ = os.WriteFile(filepath.Join(spec.workDir, spec.name+".txt"), []byte(out), 0o600)
	}
	return out, nil
}
