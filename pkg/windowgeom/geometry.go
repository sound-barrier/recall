// Package windowgeom decides how big the desktop window opens, where it opens,
// and remembers where the user last put it.
//
// It carries no Wails dependency on purpose. The shell in pkg/cmd adapts the
// framework's screen list into the Display values here, which keeps the
// placement rules — where every interesting bug in this feature lives — under
// a plain table test instead of a running desktop. A monitor that was
// unplugged between two launches is trivial to write down and impossible to
// arrange by hand.
package windowgeom

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Rect is a window or screen rectangle in logical (DPI-scaled) pixels, y-down,
// with the origin at the top-left of the primary display. That is the space
// every coordinate in this package lives in; a monitor left of the primary has
// a negative X.
type Rect struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Display is one monitor, as the placement rules need to see it.
type Display struct {
	// WorkArea is the usable region — the taskbar, dock and menu bar removed.
	// Sizing measures against this and not the full bounds, so the default
	// window cannot open underneath the taskbar.
	WorkArea Rect
	// PhysicalBounds is the unscaled rectangle. It feeds the layout
	// fingerprint only, because it is the one field the framework never
	// re-packs as displays are added, removed or rescaled.
	PhysicalBounds Rect
	Scale          float32
	IsPrimary      bool
}

// Geometry is what survives between launches.
type Geometry struct {
	Width  int `json:"width"`
	Height int `json:"height"`
	X      int `json:"x"`
	Y      int `json:"y"`
	// Centered records "no particular position" instead of spelling it as
	// (0,0): Windows reads an explicit origin of exactly (0,0) as "unset" and
	// substitutes its own default placement, so the one coordinate a user can
	// most plausibly land on is the one that cannot be stored.
	Centered bool `json:"centered"`
	// Maximized travels with — not instead of — the rect below it. The rect is
	// always the RESTORED size, so un-maximizing after a relaunch returns the
	// window to the size the user chose rather than to a default.
	Maximized bool `json:"maximized"`
	// Fingerprint identifies the monitor layout the position was recorded on.
	// A mismatch means the desk changed, and a position from the old desk is
	// meaningless even when it happens to land on a live screen.
	Fingerprint string `json:"fingerprint"`
}

// Rect returns the saved window rectangle.
func (g Geometry) Rect() Rect {
	return Rect{X: g.X, Y: g.Y, Width: g.Width, Height: g.Height}
}

// Load reads the saved geometry, or returns nil when there is none to read.
//
// Every failure is "no saved geometry", deliberately: a first launch, a
// hand-edited file, a truncated write from a power cut and an unreadable path
// all mean the same thing to a caller whose job is to open a window. There is
// no error return because there is no caller who could do anything but fall
// back to the default, and a window that refuses to open is worse than a
// window in the wrong place.
func Load(path string) *Geometry {
	raw, err := os.ReadFile(path) //nolint:gosec // path is built from the app's own base dir, never user input
	if err != nil {
		return nil
	}
	var g Geometry
	if err := json.Unmarshal(raw, &g); err != nil {
		return nil
	}
	if g.Width <= 0 || g.Height <= 0 {
		// A zero size is not "unset" downstream — the framework rewrites it to
		// its own 800x600 default — so refuse it here where it still reads as
		// missing data.
		return nil
	}
	return &g
}

// Save writes the geometry, creating the directory if needed.
func Save(path string, g Geometry) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("window geometry dir: %w", err)
	}
	raw, err := json.MarshalIndent(g, "", "  ")
	if err != nil {
		return fmt.Errorf("window geometry encode: %w", err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return fmt.Errorf("window geometry write: %w", err)
	}
	return nil
}

// Fingerprint identifies a monitor layout independently of the order the OS
// happens to enumerate it in.
//
// It is built from physical bounds, scale and which display is primary —
// never from a screen ID, because on Windows those derive from HMONITOR
// handles, which are not stable across sessions. Sorting is what makes it
// order-independent: the enumeration order is not stable either.
func Fingerprint(displays []Display) string {
	parts := make([]string, 0, len(displays))
	for _, d := range displays {
		b := d.PhysicalBounds
		parts = append(parts, fmt.Sprintf("%d,%d,%dx%d@%.2f/%t",
			b.X, b.Y, b.Width, b.Height, d.Scale, d.IsPrimary))
	}
	sort.Strings(parts)
	return strings.Join(parts, ";")
}
