package parser

import (
	"errors"
	"fmt"
	"image"
	"regexp"
	"strconv"
	"strings"
)

// parseScoreboard handles the in-game and post-match TEAMS scoreboards: two
// team tables stacked vertically with the user's row highlighted in a brighter
// blue. Pulls per-row stats (E/A/D/DMG/H/MIT) plus, when present, the in-game
// banner's map/type/mode and the side panel's hero name.
func parseScoreboard(img image.Image, work string) (*MatchResult, error) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()

	yTop, yBot := findHighlightedRowY(img)
	if yTop < 0 {
		return nil, errors.New("could not locate the highlighted (lighter blue) row in the scoreboard")
	}

	// Header strip — banner is at top-left in 720p, top-right in 1080p. Use
	// PSM 7 (single line) so a stray FPS/latency overlay above the banner
	// doesn't confuse the OCR.
	var headerRect image.Rectangle
	if W >= 1600 {
		headerRect = image.Rect(W*45/100, H/40, W*99/100, H/19)
	} else {
		headerRect = image.Rect(0, H/100, W*5/8, H*5/96)
	}
	headerText, err := ocrInverted(img, headerRect, work, "header", "7", "")
	if err != nil {
		return nil, fmt.Errorf("header OCR: %w", err)
	}
	stats, err := ocrRowCells(img, yTop, yBot, work)
	if err != nil {
		return nil, fmt.Errorf("row OCR: %w", err)
	}
	// Panel: use raw color and run OCR twice — PSM 6 reads the labels and
	// numeric stats well, while PSM 11 (sparse text) catches cyan hero names
	// like "REINHARDT" that PSM 6 sometimes drops. Concatenate both outputs.
	panelRect := image.Rect(W*5/8, H/8, W, H*5/6)
	panel6, err := ocrRaw(img, panelRect, work, "panel", "6",
		"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ %")
	if err != nil {
		return nil, fmt.Errorf("panel OCR: %w", err)
	}
	panel11, err := ocrRaw(img, panelRect, work, "panel11", "11",
		"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ %")
	if err != nil {
		return nil, fmt.Errorf("panel sparse OCR: %w", err)
	}
	panelText := panel6 + "\n" + panel11

	res := &MatchResult{}
	res.Map, res.Type = extractHeader(headerText)
	if res.Map == "" {
		if cand := candidateNameFromOCR(headerText); cand != "" {
			res.MapRaw = cand
		}
	}
	res.Eliminations, res.Assists, res.Deaths = stats[0], stats[1], stats[2]
	res.Damage, res.Healing, res.Mitigation = stats[3], stats[4], stats[5]
	if heroes := extractHeroes(panelText); len(heroes) > 0 {
		res.Hero = heroes[0]
		if r, ok := loadDataset().heroRoles[res.Hero]; ok {
			res.Role = r
		}
		// The right-side panel on the in-game scoreboard carries the same
		// hero-specific cards the post-match PERSONAL tab does (PLAYERS
		// SAVED, WEAPON ACCURACY, etc.). Surface them on the HeroPlay entry
		// so a standalone scoreboard screenshot isn't missing them, and so
		// they cross-validate against the PERSONAL screen when both exist.
		if heroStats := parsePanelStats(panelText, res.Hero); len(heroStats) > 0 {
			res.HeroesPlayed = []HeroPlay{{Hero: res.Hero, Stats: heroStats}}
		}
	} else if cand := candidateNameFromOCR(panelText); cand != "" {
		// Matcher rejected the highlighted player's hero — capture the
		// raw OCR for the "Unknown hero" UI. parse_scoreboard's panel
		// is just one hero's column so this is the natural single-hero
		// fallback.
		res.HeroRaw = cand
	}
	res.QueueType = detectQueueType(img, work)
	return res, nil
}

// parsePanelStats extracts hero-specific (value, label) pairs from the
// scoreboard's right panel OCR. Values are integers (optionally % -suffixed);
// labels are multi-word uppercase phrases that follow the value within a few
// lines. Short noise lines (e.g. "PP", "A") between value and label are
// skipped — the panel renders an orange tick mark on the left of each card
// that Tesseract often reads as a 1-3 letter run.
var (
	panelValRe   = regexp.MustCompile(`^\s*(\d{1,4})\s*%?\s*$`)
	panelLabelRe = regexp.MustCompile(`^[A-Z][A-Z\s]{4,}[A-Z]$`)
)

func parsePanelStats(text, hero string) map[string]int {
	lines := strings.Split(text, "\n")
	stats := map[string]int{}
	for i, line := range lines {
		m := panelValRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		val, _ := strconv.Atoi(m[1])
		for j := i + 1; j < len(lines) && j < i+5; j++ {
			l := strings.TrimSpace(lines[j])
			if l == "" || len(l) <= 3 {
				continue
			}
			if panelLabelRe.MatchString(l) {
				stats[SnapHeroStatKey(hero, labelToKey(l))] = val
				break
			}
			// Hitting another value before a label means the current value
			// has no label in range — bail rather than pairing it with a
			// later, unrelated label.
			if panelValRe.MatchString(l) {
				break
			}
		}
	}
	return stats
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
// and any scoreboard layout.
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
func findStatColumns(img image.Image, yT, yB, xLeft, xRight int) []image.Rectangle {
	bounds := img.Bounds()
	W := bounds.Dx()
	if xLeft < 0 {
		xLeft = 0
	}
	if xRight < 0 || xRight >= W {
		xRight = W - 1
	}

	counts := make([]int, W)
	for x := xLeft; x <= xRight; x++ {
		for y := yT; y < yB; y++ {
			r, g, b, _ := img.At(x, y).RGBA()
			lum := (299*int(r>>8) + 587*int(g>>8) + 114*int(b>>8)) / 1000
			if lum > 130 {
				counts[x]++
			}
		}
	}

	type cluster struct{ minX, maxX int }
	var raw []cluster
	inC := false
	cs := 0
	for x := xLeft; x <= xRight; x++ {
		if counts[x] > 1 {
			if !inC {
				cs = x
				inC = true
			}
		} else if inC {
			raw = append(raw, cluster{cs, x - 1})
			inC = false
		}
	}
	if inC {
		raw = append(raw, cluster{cs, xRight})
	}

	// Merge clusters separated by a small gap (digits inside one number) and
	// drop clusters that are too wide to be a stat number (player name areas).
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
	// Drop clusters that are too wide to be a stat number (player name/portrait).
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
