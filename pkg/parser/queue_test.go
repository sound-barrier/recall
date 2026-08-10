package parser_test

import (
	"errors"
	"image"
	"strconv"
	"strings"
	"testing"

	"recall/pkg/parser"
)

func TestClassifyQueueByCount(t *testing.T) {
	cases := []struct {
		blue, red int
		want      string
	}{
		{6, 6, "open"},
		{5, 5, "role"},
		// A leaver only ever shrinks a team, so the larger team reveals
		// the queue's roster size. A team of 6 is impossible in role
		// queue, so any 6 means open.
		{6, 5, "open"},
		{5, 6, "open"},
		{5, 4, "role"},
		{4, 5, "role"},
		// Too degraded / impossible — refuse to guess.
		{4, 4, ""},
		{0, 0, ""},
		{7, 6, ""},
		{6, 7, ""},
	}
	for _, c := range cases {
		if got := parser.ClassifyQueueByCount(c.blue, c.red); got != c.want {
			t.Errorf("parser.ClassifyQueueByCount(%d, %d) = %q, want %q", c.blue, c.red, got, c.want)
		}
	}
}

func TestCountDigitLines(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want int
	}{
		{"five clean rows", "15,461\n15,925\n15,557\n2,602\n1,329", 5},
		{"blank noise line between rows", "11,226\n9,407\n3,165\n6,091\n1,950\n\n265", 6},
		{"punctuation-only line skipped", "5\n,\n6", 2},
		{"empty", "", 0},
		{"only blanks", "\n\n", 0},
		{"whitespace around digits", "  24 \n 27 ", 2},
	}
	for _, c := range cases {
		if got := parser.CountDigitLines(c.in); got != c.want {
			t.Errorf("%s: parser.CountDigitLines(%q) = %d, want %d", c.name, c.in, got, c.want)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Queue detection end to end, driven by the synthetic scoreboard in
// parse_teams_test.go.

// dmgLines renders one DMG cell per player — what the count crop's OCR
// returns for a team of n. Values are multi-digit and non-zero, which is
// exactly why the DMG column is the row counter.
func dmgLines(n int) string {
	lines := make([]string, n)
	for i := range n {
		lines[i] = strconv.Itoa(1000 + i*137)
	}
	return strings.Join(lines, "\n")
}

// The row counter must read the DMG column. E/A/D can legitimately be 0,
// and a 0 that OCR drops removes a whole line — undercounting the team and
// misreporting an open-queue match as role queue. statColDamage picks the
// 4th of the rightmost six columns; an off-by-one there is invisible to
// every other test because all six columns look alike.
func TestDetectQueueType_CountsPlayersFromTheDamageColumn(t *testing.T) {
	calls := stubOCRTrace(t, map[string]string{
		"q_blue": dmgLines(6),
		"q_red":  dmgLines(6),
	})
	res, err := parser.ParseTeams(teamsBoard(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseTeams: %v", err)
	}
	if res.QueueType != "open" {
		t.Errorf("QueueType = %q, want open for a 6v6 board", res.QueueType)
	}
	// The board paints each stat column at a different width, so the crop
	// widths trace a region back to its column; the count crop and the stat
	// crop of the same column differ only by their margins.
	countWidth := callsNamed(*calls, "q_blue")[0].width
	nearest, best := "", 1<<30
	for _, name := range []string{"col_e", "col_a", "col_d", "col_dmg", "col_h", "col_mit"} {
		stat := callsNamed(*calls, name)
		if len(stat) == 0 {
			continue
		}
		if d := max(stat[0].width-countWidth, countWidth-stat[0].width); d < best {
			nearest, best = name, d
		}
	}
	if nearest != "col_dmg" {
		t.Errorf("the player count was read from %s, want col_dmg", nearest)
	}
}

// The wiring from "lines of digits the DMG crop OCR'd" to a queue format.
// classifyQueueByCount pins the mapping in isolation; this pins that the
// counts actually reaching it come from the two team blocks.
func TestDetectQueueType_QueueFormatFollowsTheLargerTeam(t *testing.T) {
	cases := []struct {
		name      string
		blue, red int
		want      string
	}{
		{"both teams full at five", 5, 5, "role"},
		{"a leaver only shrinks a team, so the larger one decides", 5, 6, "open"},
		{"counts outside 5-6 refuse to guess", 3, 2, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stubOCR(t, map[string]string{"q_blue": dmgLines(c.blue), "q_red": dmgLines(c.red)})
			if got := parser.DetectQueueType(teamsBoard(), t.TempDir()); got != c.want {
				t.Errorf("DetectQueueType = %q, want %q", got, c.want)
			}
		})
	}
}

// Geometry the detector can't read must yield NO queue type rather than a
// guess — a wrong "open"/"role" is persisted and silently skews every
// queue-filtered stat. The stub below would answer a full 6v6 if the guards
// were removed, so each case fails loudly instead of passing by accident.
func TestDetectQueueType_UnreadableBoardYieldsNoQueueType(t *testing.T) {
	cases := []struct {
		name string
		img  image.Image
	}{
		{"no locatable highlighted row", image.NewRGBA(image.Rect(0, 0, 100, 40))},
		{"row without six stat columns", teamsBoardWithColumns(3)},
		// Columns readable, row background not: the team blocks come back as
		// the -1 sentinel and the count crop must be skipped rather than
		// OCR'd over a negative-origin rectangle.
		{"stat columns found but no readable row extent", teamsBoardWithUnreadableRowExtent()},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stubOCR(t, map[string]string{"q_blue": dmgLines(6), "q_red": dmgLines(6)})
			if got := parser.DetectQueueType(c.img, t.TempDir()); got != "" {
				t.Errorf("DetectQueueType = %q, want empty", got)
			}
		})
	}
}

// A failed count crop is deliberately swallowed to 0 rows — but 0 must
// classify as "unknown", never as a queue format.
func TestDetectQueueType_OCRFailureYieldsNoQueueType(t *testing.T) {
	collapseRetryBackoff(t)
	stubOCRError(t, errors.New("tesseract exited 1"))
	if got := parser.DetectQueueType(teamsBoard(), t.TempDir()); got != "" {
		t.Errorf("DetectQueueType = %q, want empty when the count crop can't be OCR'd", got)
	}
}

// The two team blocks are located by scanning OVERLAPPING Y ranges; only
// the color predicates keep them apart. If a threshold change ever let the
// red predicate accept friendly blue (or vice versa) the blocks would merge
// and every match would count 10+ players — i.e. no queue type at all.
func TestTeamBlockY_ColorPredicatesKeepTheTeamBlocksDisjoint(t *testing.T) {
	img := teamsBoard()
	blueTop, blueBot := parser.TeamBlockY(img, parser.IsBlueTablePixel, 0, teamsH*70/100, teamsXLeft, teamsXRight)
	redTop, redBot := parser.TeamBlockY(img, parser.IsRedTablePixel, teamsH*30/100, teamsH, teamsXLeft, teamsXRight)
	if blueTop != teamsBlueTop || blueBot != teamsBlueBot-1 {
		t.Errorf("blue block = %d..%d, want %d..%d", blueTop, blueBot, teamsBlueTop, teamsBlueBot-1)
	}
	if redTop != teamsRedTop || redBot != teamsRedBot-1 {
		t.Errorf("red block = %d..%d, want %d..%d", redTop, redBot, teamsRedTop, teamsRedBot-1)
	}
	if blueBot >= redTop {
		t.Errorf("team blocks overlap: blue ends %d, red starts %d", blueBot, redTop)
	}
}

// A sparse band of team color — a hero portrait strip, a mode banner — must
// not extend a block: a row counts only when the color covers more than a
// quarter of the table width.
func TestTeamBlockY_IgnoresRowsBelowTheQuarterWidthThreshold(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, teamsW, teamsH))
	fillRect(img, image.Rect(0, 0, teamsW, teamsH), black)
	fillRect(img, image.Rect(teamsXLeft, 100, teamsXRight, 200), tableBlue)
	narrowRight := teamsXLeft + (teamsXRight-teamsXLeft)/8
	fillRect(img, image.Rect(teamsXLeft, 300, narrowRight, 320), tableBlue)

	top, bot := parser.TeamBlockY(img, parser.IsBlueTablePixel, 0, teamsH, teamsXLeft, teamsXRight)
	if top != 100 || bot != 199 {
		t.Errorf("block = %d..%d, want 100..199 (the narrow stripe at 300 must not extend it)", top, bot)
	}
}

// findRowXExtent returns -1 when it finds no row background; teamBlockY has
// to recognize that sentinel instead of scanning an inverted or empty span.
func TestTeamBlockY_RejectsAnInvalidXRange(t *testing.T) {
	img := teamsBoard()
	cases := []struct {
		name          string
		xLeft, xRight int
	}{
		{"no extent found", -1, -1},
		{"inverted extent", 900, 100},
		{"empty extent", 500, 500},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			top, bot := parser.TeamBlockY(img, parser.IsBlueTablePixel, 0, teamsH, c.xLeft, c.xRight)
			if top != -1 || bot != -1 {
				t.Errorf("TeamBlockY = %d..%d, want -1..-1", top, bot)
			}
		})
	}
}
