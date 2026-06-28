//go:build !serveronly

package cmd

import (
	"math"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// minWindowW / minWindowH is the historical fixed default — the floor so
	// a small display never gets a smaller window than the app used to open.
	minWindowW = 1024
	minWindowH = 768
	// windowScreenFraction sizes the window to a comfortable share of the
	// screen, so it scales up on large (1440p+) displays instead of staying
	// the cramped fixed default.
	windowScreenFraction = 0.75
)

// windowSizeForScreen picks the initial window size for a screen of the given
// LOGICAL dimensions: a fraction of the screen, floored at the historical
// default, and never larger than the screen itself. A non-positive dimension
// (screen size unknown) falls back to the default so a probe failure can't
// yield a degenerate window.
func windowSizeForScreen(screenW, screenH int) (w, h int) {
	return scaleDim(screenW, minWindowW), scaleDim(screenH, minWindowH)
}

func scaleDim(screen, minimum int) int {
	if screen <= 0 {
		return minimum
	}
	scaled := max(int(math.Round(float64(screen)*windowScreenFraction)), minimum)
	return min(scaled, screen)
}

// sizeWindowToScreen resizes the window to windowSizeForScreen of the display it
// opened on and centres it. Best-effort: any runtime error leaves the window at
// its creation size.
func sizeWindowToScreen(win *application.WebviewWindow) {
	screen, err := win.GetScreen()
	if err != nil || screen == nil {
		return
	}
	w, h := windowSizeForScreen(screen.Size.Width, screen.Size.Height)
	win.SetSize(w, h)
	win.Center()
}
