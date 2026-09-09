//go:build !serveronly

package windowgeom

import (
	"cmp"
	"math"
	"slices"
)

const (
	// MinWidth / MinHeight is the floor the layout is designed for. The content
	// column carries a 1140px floor of its own, so much below this the dossier
	// tables start overflowing instead of reflowing.
	MinWidth  = 1024
	MinHeight = 700

	// workAreaFraction is the share of a monitor a first launch takes: wide
	// enough that a 1440p display opens usefully large, short of filling the
	// screen so it still reads as a window someone can move.
	workAreaFraction = 0.80

	// minOverlapPercent decides one question and no other: did the user mean
	// THIS monitor? Whether the window comes back reachable is not asked here,
	// because fitInto answers it unconditionally — every honored rect is
	// clamped wholly inside one work area, so its title bar is always on screen
	// and always grabbable.
	minOverlapPercent = 30
)

// Placement is how to open the window. When Centered is set, the caller lets
// the framework center the window and the rect's X/Y carry no meaning;
// otherwise X/Y are absolute virtual-desktop coordinates.
type Placement struct {
	Rect      Rect
	Centered  bool
	Maximized bool
}

// Plan decides where the window opens.
//
// The contract every caller depends on, and the only thing the tests assert:
// the returned rect is at least the layout floor (or the whole work area, on a
// display smaller than the floor), and it fits entirely within one monitor's
// work area. A position that cannot satisfy that is discarded rather than
// honored — a window restored onto a monitor that is no longer plugged in is
// unreachable without editing the file by hand.
func Plan(saved *Geometry, displays []Display) Placement {
	if len(displays) == 0 {
		// No screen information at all. That is the macOS and Linux case,
		// where the framework fills its screen cache only after startup
		// services have run; it is not a state Windows reaches. Open at the
		// historical fixed default rather than computing against zeroes.
		return Placement{Rect: Rect{Width: MinWidth, Height: MinHeight}, Centered: true}
	}
	primary := primaryOf(displays)
	if saved == nil {
		return Placement{Rect: defaultSize(primary.WorkArea), Centered: true}
	}
	// A layout the position was not recorded on makes that position
	// meaningless even when it happens to land on a live screen: the same
	// coordinates address a different desk. The remembered SIZE still says
	// something about how big the user wants the window, so it survives.
	if saved.Centered || saved.Fingerprint != Fingerprint(displays) {
		return centeredOn(primary.WorkArea, *saved)
	}
	target, ok := targetFor(saved.Rect(), displays)
	if !ok {
		return centeredOn(primary.WorkArea, *saved)
	}
	return Placement{Rect: fitInto(saved.Rect(), target.WorkArea), Maximized: saved.Maximized}
}

func centeredOn(workArea Rect, saved Geometry) Placement {
	return Placement{
		Rect:      fitSize(saved.Rect(), workArea),
		Centered:  true,
		Maximized: saved.Maximized,
	}
}

// primaryOf returns the display the OS marks primary, or the first one when
// nothing is marked — a layout with no primary is not a state worth failing on.
func primaryOf(displays []Display) Display {
	for _, d := range displays {
		if d.IsPrimary {
			return d
		}
	}
	return displays[0]
}

// defaultSize is the first-launch size. It measures against the WORK area, not
// the full display, which is what keeps the window clear of the taskbar.
func defaultSize(workArea Rect) Rect {
	return Rect{
		Width:  scaleDim(workArea.Width, MinWidth),
		Height: scaleDim(workArea.Height, MinHeight),
	}
}

func scaleDim(available, minimum int) int {
	if available <= 0 {
		return minimum
	}
	return clamp(int(math.Round(float64(available)*workAreaFraction)), minimum, available)
}

// clamp bounds v to [lo, hi]. hi deliberately wins a contradiction: on a
// display smaller than the layout floor, fitting on the screen matters more
// than honoring the floor.
func clamp(v, lo, hi int) int {
	return min(max(v, lo), hi)
}

// fitSize shrinks a remembered size onto a work area, holding it at or above
// the floor wherever the display leaves room.
func fitSize(want, workArea Rect) Rect {
	return Rect{
		Width:  clamp(want.Width, MinWidth, workArea.Width),
		Height: clamp(want.Height, MinHeight, workArea.Height),
	}
}

// fitInto places a remembered rect wholly inside one work area: shrunk to fit,
// then moved until no edge hangs off.
//
// Full containment is not cosmetic. A window straddling two monitors is
// converted between logical and physical pixels with a single scale factor,
// and the framework deliberately suppresses the OS's corrective resize, so a
// straddle across a DPI boundary lands wrong with nothing left to fix it.
func fitInto(want, workArea Rect) Rect {
	size := fitSize(want, workArea)
	return Rect{
		X:      clamp(want.X, workArea.X, workArea.X+workArea.Width-size.Width),
		Y:      clamp(want.Y, workArea.Y, workArea.Y+workArea.Height-size.Height),
		Width:  size.Width,
		Height: size.Height,
	}
}

// targetFor picks the display a remembered rect should return to: the one it
// overlaps most, if that overlap is worth honoring at all.
func targetFor(want Rect, displays []Display) (Display, bool) {
	var best Display
	bestArea := 0
	for _, d := range sortedByBounds(displays) {
		if area := overlapArea(want, d.WorkArea); area > bestArea {
			best, bestArea = d, area
		}
	}
	if !worthHonoring(want, bestArea) {
		return Display{}, false
	}
	return best, true
}

// worthHonoring asks whether a remembered position still points at this
// monitor strongly enough to be worth clamping onto it, rather than starting
// over in the middle of the primary.
//
// It deliberately does NOT test whether the window is currently reachable. An
// earlier version also required the title bar to sit inside the work area, and
// that threw away perfectly good positions: on two monitors stacked vertically,
// a window whose top edge is on the upper display but whose bulk is on the
// lower one is entirely on real screens and entirely draggable, and fitInto
// would have clamped it in place. The same rule fired whenever a taskbar moved
// to the top of a single screen. Containment is fitInto's job; this is only
// about intent.
func worthHonoring(want Rect, area int) bool {
	if area <= 0 {
		return false
	}
	return area*100 >= want.Width*want.Height*minOverlapPercent
}

// sortedByBounds fixes the scan order so a tie between two equally-overlapped
// displays resolves the same way on every launch. The order the OS enumerates
// monitors in does not.
func sortedByBounds(displays []Display) []Display {
	out := slices.Clone(displays)
	slices.SortFunc(out, func(a, b Display) int {
		return cmp.Or(
			cmp.Compare(a.PhysicalBounds.X, b.PhysicalBounds.X),
			cmp.Compare(a.PhysicalBounds.Y, b.PhysicalBounds.Y),
			cmp.Compare(a.PhysicalBounds.Width, b.PhysicalBounds.Width),
			cmp.Compare(a.PhysicalBounds.Height, b.PhysicalBounds.Height),
		)
	})
	return out
}

func overlapArea(a, b Rect) int {
	return overlapLen(a.X, a.Width, b.X, b.Width) * overlapLen(a.Y, a.Height, b.Y, b.Height)
}

func overlapLen(aStart, aLen, bStart, bLen int) int {
	return max(0, min(aStart+aLen, bStart+bLen)-max(aStart, bStart))
}
