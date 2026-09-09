//go:build !serveronly

package windowgeom_test

import (
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/windowgeom"
)

// The window has to open somewhere usable no matter what the last session
// wrote or what the desk looks like now. These pin that: the size the user
// gets on a fresh install, and the recovery behavior for every remembered
// position that has since stopped making sense. The unplugged-monitor and
// mixed-DPI cases are the reason this logic lives in a package with no Wails
// dependency — they are two lines to write down here and an afternoon of
// cable-swapping to arrange by hand.

// screen builds a display whose work area is the full bounds inset by a
// bottom taskbar, which is the shape every Windows monitor actually has. Every
// layout here is a single row of monitors, which is what a desk looks like, so
// screen builds them at y=0; every layout here is a single row of
// monitors, which is what a desk looks like.
func screen(x, w, h int, scale float32, primary bool) windowgeom.Display {
	const taskbar = 48
	return windowgeom.Display{
		WorkArea:       windowgeom.Rect{X: x, Width: w, Height: h - taskbar},
		PhysicalBounds: windowgeom.Rect{X: x, Width: w, Height: h},
		Scale:          scale,
		IsPrimary:      primary,
	}
}

func oneScreen1080p() []windowgeom.Display {
	return []windowgeom.Display{screen(0, 1920, 1080, 1, true)}
}

func oneScreen1440p() []windowgeom.Display {
	return []windowgeom.Display{screen(0, 2560, 1440, 1, true)}
}

// dualLeftSecondary puts the secondary monitor to the LEFT of the primary, so
// its coordinates are negative. A sign bug hides completely on a right-hand
// secondary, which is the layout everyone tests by accident.
func dualLeftSecondary() []windowgeom.Display {
	return []windowgeom.Display{
		screen(0, 1920, 1080, 1, true),
		screen(-2560, 2560, 1440, 1, false),
	}
}

func TestPlanFirstLaunchTakesAShareOfTheWorkArea(t *testing.T) {
	tests := []struct {
		name         string
		displays     []windowgeom.Display
		wantW, wantH int
	}{
		// 80% of the work area, which is the display minus the taskbar — not
		// 80% of the display, or the window opens underneath it.
		{"1080p", oneScreen1080p(), 1536, 826},
		{"1440p", oneScreen1440p(), 2048, 1114},
		{"4K", []windowgeom.Display{screen(0, 3840, 2160, 1, true)}, 3072, 1690},
		// A small laptop cannot give 80% and the floor at once. It fits on
		// screen instead: an unreachable window is worse than a cramped one.
		{"below the floor", []windowgeom.Display{screen(0, 1280, 720, 1, true)}, 1024, 672},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := windowgeom.Plan(nil, tc.displays)
			if got.Rect.Width != tc.wantW || got.Rect.Height != tc.wantH {
				t.Errorf("size = %dx%d, want %dx%d",
					got.Rect.Width, got.Rect.Height, tc.wantW, tc.wantH)
			}
			if !got.Centered {
				t.Error("a first launch should be centered")
			}
			if got.Maximized {
				t.Error("a first launch should not be maximized")
			}
		})
	}
}

func TestPlanWithNoScreenInformationOpensAtTheFloor(t *testing.T) {
	// macOS and Linux fill their screen cache after startup services run, so
	// the list really is empty there. Compute nothing from zeroes.
	got := windowgeom.Plan(nil, nil)
	if got.Rect.Width != windowgeom.MinWidth || got.Rect.Height != windowgeom.MinHeight {
		t.Errorf("size = %dx%d, want the floor %dx%d",
			got.Rect.Width, got.Rect.Height, windowgeom.MinWidth, windowgeom.MinHeight)
	}
	if !got.Centered {
		t.Error("want centered")
	}
}

func TestPlanRestoresAPositionThatStillFits(t *testing.T) {
	displays := dualLeftSecondary()
	// Parked on the left-hand secondary, where every coordinate is negative.
	saved := &windowgeom.Geometry{
		Width: 2048, Height: 1114, X: -2400, Y: 120,
		Fingerprint: windowgeom.Fingerprint(displays),
	}
	got := windowgeom.Plan(saved, displays)
	if got.Centered {
		t.Fatal("a position that still fits should be restored, not centered")
	}
	want := windowgeom.Rect{X: -2400, Y: 120, Width: 2048, Height: 1114}
	if got.Rect != want {
		t.Errorf("rect = %+v, want %+v", got.Rect, want)
	}
}

func TestPlanCarriesMaximizedWithTheRestoredSize(t *testing.T) {
	displays := oneScreen1440p()
	saved := &windowgeom.Geometry{
		Width: 1400, Height: 900, X: 100, Y: 100, Maximized: true,
		Fingerprint: windowgeom.Fingerprint(displays),
	}
	got := windowgeom.Plan(saved, displays)
	if !got.Maximized {
		t.Error("maximized should survive a relaunch")
	}
	// The rect stays the RESTORED size. Storing the maximized rect instead is
	// what makes un-maximizing snap to full screen forever after.
	if got.Rect.Width != 1400 || got.Rect.Height != 900 {
		t.Errorf("restore size = %dx%d, want 1400x900", got.Rect.Width, got.Rect.Height)
	}
}

func TestPlanRecoversFromAPositionThatNoLongerLands(t *testing.T) {
	displays := oneScreen1080p()
	fp := windowgeom.Fingerprint(displays)
	tests := []struct {
		name  string
		saved *windowgeom.Geometry
	}{
		// The second monitor was unplugged; these coordinates address nothing.
		{"monitor gone", &windowgeom.Geometry{Width: 1600, Height: 900, X: 3000, Y: 200, Fingerprint: fp}},
		// The Windows parking spot for a minimized window.
		{"parked far off-screen", &windowgeom.Geometry{Width: 1600, Height: 900, X: -32000, Y: -32000, Fingerprint: fp}},
		// Mostly off the right edge: a sliver is visible but not enough to work with.
		{"barely overlapping", &windowgeom.Geometry{Width: 1600, Height: 900, X: 1870, Y: 200, Fingerprint: fp}},
		// On screen horizontally, but the title bar is above the work area, so
		// there is nothing left to drag.
		{"title bar out of reach", &windowgeom.Geometry{Width: 1600, Height: 900, X: 100, Y: -400, Fingerprint: fp}},
		// Full width on screen and the title bar within reach, but hanging so
		// far off the bottom that only a seventh of the window is visible.
		// Nothing but the overlap-area rule rejects this one.
		{"mostly below the screen", &windowgeom.Geometry{Width: 1600, Height: 900, X: 100, Y: 900, Fingerprint: fp}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := windowgeom.Plan(tc.saved, displays)
			if !got.Centered {
				t.Errorf("want a centered recovery, got rect %+v", got.Rect)
			}
			// The size the user chose is still a statement of intent, so it
			// survives even when the position cannot.
			if got.Rect.Width != 1600 || got.Rect.Height != 900 {
				t.Errorf("size = %dx%d, want the remembered 1600x900",
					got.Rect.Width, got.Rect.Height)
			}
		})
	}
}

func TestPlanShrinksARectTooBigForTheDisplay(t *testing.T) {
	// Closed on the 1440p desktop, reopened on a 1080p laptop.
	desktop := oneScreen1440p()
	saved := &windowgeom.Geometry{
		Width: 2048, Height: 1114, X: 200, Y: 100,
		Fingerprint: windowgeom.Fingerprint(desktop),
	}
	laptop := oneScreen1080p()
	// Same machine, different desk: the layout no longer matches, so this also
	// exercises the fingerprint path.
	got := windowgeom.Plan(saved, laptop)
	wa := laptop[0].WorkArea
	if got.Rect.Width > wa.Width || got.Rect.Height > wa.Height {
		t.Errorf("rect %dx%d does not fit the %dx%d work area",
			got.Rect.Width, got.Rect.Height, wa.Width, wa.Height)
	}
	if got.Rect.Width != wa.Width || got.Rect.Height != wa.Height {
		t.Errorf("rect = %dx%d, want it shrunk to the full work area %dx%d",
			got.Rect.Width, got.Rect.Height, wa.Width, wa.Height)
	}
}

func TestPlanDropsAPositionRecordedOnADifferentDesk(t *testing.T) {
	displays := dualLeftSecondary()
	saved := &windowgeom.Geometry{
		Width: 1600, Height: 900, X: 100, Y: 100,
		Fingerprint: "some other desk",
	}
	got := windowgeom.Plan(saved, displays)
	if !got.Centered {
		t.Error("a position from another layout means nothing; want centered")
	}
	if got.Rect.Width != 1600 || got.Rect.Height != 900 {
		t.Errorf("size = %dx%d, want the remembered 1600x900",
			got.Rect.Width, got.Rect.Height)
	}
}

func TestPlanHonorsAnExplicitlyCenteredRecord(t *testing.T) {
	displays := oneScreen1440p()
	saved := &windowgeom.Geometry{
		Width: 1500, Height: 950, Centered: true,
		Fingerprint: windowgeom.Fingerprint(displays),
	}
	got := windowgeom.Plan(saved, displays)
	if !got.Centered {
		t.Error("want centered")
	}
	if got.Rect.Width != 1500 || got.Rect.Height != 950 {
		t.Errorf("size = %dx%d, want 1500x950", got.Rect.Width, got.Rect.Height)
	}
}

func TestPlanKeepsAStraddlingRectOnOneMonitor(t *testing.T) {
	// Mixed DPI, and the saved rect spans the seam. A straddle is converted
	// with a single scale factor and the OS's corrective resize is suppressed,
	// so it has to land wholly on one side.
	displays := []windowgeom.Display{
		screen(0, 1920, 1080, 1, true),
		screen(1920, 2560, 1440, 1.5, false),
	}
	saved := &windowgeom.Geometry{
		Width: 1200, Height: 800, X: 1500, Y: 100,
		Fingerprint: windowgeom.Fingerprint(displays),
	}
	got := windowgeom.Plan(saved, displays)
	if got.Centered {
		t.Fatalf("want the rect placed on a monitor, got a centered fallback")
	}
	if !fitsSomeWorkArea(got.Rect, displays) {
		t.Errorf("rect %+v straddles or escapes every work area", got.Rect)
	}
}

func TestPlanIsDeterministicWhenTwoMonitorsTie(t *testing.T) {
	// Two identical displays, an equal overlap on each, and the OS handing
	// them back in whichever order it likes. The answer must not depend on it.
	a := screen(0, 1920, 1080, 1, true)
	b := screen(1920, 1920, 1080, 1, false)
	saved := &windowgeom.Geometry{Width: 1200, Height: 800, X: 1320, Y: 100}

	forward := []windowgeom.Display{a, b}
	reverse := []windowgeom.Display{b, a}
	saved.Fingerprint = windowgeom.Fingerprint(forward)

	got := windowgeom.Plan(saved, forward)
	gotReversed := windowgeom.Plan(saved, reverse)
	if got != gotReversed {
		t.Errorf("enumeration order changed the answer: %+v vs %+v", got, gotReversed)
	}
}

func TestFingerprintIgnoresEnumerationOrder(t *testing.T) {
	a := screen(0, 1920, 1080, 1, true)
	b := screen(-2560, 2560, 1440, 1, false)
	if windowgeom.Fingerprint([]windowgeom.Display{a, b}) !=
		windowgeom.Fingerprint([]windowgeom.Display{b, a}) {
		t.Error("the same desk in a different order must fingerprint the same")
	}
}

func TestFingerprintChangesWhenTheDeskDoes(t *testing.T) {
	base := oneScreen1080p()
	tests := []struct {
		name  string
		other []windowgeom.Display
	}{
		{"monitor added", dualLeftSecondary()},
		{"resolution changed", oneScreen1440p()},
		{"scale changed", []windowgeom.Display{screen(0, 1920, 1080, 1.5, true)}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if windowgeom.Fingerprint(base) == windowgeom.Fingerprint(tc.other) {
				t.Error("want a different fingerprint")
			}
		})
	}
}

// TestPlanAlwaysReturnsSomethingUsable is the contract, asserted over every
// case above at once: whatever went in, the window can be seen and grabbed.
func TestPlanAlwaysReturnsSomethingUsable(t *testing.T) {
	layouts := map[string][]windowgeom.Display{
		"1080p":     oneScreen1080p(),
		"1440p":     oneScreen1440p(),
		"dual left": dualLeftSecondary(),
		"tiny":      {screen(0, 800, 600, 1, true)},
	}
	saves := map[string]*windowgeom.Geometry{
		"nothing saved":  nil,
		"huge":           {Width: 9000, Height: 9000, X: 0, Y: 0},
		"far off-screen": {Width: 1200, Height: 800, X: 99999, Y: 99999},
		"negative":       {Width: 1200, Height: 800, X: -99999, Y: -99999},
		"degenerate":     {Width: 1, Height: 1, X: 0, Y: 0},
		"at the origin":  {Width: 1200, Height: 800, X: 0, Y: 0},
	}
	for layoutName, displays := range layouts {
		for saveName, saved := range saves {
			t.Run(layoutName+"/"+saveName, func(t *testing.T) {
				if saved != nil {
					stamped := *saved
					stamped.Fingerprint = windowgeom.Fingerprint(displays)
					saved = &stamped
				}
				got := windowgeom.Plan(saved, displays)
				assertUsable(t, got, displays)
			})
		}
	}
}

func assertUsable(t *testing.T, p windowgeom.Placement, displays []windowgeom.Display) {
	t.Helper()
	if p.Rect.Width <= 0 || p.Rect.Height <= 0 {
		t.Fatalf("degenerate rect %+v", p.Rect)
	}
	if len(displays) == 0 {
		return
	}
	// A centered placement leaves X/Y to the framework, so only the size is
	// ours to be right about.
	if p.Centered {
		assertSizeFitsSomewhere(t, p.Rect, displays)
		return
	}
	if !fitsSomeWorkArea(p.Rect, displays) {
		t.Errorf("rect %+v sits on no work area", p.Rect)
	}
}

func assertSizeFitsSomewhere(t *testing.T, r windowgeom.Rect, displays []windowgeom.Display) {
	t.Helper()
	for _, d := range displays {
		if r.Width <= d.WorkArea.Width && r.Height <= d.WorkArea.Height {
			return
		}
	}
	t.Errorf("size %dx%d is larger than every work area", r.Width, r.Height)
}

func fitsWorkArea(r, wa windowgeom.Rect) bool {
	return r.X >= wa.X && r.Y >= wa.Y &&
		r.X+r.Width <= wa.X+wa.Width && r.Y+r.Height <= wa.Y+wa.Height
}

func fitsSomeWorkArea(r windowgeom.Rect, displays []windowgeom.Display) bool {
	for _, d := range displays {
		if fitsWorkArea(r, d.WorkArea) {
			return true
		}
	}
	return false
}

func TestLoadAndSaveRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "window.json")
	want := windowgeom.Geometry{
		Width: 1600, Height: 900, X: -2400, Y: 120,
		Maximized: true, Fingerprint: "desk",
	}
	if err := windowgeom.Save(path, want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got := windowgeom.Load(path)
	if got == nil {
		t.Fatal("Load returned nil for a file it just wrote")
	}
	if *got != want {
		t.Errorf("round trip = %+v, want %+v", *got, want)
	}
}

func TestLoadTreatsUnusableFilesAsNothingSaved(t *testing.T) {
	dir := t.TempDir()
	tests := []struct {
		name, body string
		write      bool
	}{
		{name: "missing", write: false},
		{name: "truncated mid-write", body: `{"width": 16`, write: true},
		{name: "not json at all", body: "nonsense", write: true},
		// A zero size is not "unset" downstream: the framework rewrites it to
		// its own 800x600 default, so it has to be refused here where it still
		// reads as missing data.
		{name: "zero size", body: `{"width": 0, "height": 0}`, write: true},
		{name: "negative size", body: `{"width": -5, "height": -5}`, write: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(dir, tc.name+".json")
			if tc.write {
				if err := writeFile(path, tc.body); err != nil {
					t.Fatal(err)
				}
			}
			if got := windowgeom.Load(path); got != nil {
				t.Errorf("Load = %+v, want nil", *got)
			}
		})
	}
}

func TestSaveCreatesTheDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "deeper", "window.json")
	if err := windowgeom.Save(path, windowgeom.Geometry{Width: 1024, Height: 700}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if windowgeom.Load(path) == nil {
		t.Error("saved geometry did not read back")
	}
}

func writeFile(path, body string) error {
	return os.WriteFile(path, []byte(body), 0o600)
}
