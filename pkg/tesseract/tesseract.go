// Package tesseract invokes the Tesseract CLI.
//
// Carved out of pkg/parser because running an external binary is a different
// reason to change than reading fields off a screenshot: the path is
// user-configurable and has to be validated, the invocation is bounded by a
// timeout, and on Windows it must be told not to flash a console window. None
// of that moves when a season restyles a caption, and all of it carries a
// security surface the extraction code does not.
//
// What deliberately did NOT come along is the retry policy and the
// preprocessing. Both are the caller's judgment about ITS OWN failure modes —
// which crops are worth a second attempt, which want inverting — so they stay
// in pkg/parser, above this package's one job.
package tesseract

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
// app overrides this at startup via SetPath, sourcing the
// value from data/settings.json.
var (
	tessPathMu sync.RWMutex
	tessPath   = "tesseract"
)

// SetPath swaps the binary path the package will use for
// subsequent OCR calls. Safe to call concurrently with parses; a
// torn read across a path change yields either the old or new value,
// both of which are valid choices for that particular invocation.
func SetPath(p string) {
	p = strings.TrimSpace(p)
	if p == "" {
		return
	}
	tessPathMu.Lock()
	tessPath = p
	tessPathMu.Unlock()
}

func Path() string {
	tessPathMu.RLock()
	defer tessPathMu.RUnlock()
	return tessPath
}

// defaultTimeout bounds a single Tesseract invocation. OCR on one
// screenshot region takes 1-3s on ordinary hardware; without a bound, a
// hung binary wedges the single-flight parse slot until app restart.
const defaultTimeout = 2 * time.Minute

var (
	tessTimeoutMu sync.RWMutex
	tessTimeout   = defaultTimeout
)

// SetTimeout bounds each Tesseract invocation for subsequent OCR
// calls. Non-positive durations restore the default. Same concurrency
// contract as SetPath: a torn read across a change yields either
// the old or new value, both valid for that invocation.
func SetTimeout(d time.Duration) {
	if d <= 0 {
		d = defaultTimeout
	}
	tessTimeoutMu.Lock()
	tessTimeout = d
	tessTimeoutMu.Unlock()
}

func timeout() time.Duration {
	tessTimeoutMu.RLock()
	defer tessTimeoutMu.RUnlock()
	return tessTimeout
}

// ErrTimeout marks an invocation killed by the per-call timeout.
// Exported so a caller's retry policy can skip it — a timeout already
// consumed the full budget, and retrying a hung binary would triple every
// affected region's stall.
var ErrTimeout = errors.New("tesseract timed out")

// Spec names one invocation: where the debug artifacts land (WorkDir), the
// region's identifier in the caller's dispatch vocabulary (Name, also the
// debug filename), and Tesseract's page-segmentation mode and character
// whitelist.
//
// WorkDir and Name are the caller's contract to keep: Run writes
// <WorkDir>/<Name>.png and cannot tell a temp directory from anywhere else, so
// neither may carry user input. pkg/parser satisfies this with an
// os.MkdirTemp directory and a fixed name per region.
type Spec struct {
	WorkDir   string
	Name      string
	PSM       string
	Whitelist string
}

func Run(pre image.Image, spec Spec) (string, error) {
	inPath := filepath.Join(spec.WorkDir, spec.Name+".png")
	// #nosec G304,G703 -- Spec.WorkDir and Spec.Name are the CALLER's to
	// constrain, and this package cannot check them: in pkg/parser, WorkDir is
	// os.MkdirTemp output or RECALL_DEBUG_DIR (a developer opt-in) and Name is
	// a fixed identifier from the dispatch table, never user input. That is the
	// contract Spec's doc comment states; a caller that breaks it writes where
	// it asked to write.
	f, err := os.Create(inPath)
	if err != nil {
		return "", err
	}
	if err := png.Encode(f, pre); err != nil {
		_ = f.Close()
		return "", err
	}
	_ = f.Close()

	args := []string{inPath, "-", "--psm", spec.PSM}
	if spec.Whitelist != "" {
		args = append(args, "-c", "tessedit_char_whitelist="+spec.Whitelist)
	}
	var stdout, stderr bytes.Buffer
	bound := timeout()
	ctx, cancel := context.WithTimeout(context.Background(), bound)
	defer cancel()
	// #nosec G204,G702 -- the binary path is validated where it ENTERS the
	// app, not here: pkg/app's validateTesseractPath runs on the user-supplied
	// Settings value (safePathChars + canonical + absolute + basename pinned to
	// tesseract|tesseract.exe) before calling SetPath. SetPath itself only
	// trims and stores, so this exec is exactly as safe as the boundary that
	// fed it — which is why the validation must stay at that boundary and not
	// migrate in here, where it would run on every invocation instead of once
	// per settings change.
	cmd := exec.CommandContext(ctx, Path(), args...)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	// The context kill only reaches the direct child. If that child spawned
	// helpers holding the stdout/stderr pipes open, Wait would block until
	// THEY exit — WaitDelay force-closes the pipes after the kill so the
	// invocation stays bounded even then.
	cmd.WaitDelay = bound
	HideWindow(cmd) // no-op on macOS/Linux; suppresses console flash on Windows
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("%w after %s: %w", ErrTimeout, bound, err)
		}
		return "", fmt.Errorf("tesseract failed: %w (%s)", err, stderr.String())
	}
	out := stdout.String()
	if os.Getenv("RECALL_DEBUG_DIR") != "" {
		// #nosec G703 -- workDir is from RECALL_DEBUG_DIR when this branch
		// is reachable (the env var also gates this whole block).
		_ = os.WriteFile(filepath.Join(spec.WorkDir, spec.Name+".txt"), []byte(out), 0o600)
	}
	return out, nil
}
