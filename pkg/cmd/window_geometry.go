//go:build !serveronly

package cmd

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"recall/pkg/app"
	"recall/pkg/applog"
	"recall/pkg/windowgeom"
)

// saveDebounce collapses a drag into one write. Dragging a window emits a move
// event per frame, and the file is only interesting once the user lets go.
const saveDebounce = 400 * time.Millisecond

// windowSizer owns the desktop window's geometry: how big it opens, where it
// opens, and where the user last left it.
//
// It is registered as a Wails service for one reason — the ordering inside
// App.Run(). The platform layer caches the monitor list while constructing
// itself, then starts services, and only THEN creates the windows that were
// deferred at NewWithOptions time. ServiceStartup is therefore the single
// moment where the screens are known and the window does not exist yet, which
// is exactly what placing a window needs. Doing this any earlier is what the
// previous attempt got wrong: it asked the window which screen it was on
// before the window existed, got a nil screen and no error, and silently did
// nothing for months.
type windowSizer struct {
	path  string
	saved *windowgeom.Geometry

	wailsApp *application.App
	win      *application.WebviewWindow

	minOnce sync.Once

	mu         sync.Mutex
	latest     windowgeom.Geometry
	haveLatest bool
	// enforceMin is only set when the display can actually afford the layout
	// floor. On a screen smaller than the floor there is no floor to enforce,
	// and pushing one would shove the window off the edge. Written during
	// startup, read from a window hook, so it lives under the mutex with the
	// rest of the shared state.
	enforceMin  bool
	fingerprint string
	timer       *time.Timer
}

var _ app.WindowSizer = (*windowSizer)(nil)

// geometryPath is install-wide, deliberately: which window someone likes has
// nothing to do with which profile they are looking at, and switching profiles
// should not move the window. It also sits above the profile tree, which is
// what lets it be read before profiles have loaded — and the window is built
// before that.
func geometryPath() string {
	return filepath.Join(app.BaseDir(), "window.json")
}

// newWindowSizer reads whatever the last session left behind. It runs before
// the Wails app exists, because the window options it produces are needed at
// construction time.
func newWindowSizer(path string) *windowSizer {
	return &windowSizer{path: path, saved: windowgeom.Load(path)}
}

func (s *windowSizer) ServiceName() string { return "recall.windowSizer" }

// WindowOptions fills in the geometry half of the window options.
//
// Only the position can be decided here, and only as an opt-in: InitialPosition
// has no setter that can select WindowXY later — Center() is the sole writer of
// that field and it only ever writes WindowCentered. So the literal opts into
// explicit coordinates whenever a position was saved, and ServiceStartup can
// still downgrade to centered once it sees the monitors. The reverse is not
// possible.
//
// Note what is NOT set: MinWidth/MinHeight. Setting them here would make the
// SetSize call in ServiceStartup route through SetMinSize, which reads the
// not-yet-created window's size as 0x0, concludes the window is under the
// minimum, and rewrites the size we just asked for to the minimum itself. The
// floor is applied later instead, once the window can answer how big it is.
func (s *windowSizer) WindowOptions(base application.WebviewWindowOptions) application.WebviewWindowOptions {
	base.Width, base.Height = windowgeom.MinWidth, windowgeom.MinHeight
	if s.saved == nil {
		return base
	}
	base.Width, base.Height = s.saved.Width, s.saved.Height
	if s.saved.Maximized {
		base.StartState = application.WindowStateMaximised
	}
	if !s.saved.Centered {
		base.InitialPosition = application.WindowXY
		base.X, base.Y = s.saved.X, s.saved.Y
	}
	return base
}

// Attach hands the sizer the app and window once they exist, and wires the
// hooks that remember what the user does with the window.
func (s *windowSizer) Attach(wailsApp *application.App, win *application.WebviewWindow) {
	s.wailsApp = wailsApp
	s.win = win

	// Hooks, not listeners: listeners are dispatched one goroutine per event
	// with no ordering guarantee, so two moves can land out of order and
	// persist the older one. Hooks run synchronously in registration order.
	for _, event := range []events.WindowEventType{
		events.Common.WindowDidResize,
		events.Common.WindowDidMove,
		events.Common.WindowMaximise,
		events.Common.WindowUnMaximise,
		events.Common.WindowRestore,
	} {
		win.RegisterHook(event, func(*application.WindowEvent) { s.capture() })
	}

	// The runtime-ready hook is the first moment the window can answer
	// questions about itself, which is what the size floor needs.
	win.RegisterHook(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		s.minOnce.Do(s.applyMinSize)
	})

	// Closing does not mean quitting here — the default is to hide to the
	// tray — so this must never cancel the event, and must not panic: the
	// hook loop has no recovery of its own, and a panic would take the
	// systray's hide-to-tray hook down with it.
	win.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) {
		defer applog.RecoverPanic("windowgeom")
		s.capture()
		s.flush()
	})

	// Quitting from the tray never fires WindowClosing at all, so the debounced
	// write needs a backstop on the way out.
	wailsApp.OnShutdown(s.flush)
}

// ServiceStartup places the window. It never returns an error: a service that
// fails startup aborts the launch with no window at all, and no window is a
// far worse outcome than a badly placed one.
func (s *windowSizer) ServiceStartup(context.Context, application.ServiceOptions) error {
	s.place()
	return nil
}

// ServiceShutdown writes anything the debounce timer has not yet flushed.
func (s *windowSizer) ServiceShutdown() error {
	s.flush()
	return nil
}

// place applies the computed geometry to the not-yet-created window, using
// only the setters that write window options rather than talk to a native
// handle. Anything else here is a silent no-op.
//
// The screen list is only populated at this point on WINDOWS, which is what
// Recall ships: the platform layer caches monitors while constructing itself,
// before services start. macOS and Linux fill that cache later, inside the
// platform run loop, so `task dev` on a Mac sees an empty list and takes the
// fixed-default branch in Plan. That divergence is by design and is why the
// feature can only be signed off on Windows.
func (s *windowSizer) place() {
	if s.win == nil || s.wailsApp == nil {
		return
	}
	displays := s.displays()
	plan := windowgeom.Plan(s.saved, displays)

	s.win.SetSize(plan.Rect.Width, plan.Rect.Height)
	if plan.Centered {
		s.win.Center()
	} else {
		// Pre-creation this only writes options.X/Y, and with no target screen
		// set those are absolute virtual-desktop coordinates — which is what
		// returning to a second monitor needs. The "relative" in the name
		// describes what the call does to a LIVE window; here it is the only
		// exported way to reach those two fields.
		s.win.SetRelativePosition(plan.Rect.X, plan.Rect.Y)
	}
	if plan.Maximized {
		//nolint:misspell // Maximise is the framework's own method name.
		s.win.Maximise()
	}

	s.seed(plan, windowgeom.Fingerprint(displays))
}

// seed gives the record a complete starting value, so the first thing written
// is never a half-filled one — a window maximized before it is ever moved
// would otherwise persist a zero size.
func (s *windowSizer) seed(plan windowgeom.Placement, fingerprint string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.fingerprint = fingerprint
	s.enforceMin = plan.Rect.Width >= windowgeom.MinWidth && plan.Rect.Height >= windowgeom.MinHeight
	s.latest = windowgeom.Geometry{
		Width:       plan.Rect.Width,
		Height:      plan.Rect.Height,
		X:           plan.Rect.X,
		Y:           plan.Rect.Y,
		Centered:    plan.Centered,
		Maximized:   plan.Maximized,
		Fingerprint: fingerprint,
	}
}

func (s *windowSizer) displays() []windowgeom.Display {
	if s.wailsApp == nil {
		return nil
	}
	screens := s.wailsApp.Screen.GetAll()
	out := make([]windowgeom.Display, 0, len(screens))
	for _, screen := range screens {
		if screen == nil {
			continue
		}
		out = append(out, windowgeom.Display{
			WorkArea:       rectFrom(screen.WorkArea),
			PhysicalBounds: rectFrom(screen.PhysicalBounds),
			Scale:          screen.ScaleFactor,
			IsPrimary:      screen.IsPrimary,
		})
	}
	return out
}

func rectFrom(r application.Rect) windowgeom.Rect {
	return windowgeom.Rect{X: r.X, Y: r.Y, Width: r.Width, Height: r.Height}
}

// applyMinSize installs the layout floor once the window is live. Asking for
// it before then rewrites the window's size to the floor instead of bounding
// it (see WindowOptions).
func (s *windowSizer) applyMinSize() {
	s.mu.Lock()
	enforce := s.enforceMin
	s.mu.Unlock()

	if s.win == nil || !enforce {
		return
	}
	s.win.SetMinSize(windowgeom.MinWidth, windowgeom.MinHeight)
}

// capture takes one sample of where the window is now.
func (s *windowSizer) capture() {
	if s.win == nil || s.win.IsMinimised() || s.win.IsFullscreen() {
		// A minimized window is parked off its own monitor and reports a
		// position that means nothing; a fullscreen one reports the screen.
		return
	}
	maximized := s.win.IsMaximised()
	var rect windowgeom.Rect
	if !maximized {
		rect = rectFrom(s.win.Bounds())
	}
	s.record(maximized, rect)
}

// record folds one sample in. A maximized window contributes only the flag:
// its bounds ARE the maximized rect, and storing those as the restore size is
// what makes un-maximizing snap back to full screen forever after.
func (s *windowSizer) record(maximized bool, rect windowgeom.Rect) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.latest.Maximized = maximized
	if rect.Width > 0 && rect.Height > 0 {
		s.latest.X, s.latest.Y = rect.X, rect.Y
		s.latest.Width, s.latest.Height = rect.Width, rect.Height
		s.latest.Centered = false
	}
	s.latest.Fingerprint = s.fingerprint
	s.haveLatest = true
	s.scheduleLocked()
}

func (s *windowSizer) scheduleLocked() {
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(saveDebounce, s.flush)
}

func (s *windowSizer) flush() {
	s.mu.Lock()
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	geometry, ok := s.latest, s.haveLatest
	s.mu.Unlock()

	if !ok {
		return
	}
	if err := windowgeom.Save(s.path, geometry); err != nil {
		applog.Subsystem("desktop").Warn("could not save window geometry", "err", err)
	}
}

// Reset forgets the remembered window and re-applies the default, live, so the
// Settings button visibly does something instead of promising the next launch.
func (s *windowSizer) Reset() error {
	s.mu.Lock()
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	s.latest, s.haveLatest = windowgeom.Geometry{}, false
	s.mu.Unlock()

	if err := os.Remove(s.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("clear saved window geometry: %w", err)
	}
	s.applyDefault()
	return nil
}

func (s *windowSizer) applyDefault() {
	if s.win == nil {
		return
	}
	plan := windowgeom.Plan(nil, s.displays())
	if s.win.IsMaximised() {
		s.win.UnMaximise()
	}
	s.win.SetSize(plan.Rect.Width, plan.Rect.Height)
	s.win.Center()
	// The move events this triggers will re-record the new geometry; capturing
	// here too means the file is right even if none of them arrive.
	s.capture()
}
