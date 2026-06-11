package parser

import (
	"image"
	"strings"
)

// statColDamage is the DMG column's index within the rightmost six
// teams stat columns (E, A, D, DMG, H, MIT). DMG is the reliable
// per-player row counter: every player deals damage, so the value is
// always a non-zero multi-digit number that OCRs to exactly one line —
// unlike E/A/D, where a legitimate "0" is often dropped.
const statColDamage = 3

// detectQueueType infers the match's queue format from the TEAMS
// teams by counting players per team — role queue locks 5v5, open
// queue is 6v6. Returns "role", "open", or "" when the teams can't
// be read confidently.
//
// The matchmaking-queue banner that can appear top-right ("...: ROLE
// QUEUE") is deliberately NOT consulted: it reflects the queue the
// player is searching for *next*, is competitive-only, and is absent
// from quickplay — so it says nothing reliable about the match shown.
// Player count is the only mode-agnostic signal.
func detectQueueType(img image.Image, workDir string) string {
	H := img.Bounds().Dy()

	// Reuse the friendly-team highlighted row only to locate the aligned
	// DMG column; its X range applies to both team tables.
	yTop, yBot := findHighlightedRowY(img)
	if yTop < 0 {
		return ""
	}
	xLeft, xRight := findRowXExtent(img, yTop, yBot)
	pad := (yBot - yTop) / 8
	cols := findStatColumns(img, yTop+pad, yBot-pad, xLeft, xRight)
	if len(cols) < 6 {
		return ""
	}
	dmg := cols[len(cols)-6+statColDamage]

	// The friendly team sits above the VS divider, the enemy below it.
	// Scan generous, overlapping Y ranges — the color predicates keep
	// each team's block distinct. Count both and take the larger so a
	// mid-match leaver (which only shrinks a team) can't misclassify.
	blueTop, blueBot := teamBlockY(img, isBlueTablePixel, 0, H*70/100, xLeft, xRight)
	redTop, redBot := teamBlockY(img, isRedTablePixel, H*30/100, H, xLeft, xRight)
	blue := countTeamRows(img, dmg, blueTop, blueBot, workDir, "q_blue")
	red := countTeamRows(img, dmg, redTop, redBot, workDir, "q_red")
	return classifyQueueByCount(blue, red)
}

// classifyQueueByCount maps the larger of the two team sizes to a queue
// format. A full team reveals the queue's roster size (role caps at 5,
// open at 6); leavers only ever shrink a team, so the maximum is the
// safe estimator. Counts outside {5,6} are treated as unreadable.
func classifyQueueByCount(blue, red int) string {
	switch max(blue, red) {
	case 6:
		return "open"
	case 5:
		return "role"
	default:
		return ""
	}
}

// countTeamRows OCRs the DMG column over a team's vertical extent and
// returns the number of player rows — one OCR line carrying a digit per
// player.
func countTeamRows(img image.Image, col image.Rectangle, yTop, yBot int, workDir, name string) int {
	if yTop < 0 || yBot <= yTop {
		return 0
	}
	margin := img.Bounds().Dx() / 100
	rect := image.Rect(col.Min.X-margin, yTop, col.Max.X+margin, yBot)
	text, err := ocrInverted(img, rect, workDir, name, "6", "0123456789,")
	if err != nil {
		return 0
	}
	return countDigitLines(text)
}

// countDigitLines counts lines containing at least one digit, so blank
// or punctuation-only noise lines (an OCR'd icon stroke, a stray comma)
// between rows don't inflate the tally.
func countDigitLines(text string) int {
	n := 0
	for line := range strings.SplitSeq(text, "\n") {
		if strings.ContainsAny(line, "0123456789") {
			n++
		}
	}
	return n
}

// teamBlockY finds the contiguous Y range over [yStart,yEnd) where the
// predicate's team-table color covers more than a quarter of the table
// width — i.e. the vertical span of one team's stacked rows.
func teamBlockY(img image.Image, pred func(image.Image, int, int) bool, yStart, yEnd, xLeft, xRight int) (int, int) {
	if xLeft < 0 || xRight <= xLeft {
		return -1, -1
	}
	top, bot := -1, -1
	thresh := (xRight - xLeft) / 4
	for y := yStart; y < yEnd; y++ {
		c := 0
		for x := xLeft; x < xRight; x += 2 {
			if pred(img, x, y) {
				c++
			}
		}
		if c*2 > thresh {
			if top < 0 {
				top = y
			}
			bot = y
		}
	}
	return top, bot
}

// isBlueTablePixel reports whether the pixel is the friendly team's blue
// row background (low R, mid G, mid-high B). Mirrors the threshold the
// row/column detectors use so the team block and the columns agree.
func isBlueTablePixel(img image.Image, x, y int) bool {
	r, g, b, _ := img.At(x, y).RGBA()
	r8, g8, b8 := int(r>>8), int(g>>8), int(b>>8)
	return r8 < 80 && g8 > 50 && b8 > 90 && b8 > r8+30
}

// isRedTablePixel reports whether the pixel is the enemy team's red row
// background (high R, low G/B).
func isRedTablePixel(img image.Image, x, y int) bool {
	r, g, b, _ := img.At(x, y).RGBA()
	r8, g8, b8 := int(r>>8), int(g>>8), int(b>>8)
	return r8 > 90 && g8 < 80 && b8 < 90 && r8 > g8+40 && r8 > b8+30
}
