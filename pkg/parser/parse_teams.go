package parser

import (
	"errors"
	"fmt"
	"image"
)

// parseTeams handles the in-game and post-match TEAMS screens: two team
// tables stacked vertically with the user's row highlighted in a
// brighter blue. It extracts ONLY the combat stats the scoreboard
// uniquely provides — E/A/D + DMG/H/MIT from the highlighted row, plus
// the queue type from the players-per-team count. Match identity (map,
// mode, hero, role, result) comes from the post-match SUMMARY / RANK /
// PERSONAL screens and is merged in by correlation; the in-game teams
// scoreboard is deliberately NOT treated as a summary source.
func parseTeams(img image.Image, work string) (*MatchResult, error) {
	yTop, yBot := findHighlightedRowY(img)
	if yTop < 0 {
		return nil, errors.New("could not locate the highlighted (lighter blue) row in the teams")
	}
	stats, err := ocrRowCells(img, yTop, yBot, work)
	if err != nil {
		return nil, fmt.Errorf("row OCR: %w", err)
	}

	res := &MatchResult{}
	res.Eliminations, res.Assists, res.Deaths = stats[0], stats[1], stats[2]
	res.Damage, res.Healing, res.Mitigation = stats[3], stats[4], stats[5]
	res.QueueType = detectQueueType(img, work)
	return res, nil
}

// findHighlightedRowY locates the highlighted row's Y range by finding the
// single-row-height Y window with the brightest blue background in the friendly
// team table. The friendly team's rows all share a similar blue, but the user's
// row is rendered in a brighter shade — so the row with the highest average
// (G+B) is the highlighted one regardless of resolution or layout.
func findHighlightedRowY(img image.Image) (int, int) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()

	// For each Y, average (G+B) over blue-background pixels in the table area.
	xMin, xMax := W/8, W*9/16
	rowAvg := make([]int, H)
	for y := 0; y < H; y++ {
		var sum, count int
		for x := xMin; x < xMax; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			r8, g8, b8 := int(r>>8), int(g>>8), int(b>>8)
			// Blue table background: low R, mid G, mid-high B.
			if r8 < 60 && g8 > 60 && b8 > 90 && b8 > r8+40 {
				sum += g8 + b8
				count++
			}
		}
		// Require enough blue pixels in the row for it to count as table content.
		if count > (xMax-xMin)/4 {
			rowAvg[y] = sum / count
		}
	}

	// Slide a single-row-height window and pick the position with highest
	// average brightness. Row height is roughly H/24 — covers a single row but
	// not multiple stacked rows. We only consider the top half of the image
	// since the friendly team always sits above the center VS divider.
	rowHeight := H / 24
	if rowHeight < 20 {
		rowHeight = 20
	}
	bestSum, bestY := -1, -1
	for y := 0; y+rowHeight < H/2; y++ {
		sum := 0
		for k := 0; k < rowHeight; k++ {
			sum += rowAvg[y+k]
		}
		if sum > bestSum {
			bestSum = sum
			bestY = y
		}
	}
	if bestY < 0 {
		return -1, -1
	}
	return bestY, bestY + rowHeight
}

// ocrRowCells finds the 6 stat columns inside the highlighted row by detecting
// white-text clusters horizontally, groups them into columns (digits separated
// by commas in the same number cluster together), then OCRs each as digits.
// This is fully dynamic — no hardcoded ratios — so it works at any resolution
// and any teams layout.
func ocrRowCells(img image.Image, yTop, yBot int, workDir string) ([6]int, error) {
	bounds := img.Bounds()
	H := bounds.Dy()

	// Trim the row to its center band so we don't catch portrait/icon noise at
	// the top and bottom edges.
	pad := (yBot - yTop) / 8
	yT, yB := yTop+pad, yBot-pad

	xLeft, xRight := findRowXExtent(img, yTop, yBot)
	cols := findStatColumns(img, yT, yB, xLeft, xRight)
	if len(cols) < 6 {
		return [6]int{}, fmt.Errorf("expected 6 stat columns, found %d", len(cols))
	}
	// Take the rightmost 6 clusters as stats. Anything to the left (hero
	// portrait, role icon, player level/name) is ignored.
	cols = cols[len(cols)-6:]

	// Expand each cell vertically to the full row so partial digit strokes
	// don't get clipped, and add a generous horizontal margin so Tesseract has
	// breathing room (it tends to drop thin leading digits like "1" without it).
	cellNames := [6]string{"col_e", "col_a", "col_d", "col_dmg", "col_h", "col_mit"}
	var out [6]int
	margin := H / 80
	if margin < 8 {
		margin = 8
	}
	for i, col := range cols {
		rect := image.Rect(col.Min.X-margin, yTop+1, col.Max.X+margin, yBot-1)
		var nums []int
		attempts := []struct{ psm, whitelist string }{
			{"7", "0123456789,"},
			{"10", "0123456789,"},
			{"10", ""},
			{"8", ""},
		}
		for _, a := range attempts {
			text, err := ocrInverted(img, rect, workDir, cellNames[i], a.psm, a.whitelist)
			if err != nil {
				return out, fmt.Errorf("%s: %w", cellNames[i], err)
			}
			nums = extractInts(text)
			if len(nums) > 0 {
				break
			}
		}
		if len(nums) > 0 {
			out[i] = nums[0]
		}
	}
	return out, nil
}

// findRowXExtent returns the X range over which the highlighted row's blue
// background extends — i.e. the table's left and right edges in this row. We
// use this to filter out audio/mic icons and other non-table content that
// happens to contain bright pixels.
func findRowXExtent(img image.Image, yT, yB int) (xLeft, xRight int) {
	bounds := img.Bounds()
	W := bounds.Dx()
	yMid := (yT + yB) / 2

	isBlue := func(x, y int) bool {
		r, g, b, _ := img.At(x, y).RGBA()
		r8, g8, b8 := int(r>>8), int(g>>8), int(b>>8)
		return r8 < 80 && g8 > 60 && b8 > 90 && b8 > r8+30
	}

	xLeft, xRight = -1, -1
	for x := 0; x < W; x++ {
		if isBlue(x, yMid) || isBlue(x, yMid-3) || isBlue(x, yMid+3) {
			xLeft = x
			break
		}
	}
	for x := W - 1; x >= 0; x-- {
		if isBlue(x, yMid) || isBlue(x, yMid-3) || isBlue(x, yMid+3) {
			xRight = x
			break
		}
	}
	return
}

// findStatColumns scans for white-text X clusters inside the highlighted row
// and groups together clusters that belong to the same number (digits with
// thin commas between them). xLeft/xRight bound the search to the table area
// so audio/mic icons and other off-table content don't get included.
// statCluster is a horizontal run of bright columns — a candidate stat
// number before merging + filtering.
type statCluster struct{ minX, maxX int }

func findStatColumns(img image.Image, yT, yB, xLeft, xRight int) []image.Rectangle {
	W := img.Bounds().Dx()
	if xLeft < 0 {
		xLeft = 0
	}
	if xRight < 0 || xRight >= W {
		xRight = W - 1
	}
	counts := columnBrightnessCounts(img, yT, yB, xLeft, xRight)
	raw := findBrightClusters(counts, xLeft, xRight)
	return mergeStatClusters(raw, yT, yB, W)
}

// columnBrightnessCounts counts, per x column in [xLeft, xRight], how many
// rows in [yT, yB) are brighter than the stat-text luminance threshold.
func columnBrightnessCounts(img image.Image, yT, yB, xLeft, xRight int) []int {
	counts := make([]int, img.Bounds().Dx())
	for x := xLeft; x <= xRight; x++ {
		for y := yT; y < yB; y++ {
			r, g, b, _ := img.At(x, y).RGBA()
			lum := (299*int(r>>8) + 587*int(g>>8) + 114*int(b>>8)) / 1000
			if lum > 130 {
				counts[x]++
			}
		}
	}
	return counts
}

// findBrightClusters groups contiguous columns with >1 bright pixel into
// runs (each a candidate stat number).
func findBrightClusters(counts []int, xLeft, xRight int) []statCluster {
	var raw []statCluster
	inC := false
	cs := 0
	for x := xLeft; x <= xRight; x++ {
		if counts[x] > 1 {
			if !inC {
				cs = x
				inC = true
			}
		} else if inC {
			raw = append(raw, statCluster{cs, x - 1})
			inC = false
		}
	}
	if inC {
		raw = append(raw, statCluster{cs, xRight})
	}
	return raw
}

// mergeStatClusters turns raw bright-column runs into stat-column rects:
// merge runs separated by a small gap (digits inside one number), drop runs
// too wide to be a stat number (player names/portraits), then drop trailing
// runs sitting far past the last column (audio/mic icons).
func mergeStatClusters(raw []statCluster, yT, yB, W int) []image.Rectangle {
	mergeGap := W / 200    // ~6 px on 1280, ~10 px on 1920
	maxStatWidth := W / 20 // upper bound for "13,432" style numbers
	var grouped []image.Rectangle
	for _, c := range raw {
		if c.maxX-c.minX < 2 {
			continue
		}
		if len(grouped) > 0 {
			last := &grouped[len(grouped)-1]
			if c.minX-last.Max.X <= mergeGap {
				last.Max.X = c.maxX
				continue
			}
		}
		grouped = append(grouped, image.Rect(c.minX, yT, c.maxX, yB))
	}
	filtered := grouped[:0]
	for _, c := range grouped {
		if c.Dx() <= maxStatWidth {
			filtered = append(filtered, c)
		}
	}

	// Drop trailing clusters whose gap from the previous cluster is far larger
	// than the typical inter-column spacing — those are audio/mic icons sitting
	// past the rightmost stat column, not stats themselves.
	maxColGap := W / 18
	for len(filtered) >= 2 {
		gap := filtered[len(filtered)-1].Min.X - filtered[len(filtered)-2].Max.X
		if gap > maxColGap {
			filtered = filtered[:len(filtered)-1]
		} else {
			break
		}
	}
	return filtered
}
