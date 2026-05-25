package parser

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
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

// runTesseractFunc is the indirection both OCR helpers route through.
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

// ocrRaw writes the cropped region untouched (just upscaled) for Tesseract's
// own thresholding. Best for the right-side panel which mixes white digits and
// cyan labels — our custom thresholding tends to drop one or the other.
func ocrRaw(img image.Image, rect image.Rectangle, workDir, name, psm, whitelist string) (string, error) {
	sub := crop(img, rect)
	pre := upscale(sub, 2)
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
	// #nosec G204,G702 -- getTesseractPath() returns a value vetted by
	// validateTesseractPath at the boundary (safePathChars + canonical
	// + absolute + basename pinned to tesseract|tesseract.exe).
	cmd := exec.Command(getTesseractPath(), args...)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	HideWindow(cmd) // no-op on macOS/Linux; suppresses console flash on Windows
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("tesseract failed: %w (%s)", err, stderr.String())
	}
	out := stdout.String()
	if os.Getenv("OWMETRICS_DEBUG_DIR") != "" {
		// #nosec G703 -- workDir is from RECALL_DEBUG_DIR when this branch
		// is reachable (the env var also gates this whole block).
		_ = os.WriteFile(filepath.Join(workDir, name+".txt"), []byte(out), 0o600)
	}
	return out, nil
}
