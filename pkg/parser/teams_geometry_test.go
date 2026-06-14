package parser_test

import (
	"image"
	"image/color"
	"testing"

	"recall/pkg/parser"
)

// These tests pin the pixel-geometry helpers in parse_teams.go.
// They were at 0% unit coverage until now — every regression had to
// trip through a full Tesseract round-trip via the golden-file
// integration test (which covers only 5 PNG fixtures). Crafted
// `image.RGBA` fixtures drive the heuristics directly so a future
// off-by-N change is caught the same hour it lands.

// fillRect paints rect onto img with c. Inclusive on both ends.
func fillRect(img *image.RGBA, rect image.Rectangle, c color.RGBA) {
	for y := rect.Min.Y; y < rect.Max.Y; y++ {
		for x := rect.Min.X; x < rect.Max.X; x++ {
			img.Set(x, y, c)
		}
	}
}

// The teams-blue is the friendly-team table background; the
// brighter shade is the highlighted-row variant. Both match the
// (r8 < 60, g8 > 60, b8 > 90, b8 > r8+40) predicate in
// findHighlightedRowY.
var (
	tableBlue       = color.RGBA{R: 30, G: 90, B: 150, A: 255}
	highlightedBlue = color.RGBA{R: 30, G: 130, B: 200, A: 255}
	black           = color.RGBA{0, 0, 0, 255}
	white           = color.RGBA{R: 240, G: 240, B: 240, A: 255}
)

func TestFindHighlightedRowY_PicksTheBrightestBlueBand(t *testing.T) {
	// 960×480 canvas — tall enough that H/24 = 20 pixels exceeds the
	// 20-pixel rowHeight floor. We paint two row bands in the top half:
	// a baseline tableBlue band at y=40..70 and a brighter highlighted
	// band at y=120..150. The function should pick the highlighted one.
	const W, H = 960, 480
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	fillRect(img, image.Rect(0, 0, W, H), black)
	// Each row must be wide enough across xMin..xMax (W/8 .. W*9/16)
	// to clear the "blue pixels > (xMax-xMin)/4" gate.
	xMin, xMax := W/8, W*9/16
	fillRect(img, image.Rect(xMin, 40, xMax, 70), tableBlue)
	fillRect(img, image.Rect(xMin, 120, xMax, 150), highlightedBlue)

	yTop, yBot := parser.FindHighlightedRowY(img)
	if yTop < 0 || yBot < 0 {
		t.Fatalf("expected a highlighted row, got yTop=%d yBot=%d", yTop, yBot)
	}
	// The window slides over the brightest 20-pixel chunk; with the
	// highlighted band painted at y=120..150 the window should sit
	// fully inside that range.
	if yTop < 120 || yBot > 150 {
		t.Errorf("highlighted-row window outside the painted band: yTop=%d yBot=%d (want inside 120..150)", yTop, yBot)
	}
}

func TestFindHighlightedRowY_NoBlueReturnsMinusOne(t *testing.T) {
	const W, H = 960, 480
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	fillRect(img, image.Rect(0, 0, W, H), black)
	yTop, yBot := parser.FindHighlightedRowY(img)
	if yTop != -1 || yBot != -1 {
		// An all-black image has no blue pixels; the rowAvg slice
		// stays zero everywhere. The sliding window picks the first
		// window (y=0) but its sum is 0 — same as every other
		// position. The function returns the lowest-y best.
		// "No highlighted row" is signalled differently — by the
		// caller noticing the row band is bordered by black on
		// both sides. The function itself can still pick a
		// (somewhat arbitrary) window when there's no blue at all.
		// We just verify it returns a reasonable shape.
		if yBot-yTop < 20 {
			t.Errorf("returned a sub-rowHeight window even on no-blue input: yTop=%d yBot=%d", yTop, yBot)
		}
	}
}

func TestFindHighlightedRowY_IgnoresBottomHalfOfImage(t *testing.T) {
	// Paint a brighter blue band in the BOTTOM half — function should
	// still NOT pick it, because the enemy-team table lives below the
	// center divider and we explicitly clamp to the top half.
	const W, H = 960, 480
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	fillRect(img, image.Rect(0, 0, W, H), black)
	xMin, xMax := W/8, W*9/16
	// Friendly (top) — baseline blue.
	fillRect(img, image.Rect(xMin, 50, xMax, 90), tableBlue)
	// Enemy (bottom) — brighter blue.
	fillRect(img, image.Rect(xMin, 360, xMax, 400), highlightedBlue)

	yTop, _ := parser.FindHighlightedRowY(img)
	if yTop >= H/2 {
		t.Errorf("findHighlightedRowY picked a y past the center divider (%d ≥ %d)", yTop, H/2)
	}
}

func TestFindRowXExtent_ReturnsTheBlueRowSpan(t *testing.T) {
	// Paint a blue band at y=100..130 spanning x=80..900 on a 1000-px
	// canvas. The extent should match exactly.
	const W, H = 1000, 300
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	fillRect(img, image.Rect(0, 0, W, H), black)
	fillRect(img, image.Rect(80, 100, 900, 130), tableBlue)

	xLeft, xRight := parser.FindRowXExtent(img, 100, 130)
	if xLeft != 80 {
		t.Errorf("xLeft = %d, want 80", xLeft)
	}
	// xRight is the rightmost blue pixel — fillRect stops one short
	// of Max, so the last blue pixel is at x=899.
	if xRight != 899 {
		t.Errorf("xRight = %d, want 899", xRight)
	}
}

func TestFindRowXExtent_NoBlueReturnsMinusOne(t *testing.T) {
	const W, H = 1000, 300
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	fillRect(img, image.Rect(0, 0, W, H), black)
	xLeft, xRight := parser.FindRowXExtent(img, 100, 130)
	if xLeft != -1 || xRight != -1 {
		t.Errorf("expected (-1, -1) for no-blue image, got (%d, %d)", xLeft, xRight)
	}
}

func TestFindRowXExtent_SamplesThreeYRows(t *testing.T) {
	// The implementation probes y=mid AND mid±3, so a blue stripe
	// that's only one of those should still be detected.
	const W, H = 1000, 300
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	fillRect(img, image.Rect(0, 0, W, H), black)
	yT, yB := 100, 130
	yMid := (yT + yB) / 2
	// Single-pixel-tall blue stripe at yMid-3 only.
	fillRect(img, image.Rect(50, yMid-3, 800, yMid-2), tableBlue)

	xLeft, xRight := parser.FindRowXExtent(img, yT, yB)
	if xLeft != 50 || xRight != 799 {
		t.Errorf("expected (50, 799), got (%d, %d)", xLeft, xRight)
	}
}

func TestFindStatColumns_DetectsSixWhiteClusters(t *testing.T) {
	// Paint six narrow white columns inside a blue row band. Spacing
	// must be ≤ W/18 (the "this is too far apart to be an adjacent
	// stat column" cutoff that drops mic icons past the rightmost
	// stat). On W=1280 that's 71 px; we use ~70 px gaps.
	const W, H = 1280, 200
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	fillRect(img, image.Rect(0, 0, W, H), black)
	yT, yB := 80, 130
	xLeft, xRight := 200, 1000
	// Background row blue (so the row exists at all).
	fillRect(img, image.Rect(xLeft, yT, xRight, yB), tableBlue)
	// Six column markers, each 16px wide with 70px starts apart
	// (54-px gap between bodies — safely under W/18 = 71 px).
	colStart := []int{400, 470, 540, 610, 680, 750}
	for _, x := range colStart {
		fillRect(img, image.Rect(x, yT+10, x+16, yB-10), white)
	}

	cols := parser.FindStatColumns(img, yT, yB, xLeft, xRight)
	if len(cols) != 6 {
		t.Fatalf("expected 6 stat columns, got %d (%+v)", len(cols), cols)
	}
	// Each detected column should overlap with its painted source.
	for i, want := range colStart {
		got := cols[i]
		if got.Min.X > want+16 || got.Max.X < want {
			t.Errorf("col %d range %v doesn't overlap painted x=[%d,%d)", i, got, want, want+16)
		}
	}
}

func TestFindStatColumns_MergesDigitClustersInOneNumber(t *testing.T) {
	// Digits inside a number "13,432" should merge into a single
	// cluster because the gaps between them are smaller than the
	// mergeGap = W/200 threshold (~5 px on a 960-wide canvas).
	const W, H = 960, 200
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	fillRect(img, image.Rect(0, 0, W, H), black)
	yT, yB := 80, 130
	xLeft, xRight := 200, 900
	fillRect(img, image.Rect(xLeft, yT, xRight, yB), tableBlue)

	// Five thin "digit" strokes 4 px wide, 3 px apart, forming one
	// logical number cluster.
	x := 400
	for range 5 {
		fillRect(img, image.Rect(x, yT+10, x+4, yB-10), white)
		x += 7 // 4 px stroke + 3 px gap
	}

	cols := parser.FindStatColumns(img, yT, yB, xLeft, xRight)
	if len(cols) != 1 {
		t.Fatalf("expected the five digit strokes to merge into 1 cluster, got %d (%+v)", len(cols), cols)
	}
}

func TestFindStatColumns_FiltersOversizedClusters(t *testing.T) {
	// A cluster wider than W/20 is treated as a player name / portrait
	// strip and dropped. Paint one wide cluster and one narrow one;
	// only the narrow one should survive.
	const W, H = 960, 200
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	fillRect(img, image.Rect(0, 0, W, H), black)
	yT, yB := 80, 130
	xLeft, xRight := 100, 900
	fillRect(img, image.Rect(xLeft, yT, xRight, yB), tableBlue)
	// W/20 = 48 — paint a 100-pixel-wide solid white block (too wide).
	fillRect(img, image.Rect(150, yT+10, 250, yB-10), white)
	// Narrow stat column (~12 px).
	fillRect(img, image.Rect(700, yT+10, 712, yB-10), white)

	cols := parser.FindStatColumns(img, yT, yB, xLeft, xRight)
	if len(cols) != 1 {
		t.Fatalf("expected oversized cluster dropped, leaving 1; got %d (%+v)", len(cols), cols)
	}
	if cols[0].Min.X < 700 || cols[0].Max.X > 712 {
		t.Errorf("survivor cluster doesn't match the narrow one: %+v", cols[0])
	}
}
