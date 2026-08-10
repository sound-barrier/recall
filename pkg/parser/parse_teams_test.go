package parser_test

import (
	"errors"
	"image"
	"image/color"
	"strings"
	"sync"
	"testing"

	"recall/pkg/parser"
)

// ─────────────────────────────────────────────────────────────────────────
// A synthetic TEAMS scoreboard, painted so every pixel heuristic in
// parse_teams.go + queue.go has something real to find: a friendly (blue)
// team block whose one highlighted row is a brighter shade, an enemy (red)
// block below the center divider, and six white stat clusters inside the
// highlighted row.
//
// The six stat columns are painted at DELIBERATELY DIFFERENT widths. Each
// OCR call receives a 3x-upscaled crop, so the width of the image the stub
// is handed identifies which column produced it — that is what lets
// TestDetectQueueType_CountsPlayersFromTheDamageColumn prove the queue
// counter reads DMG rather than one of the E/A/D columns beside it.

const (
	teamsW, teamsH             = 1200, 800
	teamsXLeft, teamsXRight    = 100, 1150
	teamsBlueTop, teamsBlueBot = 100, 300
	teamsRowTop, teamsRowBot   = 150, 190
	teamsRedTop, teamsRedBot   = 450, 650
	teamsColTop, teamsColBot   = teamsRowTop + 5, teamsRowBot - 12
	teamsStatColumns           = 6
)

var (
	teamsColX = [teamsStatColumns]int{700, 750, 810, 880, 980, 1060}
	teamsColW = [teamsStatColumns]int{10, 20, 30, 60, 40, 50}
	// Enemy-team row background: clears isRedTablePixel and misses every
	// blue predicate, so the two team blocks stay distinguishable.
	teamsRed = color.RGBA{R: 180, G: 50, B: 60, A: 255}
)

func teamsBoard() image.Image { return teamsBoardWithColumns(teamsStatColumns) }

// teamsBoardWithColumns paints the board with only the first n stat columns,
// so the "fewer than six columns" rejection can be driven from a real image.
func teamsBoardWithColumns(n int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, teamsW, teamsH))
	fillRect(img, image.Rect(0, 0, teamsW, teamsH), black)
	fillRect(img, image.Rect(teamsXLeft, teamsBlueTop, teamsXRight, teamsBlueBot), tableBlue)
	fillRect(img, image.Rect(teamsXLeft, teamsRowTop, teamsXRight, teamsRowBot), highlightedBlue)
	fillRect(img, image.Rect(teamsXLeft, teamsRedTop, teamsXRight, teamsRedBot), teamsRed)
	for i := range n {
		fillRect(img, image.Rect(teamsColX[i], teamsColTop, teamsColX[i]+teamsColW[i], teamsColBot), white)
	}
	return img
}

// teamsOCRCall is one recorded OCR invocation. width is the preprocessed
// crop's width (3x the source region), which identifies the region.
type teamsOCRCall struct {
	name, psm string
	width     int
}

// stubOCRTrace swaps the Tesseract seam for a fake answering from `table`
// — keyed "<name>" or, to vary per attempt, "<name>/<psm>" (the latter
// wins) — and logs every call. Read the log only after the parse returns.
func stubOCRTrace(t *testing.T, table map[string]string) *[]teamsOCRCall {
	t.Helper()
	var mu sync.Mutex
	calls := &[]teamsOCRCall{}
	original := *parser.RunTesseractFunc
	*parser.RunTesseractFunc = func(pre image.Image, spec parser.OCRSpec) (string, error) { //nolint:unparam // signature fixed by RunTesseractFunc
		name, psm := parser.SpecName(spec), parser.SpecPSM(spec)
		mu.Lock()
		*calls = append(*calls, teamsOCRCall{name, psm, pre.Bounds().Dx()})
		mu.Unlock()
		if s, ok := table[name+"/"+psm]; ok {
			return s, nil
		}
		return table[name], nil
	}
	t.Cleanup(func() { *parser.RunTesseractFunc = original })
	return calls
}

// callsNamed returns the recorded calls for one region, in order.
func callsNamed(calls []teamsOCRCall, name string) []teamsOCRCall {
	var out []teamsOCRCall
	for _, c := range calls {
		if c.name == name {
			out = append(out, c)
		}
	}
	return out
}

// collapseRetryBackoff removes the OCR retry sleeps so an error-path test
// doesn't spend 600ms per failing region.
func collapseRetryBackoff(t *testing.T) {
	t.Helper()
	original := *parser.TesseractRetryDelays
	*parser.TesseractRetryDelays = nil
	t.Cleanup(func() { *parser.TesseractRetryDelays = original })
}

// ─────────────────────────────────────────────────────────────────────────

// The scoreboard's six rightmost clusters are E, A, D, DMG, H, MIT in that
// order. Nothing downstream re-derives the order, so a swap here silently
// files damage as healing on every teams screenshot ever parsed.
func TestParseTeams_MapsTheSixColumnsToCombatStatsInOrder(t *testing.T) {
	stubOCR(t, map[string]string{
		"col_e": "17", "col_a": "9", "col_d": "4",
		"col_dmg": "13,432", "col_h": "1,204", "col_mit": "2,860",
	})
	res, err := parser.ParseTeams(teamsBoard(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseTeams: %v", err)
	}
	stats := []struct {
		label     string
		got, want int
	}{
		{"eliminations", res.Eliminations, 17},
		{"assists", res.Assists, 9},
		{"deaths", res.Deaths, 4},
		{"damage", res.Damage, 13432},
		{"healing", res.Healing, 1204},
		{"mitigation", res.Mitigation, 2860},
	}
	for _, s := range stats {
		if s.got != s.want {
			t.Errorf("%s = %d, want %d", s.label, s.got, s.want)
		}
	}
}

// The in-game scoreboard is deliberately NOT a summary source: map, mode,
// hero, role and result are merged in by correlation from the SUMMARY /
// RANK / PERSONAL screens. Manufacturing any of them here would let a
// mid-match capture overwrite the authoritative post-match row.
func TestParseTeams_ClaimsNoMatchIdentityFields(t *testing.T) {
	stubOCR(t, map[string]string{
		"col_e": "17", "col_dmg": "13,432",
		// Text a summary parser would happily mine, in the regions a
		// teams parse never reads.
		"detect_summary": "HEROES PLAYED LUCIO CIRCUIT ROYAL VICTORY",
		"summary_card":   "CIRCUIT ROYAL PAYLOAD VICTORY 05/10/26",
	})
	res, err := parser.ParseTeams(teamsBoard(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseTeams: %v", err)
	}
	identity := []struct{ label, got string }{
		{"map", res.Map}, {"map_raw", res.MapRaw}, {"game_mode", res.GameMode},
		{"playlist", res.Playlist}, {"role", res.Role}, {"hero", res.Hero},
		{"result", res.Result}, {"date", res.Date}, {"final_score", res.FinalScore},
	}
	for _, f := range identity {
		if f.got != "" {
			t.Errorf("teams parse must not claim %s, got %q", f.label, f.got)
		}
	}
	if res.HeroesPlayed != nil || res.Performance != nil {
		t.Errorf("teams parse must not populate heroes_played/performance, got %v / %v", res.HeroesPlayed, res.Performance)
	}
}

// An image too short to hold a scoreboard row must be REJECTED, not parsed
// into a fabricated row — the pixel heuristics will otherwise hand back a
// zero-stat result that correlation treats as a real match.
func TestParseTeams_RejectsAnImageWithNoHighlightedRow(t *testing.T) {
	stubOCR(t, map[string]string{})
	_, err := parser.ParseTeams(image.NewRGBA(image.Rect(0, 0, 100, 40)), t.TempDir())
	if err == nil {
		t.Fatal("expected an error for an image with no locatable highlighted row")
	}
	if !strings.Contains(err.Error(), "highlighted") {
		t.Errorf("error must name the missing highlighted row, got %q", err)
	}
}

// Fewer than six clusters means the row wasn't really a scoreboard row (or
// the layout moved). Reporting the count found is what makes the failure
// diagnosable from a user's Unknown-tab report.
func TestParseTeams_RejectsARowWithoutSixStatColumns(t *testing.T) {
	stubOCR(t, map[string]string{})
	_, err := parser.ParseTeams(teamsBoardWithColumns(3), t.TempDir())
	if err == nil {
		t.Fatal("expected an error for a row with only 3 stat columns")
	}
	for _, want := range []string{"row OCR", "expected 6 stat columns", "found 3"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q must contain %q", err, want)
		}
	}
}

// An OCR failure must surface as an error naming the column that failed and
// still wrapping the underlying cause — swallowing it would store a
// silently zeroed stat line.
func TestParseTeams_OCRFailurePropagatesAndNamesTheColumn(t *testing.T) {
	collapseRetryBackoff(t)
	boom := errors.New("tesseract exited 1")
	stubOCRError(t, boom)
	_, err := parser.ParseTeams(teamsBoard(), t.TempDir())
	if err == nil {
		t.Fatal("expected the OCR failure to propagate")
	}
	if !errors.Is(err, boom) {
		t.Errorf("error must wrap the OCR cause, got %q", err)
	}
	for _, want := range []string{"row OCR", "col_e"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q must contain %q", err, want)
		}
	}
}

// Each cell walks a page-segmentation ladder (PSM 7 digits → 10 digits →
// 10 open → 8 open) and stops at the first attempt that yields a number.
// Losing the ladder loses the thin-digit cells; losing the early stop
// quadruples the Tesseract invocations on every parse.
func TestOCRRowCells_EscalatesSegmentationOnlyUntilDigitsAppear(t *testing.T) {
	calls := stubOCRTrace(t, map[string]string{
		"col_e/7": "", "col_e/10": "|||", "col_e/8": "17",
		"col_a/7": "9",
	})
	res, err := parser.ParseTeams(teamsBoard(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseTeams: %v", err)
	}
	if res.Eliminations != 17 {
		t.Errorf("eliminations = %d, want 17 recovered by the last ladder rung", res.Eliminations)
	}
	if res.Assists != 9 {
		t.Errorf("assists = %d, want 9", res.Assists)
	}
	var psms []string
	for _, c := range callsNamed(*calls, "col_e") {
		psms = append(psms, c.psm)
	}
	if strings.Join(psms, ",") != "7,10,10,8" {
		t.Errorf("col_e segmentation ladder = %v, want [7 10 10 8]", psms)
	}
	if n := len(callsNamed(*calls, "col_a")); n != 1 {
		t.Errorf("col_a was OCR'd %d times; a cell that reads on the first attempt must not escalate", n)
	}
}

// When no rung of the ladder yields a digit the cell stays 0 — the same
// value a genuine 0 produces. That ambiguity is exactly why the queue
// counter reads the DMG column (always non-zero) instead of E/A/D.
func TestParseTeams_UnreadableCellIsIndistinguishableFromZero(t *testing.T) {
	stubOCR(t, map[string]string{
		"col_e": "17", "col_a": "9", "col_dmg": "13,432",
		"col_h": "1,204", "col_mit": "2,860",
		// col_d answers "" for every rung.
	})
	res, err := parser.ParseTeams(teamsBoard(), t.TempDir())
	if err != nil {
		t.Fatalf("ParseTeams: %v", err)
	}
	if res.Deaths != 0 {
		t.Errorf("deaths = %d, want 0 for a cell no segmentation mode could read", res.Deaths)
	}
	if res.Eliminations != 17 || res.Mitigation != 2860 {
		t.Errorf("one unreadable cell must not disturb its neighbors: E=%d MIT=%d", res.Eliminations, res.Mitigation)
	}
}

// findRowXExtent returns -1 when it can't find the row background at all.
// The cluster scan has to treat that as "search the whole width" — clamping
// to a negative bound would scan nothing and reject a readable row.
func TestFindStatColumns_FallsBackToFullWidthOnAnUnreadableExtent(t *testing.T) {
	const w, h = 960, 200
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	fillRect(img, image.Rect(0, 0, w, h), black)
	yT, yB := 80, 130
	for _, x := range []int{300, 340, 380} {
		fillRect(img, image.Rect(x, yT+10, x+12, yB-10), white)
	}
	if cols := parser.FindStatColumns(img, yT, yB, -1, -1); len(cols) != 3 {
		t.Fatalf("expected the 3 clusters to be found across the full width, got %d (%+v)", len(cols), cols)
	}
}

// Two shapes the scan must reject and one it must not. A 2-pixel bright run
// is antialiasing or an icon stroke, never a number. A bright blob sitting
// far past the last column is the audio/mic icon — the trailing-gap rule
// exists precisely to strip it, and without it every teams row reports
// seven "stat" columns and the stats shift one place left.
func TestFindStatColumns_DropsSpecksAndOffTableIcons(t *testing.T) {
	const w, h = 960, 200
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	fillRect(img, image.Rect(0, 0, w, h), black)
	yT, yB := 80, 130
	fillRect(img, image.Rect(200, yT+10, 202, yB-10), white) // 2-px speck
	for _, x := range []int{400, 450, 500} {
		fillRect(img, image.Rect(x, yT+10, x+12, yB-10), white)
	}
	fillRect(img, image.Rect(700, yT+10, 712, yB-10), white) // off-table icon

	cols := parser.FindStatColumns(img, yT, yB, 100, w-1)
	if len(cols) != 3 {
		t.Fatalf("expected 3 stat columns, got %d (%+v)", len(cols), cols)
	}
	if cols[0].Min.X != 400 || cols[2].Max.X != 511 {
		t.Errorf("surviving columns = %+v, want the run from 400 to 511", cols)
	}
}

// A cluster still open when the scan reaches its right edge must be emitted.
// The rightmost stat (MIT) sits at the table edge, so dropping the open run
// loses a column and fails the whole row with "found 5".
func TestFindStatColumns_KeepsAClusterRunningToTheScanEdge(t *testing.T) {
	const w, h = 960, 200
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	fillRect(img, image.Rect(0, 0, w, h), black)
	yT, yB := 80, 130
	fillRect(img, image.Rect(400, yT+10, 412, yB-10), white)
	fillRect(img, image.Rect(450, yT+10, 462, yB-10), white)
	fillRect(img, image.Rect(500, yT+10, 540, yB-10), white)

	cols := parser.FindStatColumns(img, yT, yB, 100, 539)
	if len(cols) != 3 {
		t.Fatalf("expected 3 stat columns, got %d (%+v)", len(cols), cols)
	}
	if cols[2].Max.X != 539 {
		t.Errorf("edge cluster ends at %d, want the scan edge 539", cols[2].Max.X)
	}
}

// teamsBoardWithUnreadableRowExtent paints a highlighted band thinner than
// one row height, so the row window's midline lands on background: the stat
// columns are perfectly visible but findRowXExtent finds no row edges.
func teamsBoardWithUnreadableRowExtent() image.Image {
	img := image.NewRGBA(image.Rect(0, 0, teamsW, teamsH))
	fillRect(img, image.Rect(0, 0, teamsW, teamsH), black)
	fillRect(img, image.Rect(teamsXLeft, 200, teamsXRight, 204), highlightedBlue)
	for i := range teamsStatColumns {
		fillRect(img, image.Rect(teamsColX[i], 176, teamsColX[i]+teamsColW[i], 200), white)
	}
	return img
}
