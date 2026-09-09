//go:build !serveronly

package cmd_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"

	"recall/pkg/cmd"
	"recall/pkg/windowgeom"
)

// What the window options carry at creation time, and why. The placement math
// itself is pinned in pkg/windowgeom; these cover the half that can only be
// expressed through the framework — the fields that have no setter afterwards,
// and the one field whose presence would quietly undo the sizing.

func sizerWith(t *testing.T, saved *windowgeom.Geometry) application.WebviewWindowOptions {
	t.Helper()
	path := filepath.Join(t.TempDir(), "window.json")
	if saved != nil {
		if err := windowgeom.Save(path, *saved); err != nil {
			t.Fatalf("seed geometry: %v", err)
		}
	}
	return cmd.NewWindowSizer(path).WindowOptions(application.WebviewWindowOptions{Title: "Recall"})
}

// The options must NOT carry a minimum size. SetSize routes through SetMinSize
// whenever a minimum is set, and SetMinSize asks the window how big it is — a
// window that does not exist yet answers 0x0, concludes it is under the
// minimum, and rewrites the size to the minimum instead of bounding it. Setting
// the floor here would make every window open at exactly the floor, which is
// the same class of silent failure this whole change exists to fix.
func TestWindowOptionsLeaveTheSizeFloorForLater(t *testing.T) {
	for name, saved := range map[string]*windowgeom.Geometry{
		"nothing saved": nil,
		"restoring":     {Width: 2048, Height: 1114, X: 100, Y: 100},
	} {
		t.Run(name, func(t *testing.T) {
			opts := sizerWith(t, saved)
			if opts.MinWidth != 0 || opts.MinHeight != 0 {
				t.Errorf("MinWidth/MinHeight = %d/%d, want 0/0 — a minimum here "+
					"rewrites Width/Height to itself before the window exists",
					opts.MinWidth, opts.MinHeight)
			}
			if opts.MaxWidth != 0 || opts.MaxHeight != 0 {
				t.Errorf("MaxWidth/MaxHeight = %d/%d, want 0/0 for the same reason",
					opts.MaxWidth, opts.MaxHeight)
			}
		})
	}
}

func TestWindowOptionsWithNothingSavedStayCentered(t *testing.T) {
	opts := sizerWith(t, nil)
	// WindowCentered is the zero value, so this asserts the default is left
	// alone rather than opted out of.
	if opts.InitialPosition != application.WindowCentered {
		t.Errorf("InitialPosition = %v, want centered", opts.InitialPosition)
	}
	if opts.X != 0 || opts.Y != 0 {
		t.Errorf("X/Y = %d/%d, want 0/0 when there is no saved position", opts.X, opts.Y)
	}
	if opts.StartState != application.WindowStateNormal {
		t.Errorf("StartState = %v, want normal", opts.StartState)
	}
	// A size still has to be present: the real one is computed once the
	// monitors are known, but the window must not be born at the framework's
	// own 800x600 default if that never happens.
	if opts.Width < windowgeom.MinWidth || opts.Height < windowgeom.MinHeight {
		t.Errorf("size = %dx%d, want at least the floor %dx%d",
			opts.Width, opts.Height, windowgeom.MinWidth, windowgeom.MinHeight)
	}
	if opts.Title != "Recall" {
		t.Errorf("Title = %q, want the caller's value preserved", opts.Title)
	}
}

// A saved position can only be honored by opting into explicit coordinates
// here. InitialPosition has no setter that selects WindowXY — Center() is the
// only writer of that field and it only ever writes WindowCentered — so this
// is the one chance to ask for it. The validation that may later reject the
// position can still downgrade to centered; it cannot upgrade.
func TestWindowOptionsOptIntoExplicitCoordinatesForASavedPosition(t *testing.T) {
	opts := sizerWith(t, &windowgeom.Geometry{Width: 1600, Height: 900, X: -2400, Y: 120})
	if opts.InitialPosition != application.WindowXY {
		t.Fatalf("InitialPosition = %v, want WindowXY — X/Y are ignored otherwise",
			opts.InitialPosition)
	}
	if opts.X != -2400 || opts.Y != 120 {
		t.Errorf("X/Y = %d/%d, want -2400/120", opts.X, opts.Y)
	}
	if opts.Width != 1600 || opts.Height != 900 {
		t.Errorf("size = %dx%d, want 1600x900", opts.Width, opts.Height)
	}
}

func TestWindowOptionsLeaveACenteredRecordCentered(t *testing.T) {
	opts := sizerWith(t, &windowgeom.Geometry{Width: 1600, Height: 900, Centered: true})
	if opts.InitialPosition != application.WindowCentered {
		t.Errorf("InitialPosition = %v, want centered", opts.InitialPosition)
	}
}

func TestWindowOptionsRestoreMaximizedWithTheUnderlyingSize(t *testing.T) {
	opts := sizerWith(t, &windowgeom.Geometry{Width: 1600, Height: 900, X: 40, Y: 40, Maximized: true})
	if opts.StartState != application.WindowStateMaximised {
		t.Errorf("StartState = %v, want the maximized start state", opts.StartState)
	}
	// The size travels with the flag: it is the size to return to when the
	// user un-maximizes, not the size to open at.
	if opts.Width != 1600 || opts.Height != 900 {
		t.Errorf("restore size = %dx%d, want 1600x900", opts.Width, opts.Height)
	}
}

func TestWindowOptionsIgnoreAnUnusableSavedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "window.json")
	if err := os.WriteFile(path, []byte(`{"width": 16`), 0o600); err != nil {
		t.Fatal(err)
	}
	opts := cmd.NewWindowSizer(path).WindowOptions(application.WebviewWindowOptions{})
	if opts.InitialPosition != application.WindowCentered {
		t.Errorf("InitialPosition = %v, want centered — a truncated file is not a position",
			opts.InitialPosition)
	}
	if opts.Width < windowgeom.MinWidth {
		t.Errorf("width = %d, want at least the floor", opts.Width)
	}
}

// TestAPendingWindowCannotSayWhichScreenItIsOn pins the framework behavior the
// whole design rests on, and the exact fault that made the previous attempt a
// no-op for months: a window created before the app runs is only queued, so
// asking it for its screen returns nil — with a nil error, which is why the
// old guard swallowed it in silence and nothing ever resized. If a future Wails
// upgrade makes this answer a real screen, the placement work could move back
// to window creation and this test is the signal.
func TestAPendingWindowCannotSayWhichScreenItIsOn(t *testing.T) {
	win := application.NewWindow(application.WebviewWindowOptions{Width: 1024, Height: 768})
	screen, err := win.GetScreen()
	if err != nil {
		t.Fatalf("GetScreen() error = %v, want nil (the nil error is the point)", err)
	}
	if screen != nil {
		t.Fatalf("GetScreen() = %+v, want nil for a window that has not been run", screen)
	}
}
