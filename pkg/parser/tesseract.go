package parser

import (
	"bytes"
	"context"
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

// runTesseractFunc is the indirection ocrInverted routes through.
// Production points at runTesseract; tests swap it (with t.Cleanup) to
// return canned strings keyed on the `name` argument — no Tesseract
// binary, no temp files, no exec.
var runTesseractFunc = runTesseract

// ocrInverted writes the cropped region as inverted-luminance grayscale (white
// in-game text becomes black, dark backgrounds become white) and 3x upscaled.
// Best for the row stats and header where text is solid white.
func ocrInverted(img image.Image, rect image.Rectangle, workDir, name, psm, whitelist string) (string, error) {
	sub := crop(img, rect)
	pre := preprocessInverted(sub)
	return runTesseractFunc(pre, workDir, name, psm, whitelist)
}

// ocrRaw is ocrInverted's non-inverted sibling for colored / mid-tone text that
// inversion flattens. `scale` is the upscale factor — thin glyphs like the rank
// "-19%" want 6x where the default inverted pass uses 3x.
func ocrRaw(img image.Image, rect image.Rectangle, workDir, name string, scale int, psm, whitelist string) (string, error) {
	sub := crop(img, rect)
	pre := preprocessRaw(sub, scale)
	return runTesseractFunc(pre, workDir, name, psm, whitelist)
}

// ocrThreshold binarises a bright-on-color region (pixels brighter than
// `thresh` → black, the rest → white) before OCR — for low-contrast pills like
// the rank "+N%" gain that the inverted and raw passes leave too faint to read
// at 1080p.
func ocrThreshold(img image.Image, rect image.Rectangle, workDir, name string, scale int, thresh uint8, psm, whitelist string) (string, error) {
	sub := crop(img, rect)
	pre := preprocessHighContrast(sub, scale, thresh)
	return runTesseractFunc(pre, workDir, name, psm, whitelist)
}

func runTesseract(pre image.Image, workDir, name, psm, whitelist string) (string, error) {
	inPath := filepath.Join(workDir, name+".png")
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

	args := []string{inPath, "-", "--psm", psm}
	if whitelist != "" {
		args = append(args, "-c", "tessedit_char_whitelist="+whitelist)
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
			return "", fmt.Errorf("tesseract timed out after %s: %w", timeout, err)
		}
		return "", fmt.Errorf("tesseract failed: %w (%s)", err, stderr.String())
	}
	out := stdout.String()
	if os.Getenv("RECALL_DEBUG_DIR") != "" {
		// #nosec G703 -- workDir is from RECALL_DEBUG_DIR when this branch
		// is reachable (the env var also gates this whole block).
		_ = os.WriteFile(filepath.Join(workDir, name+".txt"), []byte(out), 0o600)
	}
	return out, nil
}
