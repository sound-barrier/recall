package parser

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// tesseractPath is the path or command name used to invoke Tesseract.
// Defaults to a bare "tesseract" (PATH lookup) so unit tests and
// command-line use keep working without any configuration. The Wails
// app overrides this at startup via SetTesseractPath, sourcing the
// value from data/settings.json.
var (
	tessPathMu sync.RWMutex
	tessPath   = "tesseract"
)

// SetTesseractPath swaps the binary path the package will use for
// subsequent OCR calls. Safe to call concurrently with parses; a
// torn read across a path change yields either the old or new value,
// both of which are valid choices for that particular invocation.
func SetTesseractPath(p string) {
	p = strings.TrimSpace(p)
	if p == "" {
		return
	}
	tessPathMu.Lock()
	tessPath = p
	tessPathMu.Unlock()
}

func getTesseractPath() string {
	tessPathMu.RLock()
	defer tessPathMu.RUnlock()
	return tessPath
}

type MatchResult struct {
	Map          string `json:"map"`
	Type         string `json:"type"`
	Mode         string `json:"mode"` // "competitive" or "quickplay"
	Role         string `json:"role"`
	Hero         string `json:"hero"`
	Eliminations int    `json:"eliminations"`
	Assists      int    `json:"assists"`
	Deaths       int    `json:"deaths"`
	Damage       int    `json:"damage"`
	Healing      int    `json:"healing"`
	Mitigation   int    `json:"mitigation"`

	// Summary-screen-only fields. Empty on a scoreboard parse.
	Result       string       `json:"result,omitempty"`      // "victory", "defeat", or "draw"
	FinalScore   string       `json:"final_score,omitempty"` // e.g. "3-1"
	Date         string       `json:"date,omitempty"`        // ISO date, e.g. "2026-05-10"
	FinishedAt   string       `json:"finished_at,omitempty"` // HH:MM 24h, as shown by the client
	GameLength   string       `json:"game_length,omitempty"` // MM:SS
	HeroesPlayed []HeroPlay   `json:"heroes_played,omitempty"`
	Performance  *Performance `json:"performance,omitempty"`

	// Competitive rank-screen fields. Populated only by parseRank for the
	// post-match competitive rank progress screen.
	Rank          string   `json:"rank,omitempty"`           // tier name: platinum, gold, etc.
	Level         int      `json:"level,omitempty"`          // sub-division within tier (1-5)
	Modifiers     []string `json:"modifiers,omitempty"`      // ["expected", "victory"], etc.
	RankProgress  int      `json:"rank_progress,omitempty"`  // % into current level
	ChangePercent int      `json:"change_percent,omitempty"` // % the rank moved this match
	SR            []HeroSR `json:"sr,omitempty"`             // per-hero SR + change
}

type HeroSR struct {
	Hero   string `json:"hero"`
	SR     int    `json:"sr"`
	Change int    `json:"change"`
}

type HeroPlay struct {
	Hero          string `json:"hero"`
	PercentPlayed int    `json:"percent_played"`
	PlayTime      string `json:"play_time,omitempty"`
	// Stats holds hero-specific stats from the PERSONAL tab. Keys are
	// snake_case label-derived (e.g. "WEAPON ACCURACY" → "weapon_accuracy");
	// the shape is open because every hero has its own card set. Nested per
	// HeroPlay (rather than a flat top-level map) so multi-hero matches keep
	// each hero's stats distinct.
	Stats map[string]int `json:"stats,omitempty"`
}

type Performance struct {
	Eliminations PerformanceStat `json:"eliminations"`
	Assists      PerformanceStat `json:"assists"`
	Deaths       PerformanceStat `json:"deaths"`
}

type PerformanceStat struct {
	Total       int     `json:"total"`
	AvgPer10Min float64 `json:"avg_per_10min,omitempty"`
}

// knownMaps is the OW2 map list, used to fix Tesseract misreads on map names
// by snapping the OCR result to the closest match.
var knownMaps = []string{
	"aatlis", "antarctic peninsula", "blizzard world", "busan", "circuit royal",
	"colosseo", "dorado", "esperanca", "eichenwalde", "havana", "hollywood",
	"horizon lunar colony", "ilios", "junkertown", "king's row", "lijiang tower",
	"midtown", "nepal", "new junk city", "new queen street", "numbani",
	"oasis", "paraiso", "rialto", "route 66", "runasapi", "samoa", "shambali monastery",
	"suravasa", "throne of anubis", "watchpoint: gibraltar", "volskaya industries",
}

var heroRoles = map[string]string{
	"d.va": "tank", "doomfist": "tank", "hazard": "tank",
	"junker queen": "tank", "mauga": "tank", "orisa": "tank",
	"ramattra": "tank", "reinhardt": "tank", "roadhog": "tank",
	"sigma": "tank", "winston": "tank", "wrecking ball": "tank", "zarya": "tank",

	"ashe": "dps", "bastion": "dps", "cassidy": "dps", "echo": "dps",
	"freja": "dps", "genji": "dps", "hanzo": "dps", "junkrat": "dps",
	"mei": "dps", "pharah": "dps", "reaper": "dps", "sojourn": "dps",
	"soldier: 76": "dps", "soldier 76": "dps", "sombra": "dps",
	"symmetra": "dps", "torbjorn": "dps", "tracer": "dps", "venture": "dps",
	"widowmaker": "dps",

	"ana": "support", "baptiste": "support", "brigitte": "support",
	"illari": "support", "juno": "support", "kiriko": "support",
	"lifeweaver": "support", "lucio": "support", "mercy": "support",
	"moira": "support", "wuyang": "support", "zenyatta": "support",
}

// HeroRole returns the role ("tank", "dps", "support") for the given hero
// name, or "" for an unknown hero. Exported so other packages (e.g. metrics
// label resolution) can resolve roles without reaching into the unexported
// heroRoles map.
func HeroRole(hero string) string {
	return heroRoles[hero]
}

func ParseScreenshot(imagePath string) (*MatchResult, error) {
	tp := getTesseractPath()
	if _, err := exec.LookPath(tp); err != nil {
		return nil, fmt.Errorf("tesseract not available at %q — configure the binary in Settings → Engine (%w)", tp, err)
	}
	f, err := os.Open(imagePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	img, _, err := image.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("decoding image: %w", err)
	}

	work := os.Getenv("RECALL_DEBUG_DIR")
	if work == "" {
		work, err = os.MkdirTemp("", "recall-*")
		if err != nil {
			return nil, err
		}
		defer os.RemoveAll(work)
	} else {
		_ = os.MkdirAll(work, 0700)
	}

	if isRankScreenshot(img, work) {
		return parseRank(img, work)
	}
	if isSummaryScreenshot(img, work) {
		return parseSummary(img, work)
	}
	if isPersonalScreenshot(img, work) {
		return parsePersonal(img, work)
	}
	return parseScoreboard(img, work)
}

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
	// Panel: use raw colour and run OCR twice — PSM 6 reads the labels and
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
	res.Map, res.Type, res.Mode = extractHeader(headerText)
	res.Eliminations, res.Assists, res.Deaths = stats[0], stats[1], stats[2]
	res.Damage, res.Healing, res.Mitigation = stats[3], stats[4], stats[5]
	if heroes := extractHeroes(panelText); len(heroes) > 0 {
		res.Hero = heroes[0]
		if r, ok := heroRoles[res.Hero]; ok {
			res.Role = r
		}
		// The right-side panel on the in-game scoreboard carries the same
		// hero-specific cards the post-match PERSONAL tab does (PLAYERS
		// SAVED, WEAPON ACCURACY, etc.). Surface them on the HeroPlay entry
		// so a standalone scoreboard screenshot isn't missing them, and so
		// they cross-validate against the PERSONAL screen when both exist.
		if heroStats := parsePanelStats(panelText); len(heroStats) > 0 {
			res.HeroesPlayed = []HeroPlay{{Hero: res.Hero, Stats: heroStats}}
		}
	}
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

func parsePanelStats(text string) map[string]int {
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
				stats[labelToKey(l)] = val
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

// ParseScreenshotsDir OCRs every supported image in dir except those in skip
// (a set of filenames already parsed and stored). The skip set lets the app
// avoid re-running Tesseract on files that already belong to a DB row — OCR
// is by far the slowest part of the pipeline.
func ParseScreenshotsDir(dir string, skip map[string]bool) (map[string]*MatchResult, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := map[string]*MatchResult{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
			continue
		}
		if skip[e.Name()] {
			continue
		}
		r, err := ParseScreenshot(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", e.Name(), err)
		}
		out[e.Name()] = r
	}
	return out, nil
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
	// since the friendly team always sits above the centre VS divider.
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

// ocrInverted writes the cropped region as inverted-luminance grayscale (white
// in-game text becomes black, dark backgrounds become white) and 3x upscaled.
// Best for the row stats and header where text is solid white.
func ocrInverted(img image.Image, rect image.Rectangle, workDir, name, psm, whitelist string) (string, error) {
	sub := crop(img, rect)
	pre := preprocessInverted(sub)
	return runTesseract(pre, workDir, name, psm, whitelist)
}

// ocrRaw writes the cropped region untouched (just upscaled) for Tesseract's
// own thresholding. Best for the right-side panel which mixes white digits and
// cyan labels — our custom thresholding tends to drop one or the other.
func ocrRaw(img image.Image, rect image.Rectangle, workDir, name, psm, whitelist string) (string, error) {
	sub := crop(img, rect)
	pre := upscale(sub, 2)
	return runTesseract(pre, workDir, name, psm, whitelist)
}

func runTesseract(pre image.Image, workDir, name, psm, whitelist string) (string, error) {
	inPath := filepath.Join(workDir, name+".png")
	f, err := os.Create(inPath)
	if err != nil {
		return "", err
	}
	if err := png.Encode(f, pre); err != nil {
		_ = f.Close()
		return "", err
	}
	_ = f.Close()

	args := []string{inPath, "-", "--psm", psm}
	if whitelist != "" {
		args = append(args, "-c", "tessedit_char_whitelist="+whitelist)
	}
	var stdout, stderr bytes.Buffer
	cmd := exec.Command(getTesseractPath(), args...)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("tesseract failed: %w (%s)", err, stderr.String())
	}
	out := stdout.String()
	if os.Getenv("OWMETRICS_DEBUG_DIR") != "" {
		_ = os.WriteFile(filepath.Join(workDir, name+".txt"), []byte(out), 0600)
	}
	return out, nil
}

// ocrRowCells finds the 6 stat columns inside the highlighted row by detecting
// white-text clusters horizontally, groups them into columns (digits separated
// by commas in the same number cluster together), then OCRs each as digits.
// This is fully dynamic — no hardcoded ratios — so it works at any resolution
// and any scoreboard layout.
func ocrRowCells(img image.Image, yTop, yBot int, workDir string) ([6]int, error) {
	bounds := img.Bounds()
	H := bounds.Dy()

	// Trim the row to its centre band so we don't catch portrait/icon noise at
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

func crop(src image.Image, r image.Rectangle) image.Image {
	r = r.Intersect(src.Bounds())
	out := image.NewRGBA(image.Rect(0, 0, r.Dx(), r.Dy()))
	for y := 0; y < r.Dy(); y++ {
		for x := 0; x < r.Dx(); x++ {
			out.Set(x, y, src.At(r.Min.X+x, r.Min.Y+y))
		}
	}
	return out
}

func upscale(src image.Image, scale int) image.Image {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	out := image.NewRGBA(image.Rect(0, 0, w*scale, h*scale))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := src.At(x, y)
			for dy := 0; dy < scale; dy++ {
				for dx := 0; dx < scale; dx++ {
					out.Set(x*scale+dx, y*scale+dy, c)
				}
			}
		}
	}
	return out
}

// preprocessInverted converts a colour image to inverted-luminance grayscale at
// 3x scale. Game text (white) becomes black and dark backgrounds become light —
// the orientation Tesseract is trained on. Antialiasing is preserved as a
// gradient, which Tesseract's internal binarisation handles cleanly.
func preprocessInverted(src image.Image) image.Image {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	const scale = 3
	out := image.NewGray(image.Rect(0, 0, w*scale, h*scale))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, _ := src.At(x, y).RGBA()
			lum := uint8((299*int(r>>8) + 587*int(g>>8) + 114*int(b>>8)) / 1000)
			v := 255 - lum
			for dy := 0; dy < scale; dy++ {
				for dx := 0; dx < scale; dx++ {
					out.SetGray(x*scale+dx, y*scale+dy, color.Gray{Y: v})
				}
			}
		}
	}
	return out
}

// extractHeader pulls (map, type, competitive) out of the OCR'd top banner.
// Source format: "PAYLOAD - COMPETITIVE | WATCHPOINT: GIBRALTAR"
//
// Tesseract often mangles individual letters, so the patterns are deliberately
// fuzzy: we look for the most distinctive substring of each keyword and accept
// common OCR substitutions (I/L/1, O/0, etc.).
func extractHeader(text string) (mapName, gameType, mode string) {
	upper := strings.ToUpper(text)

	// Mode: "MPETIT" is the most distinctive substring of "COMPETITIVE";
	// anything else (no match) defaults to quickplay.
	mode = "quickplay"
	for _, sig := range []string{"MPETIT", "ETITIV", "OMPETI"} {
		if strings.Contains(upper, sig) {
			mode = "competitive"
			break
		}
	}

	// Map: try the segment after "|" first (when Tesseract renders the pipe).
	// If that doesn't snap cleanly, slide every known map name across the full
	// header text and pick the one with the smallest Levenshtein distance —
	// this handles maps without ":" in their name and headers where Tesseract
	// mangles the pipe into "]" or similar.
	candidate := text
	if i := strings.LastIndex(text, "|"); i >= 0 && i < len(text)-1 {
		candidate = text[i+1:]
	}
	mapWordRe := regexp.MustCompile(`(?i)^[\sA-Za-z':]*`)
	candidate = mapWordRe.FindString(candidate)
	candidate = strings.ToLower(strings.TrimSpace(candidate))
	mapName = snapToKnownMap(candidate)
	if mapName == "" || mapName == candidate {
		mapName = bestKnownMapInText(text)
	}

	// Type: shared between the in-game banner and the summary card.
	gameType = extractGameType(upper)
	return
}

// typePatterns matches OW2 game types in OCR'd text. Each pattern allows the
// common I/L/1 and O/0 substitutions Tesseract produces on the OW2 fonts so a
// single mangled letter doesn't break the match.
var typePatterns = []struct {
	name string
	re   *regexp.Regexp
}{
	{"payload", regexp.MustCompile(`(?i)PAY[ILT1!|]?[O0]A?D?`)},
	{"control", regexp.MustCompile(`(?i)C[O0]N?T?R[O0]L`)},
	{"push", regexp.MustCompile(`(?i)\bPUSH\b`)},
	{"escort", regexp.MustCompile(`(?i)ESC[O0][RP]T`)},
	{"hybrid", regexp.MustCompile(`(?i)HY[BD]?R[I1]D`)},
	{"flashpoint", regexp.MustCompile(`(?i)FL[A4]SH`)},
	{"clash", regexp.MustCompile(`(?i)CL[A4]SH`)},
}

func extractGameType(text string) string {
	upper := strings.ToUpper(text)
	for _, p := range typePatterns {
		if p.re.MatchString(upper) {
			return p.name
		}
	}
	return ""
}

var intRe = regexp.MustCompile(`\d[\d,]*`)

func extractInts(text string) []int {
	matches := intRe.FindAllString(text, -1)
	out := make([]int, 0, len(matches))
	for _, m := range matches {
		m = strings.ReplaceAll(m, ",", "")
		if n, err := strconv.Atoi(m); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// snapToKnownMap returns the known OW2 map whose lowercase name is closest to
// the OCR'd string by Levenshtein distance, but only if the match is decent
// (distance below ~40% of the candidate length). Otherwise it returns the input
// unchanged so genuinely-unknown maps don't get rewritten to the wrong thing.
func snapToKnownMap(ocr string) string {
	best := ocr
	bestDist := -1
	for _, m := range knownMaps {
		d := levenshtein(ocr, m)
		threshold := len(m) * 4 / 10
		if d <= threshold && (bestDist < 0 || d < bestDist) {
			bestDist = d
			best = m
		}
	}
	return best
}

// bestKnownMapInText slides every known map name across the OCR text as a
// fuzzy substring match and returns the closest match (or "" if none clear the
// quality threshold). This handles map names embedded inside garbled headers
// like "© HYBRID - COMPETITIVE] HOLLYWooD [/MF'7:/]5".
func bestKnownMapInText(text string) string {
	lower := strings.ToLower(text)
	bestMap := ""
	bestDist := -1
	for _, m := range knownMaps {
		if len(m) > len(lower) {
			continue
		}
		threshold := len(m) * 3 / 10
		if threshold < 1 {
			threshold = 1
		}
		for i := 0; i+len(m) <= len(lower); i++ {
			d := levenshtein(lower[i:i+len(m)], m)
			if d <= threshold && (bestDist < 0 || d < bestDist) {
				bestDist = d
				bestMap = m
			}
		}
	}
	return bestMap
}

func levenshtein(a, b string) int {
	la, lb := len(a), len(b)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	prev := make([]int, lb+1)
	curr := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		curr[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			del := prev[j] + 1
			ins := curr[j-1] + 1
			sub := prev[j-1] + cost
			m := del
			if ins < m {
				m = ins
			}
			if sub < m {
				m = sub
			}
			curr[j] = m
		}
		prev, curr = curr, prev
	}
	return prev[lb]
}

func extractHeroes(text string) []string {
	upper := strings.ToUpper(text)
	seen := map[string]bool{}
	var found []string
	// Pass 1: exact substring match.
	for _, hero := range heroNamesByLength() {
		if seen[hero] {
			continue
		}
		if strings.Contains(upper, strings.ToUpper(hero)) {
			seen[hero] = true
			found = append(found, hero)
		}
	}
	if len(found) > 0 {
		return found
	}
	// Pass 2: fuzzy substring match. Tesseract often mistakes one letter
	// (e.g. "JUNKRAT" → "JUMKRAT"), so slide each hero name across the text
	// and accept the closest Levenshtein match if it's well below threshold.
	lower := strings.ToLower(text)
	bestHero := ""
	bestDist := -1
	for _, hero := range heroNamesByLength() {
		if len(hero) > len(lower) {
			continue
		}
		threshold := len(hero) / 4
		if threshold < 1 {
			threshold = 1
		}
		for i := 0; i+len(hero) <= len(lower); i++ {
			d := levenshtein(lower[i:i+len(hero)], hero)
			if d <= threshold && (bestDist < 0 || d < bestDist) {
				bestDist = d
				bestHero = hero
			}
		}
	}
	if bestHero != "" {
		found = append(found, bestHero)
	}
	return found
}

func heroNamesByLength() []string {
	names := make([]string, 0, len(heroRoles))
	for k := range heroRoles {
		names = append(names, k)
	}
	sort.Slice(names, func(i, j int) bool { return len(names[i]) > len(names[j]) })
	return names
}

// isSummaryScreenshot detects the post-match SUMMARY tab by OCRing the upper-
// middle band and looking for labels that appear only on that screen. The
// scoreboard's TEAMS tab has the same top-of-page tab strip ("SUMMARY TEAMS
// PERSONAL") so we can't key on tab labels alone — "HEROES PLAYED" / "TOTAL
// PERFORMANCE" / "PERCENT PLAYED" are unique to the SUMMARY layout.
func isSummaryScreenshot(img image.Image, work string) bool {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W/40, H/12, W*3/4, H*3/10)
	text, err := ocrInverted(img, rect, work, "detect_summary", "6", "")
	if err != nil {
		return false
	}
	upper := strings.ToUpper(text)
	return strings.Contains(upper, "HEROES PLAYED") ||
		strings.Contains(upper, "TOTAL PERFORMANCE") ||
		strings.Contains(upper, "PERCENT PLAYED")
}

// parseSummary handles the post-match SUMMARY tab: three columns (Heroes
// Played cards on the left, Total Performance cards in the middle, a map card
// on the right with result/score/date/mode/game-length). Each column is OCR'd
// independently so a failure in one doesn't drop fields from the others.
func parseSummary(img image.Image, work string) (*MatchResult, error) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()

	res := &MatchResult{}

	// PSM 11 (sparse text) is used for the three column OCRs because each
	// card mixes large italic / styled glyphs with smaller labels, separated
	// by icons. PSM 6 (uniform block) tends to merge an icon into the digit
	// next to it ("17" → "Oe au") or drop italic hero names entirely.
	heroesRect := image.Rect(W/40, H/8, W*30/100, H*92/100)
	heroesText, err := ocrInverted(img, heroesRect, work, "summary_heroes", "11", "")
	if err != nil {
		return nil, fmt.Errorf("summary heroes OCR: %w", err)
	}
	res.HeroesPlayed = parseHeroesPlayed(heroesText)
	if len(res.HeroesPlayed) > 0 {
		res.Hero = res.HeroesPlayed[0].Hero
		if r, ok := heroRoles[res.Hero]; ok {
			res.Role = r
		}
	}

	perfRect := image.Rect(W*30/100, H/8, W*62/100, H*92/100)
	perfText, err := ocrInverted(img, perfRect, work, "summary_perf", "11", "")
	if err != nil {
		return nil, fmt.Errorf("summary performance OCR: %w", err)
	}
	if perf := parsePerformance(perfText); perf != nil {
		res.Performance = perf
		res.Eliminations = perf.Eliminations.Total
		res.Assists = perf.Assists.Total
		res.Deaths = perf.Deaths.Total
	}

	cardRect := image.Rect(W*62/100, H/12, W*99/100, H*95/100)
	cardText, err := ocrInverted(img, cardRect, work, "summary_card", "11", "")
	if err != nil {
		return nil, fmt.Errorf("summary card OCR: %w", err)
	}
	parseRightCard(cardText, res)

	// Top-right badge sits below the currency strip at ~9-13% of H — the
	// strip occupies 0-8% and the badge banner runs underneath it. Raw OCR
	// works directly on the white-on-magenta text without preprocessing.
	badgeRect := image.Rect(W*65/100, H*9/100, W*97/100, H*13/100)
	badgeText, _ := ocrRaw(img, badgeRect, work, "summary_badge", "7", "")
	upperBadge := strings.ToUpper(badgeText)
	if strings.Contains(upperBadge, "MPETIT") || strings.Contains(upperBadge, "OMPETI") {
		res.Mode = "competitive"
	} else if strings.Contains(upperBadge, "QUICK") {
		res.Mode = "quickplay"
	}

	return res, nil
}

// parseHeroesPlayed slices the heroes column into per-hero blocks by anchoring
// on each detected hero name and grabs the first percent and MM:SS that follow
// it. Heroes with 0% (and no play time) are skipped — those are empty card
// slots, not actual heroes played.
func parseHeroesPlayed(text string) []HeroPlay {
	heroes := extractHeroes(text)
	if len(heroes) == 0 {
		return nil
	}
	upper := strings.ToUpper(text)

	type pos struct {
		hero string
		idx  int
	}
	var positions []pos
	seen := map[string]bool{}
	for _, h := range heroes {
		if seen[h] {
			continue
		}
		i := strings.Index(upper, strings.ToUpper(h))
		if i >= 0 {
			positions = append(positions, pos{hero: h, idx: i})
			seen[h] = true
		}
	}
	sort.Slice(positions, func(i, j int) bool { return positions[i].idx < positions[j].idx })

	pctRe := regexp.MustCompile(`(\d{1,3})\s*%`)
	timeRe := regexp.MustCompile(`(\d{1,2}:\d{2})`)

	var out []HeroPlay
	for i, p := range positions {
		end := len(text)
		if i+1 < len(positions) {
			end = positions[i+1].idx
		}
		block := text[p.idx:end]

		pct := 0
		if m := pctRe.FindStringSubmatch(block); m != nil {
			pct, _ = strconv.Atoi(m[1])
		}
		playTime := ""
		if m := timeRe.FindStringSubmatch(block); m != nil {
			playTime = m[1]
		}
		if pct == 0 && playTime == "" {
			continue
		}
		out = append(out, HeroPlay{Hero: p.hero, PercentPlayed: pct, PlayTime: playTime})
	}
	return out
}

// parsePerformance pulls (total, avg-per-10-min) for each labelled card.
// The total is the last "pure integer line" before the label — meaning a line
// whose content is just a 1-3 digit number, with no other characters. This
// filters out icon noise like "S 4" (Tesseract's misread of the skull-X icon
// next to "17") which would otherwise win the "last integer before label"
// race. The avg is anchored on "MIN" so we don't match "10" inside
// "AVG PER 10 MIN".
var (
	perfPureIntLineRe = regexp.MustCompile(`(?m)^\s*(\d{1,3})\s*$`)
	perfAvgRe         = regexp.MustCompile(`(?i)MIN[^0-9]{1,8}(\d+(?:\.\d+)?)`)
)

func parsePerformance(text string) *Performance {
	upper := strings.ToUpper(text)
	perf := &Performance{}
	found := false
	pairs := []struct {
		keyword string
		stat    *PerformanceStat
	}{
		{"ELIMINAT", &perf.Eliminations},
		{"ASSIST", &perf.Assists},
		{"DEATH", &perf.Deaths},
	}
	for _, p := range pairs {
		idx := strings.Index(upper, p.keyword)
		if idx < 0 {
			continue
		}
		// Total: last pure-digit line before the label.
		before := text[:idx]
		ms := perfPureIntLineRe.FindAllStringSubmatch(before, -1)
		if len(ms) > 0 {
			n, _ := strconv.Atoi(ms[len(ms)-1][1])
			p.stat.Total = n
		}
		// Avg: first decimal-or-int after "MIN" within ~120 chars of the label.
		to := idx + 120
		if to > len(text) {
			to = len(text)
		}
		if m := perfAvgRe.FindStringSubmatch(text[idx:to]); m != nil {
			v, _ := strconv.ParseFloat(m[1], 64)
			p.stat.AvgPer10Min = v
		}
		if p.stat.Total != 0 || p.stat.AvgPer10Min != 0 {
			found = true
		}
	}
	if !found {
		return nil
	}
	return perf
}

// scoreDigit accepts digits plus the letters Tesseract commonly substitutes
// for them on the OW2 banner font: O/Q for 0, l/I for 1. The match groups are
// passed through digitize() before being used as a final score.
var (
	finalScoreRe = regexp.MustCompile(`(?i)FINAL\s*SCORE[^\dOoQqIlL]*([\dOoQqIlL]+)[^\dOoQqIlL]*([\dOoQqIlL]+)`)
	dateRe       = regexp.MustCompile(`(?i)DATE[^0-9]{0,8}(\d{1,2}/\d{1,2}/\d{2,4})(?:[^0-9]{1,8}(\d{1,2}:\d{2}))?`)
	gameLenRe    = regexp.MustCompile(`(?i)GAME\s*LENGTH[^0-9]{0,8}(\d{1,2}:\d{2})`)
)

// parseRightCard extracts the map card's fields from one OCR pass: map name,
// result (victory/defeat/draw), final score, date, finish time, game type, and
// game length. Result detection uses prefix-match (e.g. "DEFE", "VICTOR")
// rather than full-word equality so OCR slips like "DEFERT" still classify.
func parseRightCard(text string, res *MatchResult) {
	upper := strings.ToUpper(text)
	switch {
	case strings.Contains(upper, "VICTOR"):
		res.Result = "victory"
	case strings.Contains(upper, "DEFE"):
		res.Result = "defeat"
	case strings.Contains(upper, "DRAW") || strings.Contains(upper, "DRAU"):
		res.Result = "draw"
	}
	if m := bestKnownMapInText(text); m != "" {
		res.Map = m
	}
	if t := extractGameType(text); t != "" {
		res.Type = t
	}
	if m := finalScoreRe.FindStringSubmatch(text); m != nil {
		res.FinalScore = digitize(m[1]) + "-" + digitize(m[2])
	}
	if m := dateRe.FindStringSubmatch(text); m != nil {
		res.Date = normalizeDate(m[1])
		if len(m) > 2 && m[2] != "" {
			res.FinishedAt = m[2]
		}
	}
	if m := gameLenRe.FindStringSubmatch(text); m != nil {
		res.GameLength = m[1]
	}
}

// digitize converts the common letter→digit OCR substitutions back to digits.
// Only used on captures that the surrounding regex has already established
// should be numeric (e.g. final-score brackets), so we don't accidentally
// mangle real letters elsewhere.
func digitize(s string) string {
	r := strings.NewReplacer("O", "0", "o", "0", "Q", "0", "q", "0", "I", "1", "l", "1", "L", "1")
	return r.Replace(s)
}

// normalizeDate converts the client's MM/DD/YY display format to ISO YYYY-MM-DD
// so DB rows sort chronologically. Two-digit years are assumed to be 2000+;
// OW2 didn't ship until 2022 so a "19/.../69" date is implausible.
func normalizeDate(d string) string {
	m := regexp.MustCompile(`(\d{1,2})/(\d{1,2})/(\d{2,4})`).FindStringSubmatch(d)
	if m == nil {
		return d
	}
	mm, _ := strconv.Atoi(m[1])
	dd, _ := strconv.Atoi(m[2])
	yy, _ := strconv.Atoi(m[3])
	if yy < 100 {
		yy += 2000
	}
	return fmt.Sprintf("%04d-%02d-%02d", yy, mm, dd)
}

// isPersonalScreenshot detects the post-match PERSONAL tab. The left sidebar
// has a per-hero filter button list followed by an "ALL HEROES" entry —
// neither appears on SUMMARY or TEAMS. The "ALL HEROES" button's vertical
// position shifts down as more heroes get played in a match (single-hero
// match: ~Y=20%; 3-hero match: ~Y=40%; many-hero match: even lower), so we
// OCR the full vertical extent of the sidebar rather than just the top.
func isPersonalScreenshot(img image.Image, work string) bool {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(0, H*15/100, W*12/100, H*85/100)
	text, err := ocrInverted(img, rect, work, "detect_personal", "11", "")
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToUpper(text), "ALL HEROES")
}

// parsePersonal handles the PERSONAL tab: a 3×3 grid where the top-left cell
// is a hero-info card (name / % played / play time) and the other eight are
// hero-specific stat cards (a value, a label, optionally an avg-per-10-min).
// Cards are OCR'd individually because PSM 11 on the whole grid interleaves
// the columns and makes value-label pairing unreliable. Cell labels are kept
// open-ended (snake_case map keys) so we don't need a per-hero allowlist.
func parsePersonal(img image.Image, work string) (*MatchResult, error) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()

	res := &MatchResult{}

	// Mode badge (same position as the SUMMARY screen).
	badgeRect := image.Rect(W*65/100, H*9/100, W*97/100, H*13/100)
	badgeText, _ := ocrRaw(img, badgeRect, work, "personal_badge", "7", "")
	upperBadge := strings.ToUpper(badgeText)
	if strings.Contains(upperBadge, "MPETIT") || strings.Contains(upperBadge, "OMPETI") {
		res.Mode = "competitive"
	} else if strings.Contains(upperBadge, "QUICK") {
		res.Mode = "quickplay"
	}

	// 3×3 stat grid. X boundaries calibrated against the actual card
	// positions at 2560×1440 by scanning for the dark card background between
	// the sidebar and the right edge: cards run roughly X=20.5%..96.5% of W,
	// not X=11%..99% (that earlier guess put cell 0 mostly inside the
	// sidebar). 7px inter-card gaps are absorbed by the integer cell math.
	gridLeft := W * 20 / 100
	gridRight := W * 97 / 100
	gridTop := H * 16 / 100
	gridBot := H * 95 / 100
	cellW := (gridRight - gridLeft) / 3
	cellH := (gridBot - gridTop) / 3

	for row := 0; row < 3; row++ {
		for col := 0; col < 3; col++ {
			name := fmt.Sprintf("personal_r%dc%d", row, col)

			// Primary pass: full cell, dual-PSM. PSM 11 (sparse) gets large
			// values cleanly; PSM 6 (uniform block) catches what 11 drops.
			fullRect := image.Rect(
				gridLeft+col*cellW, gridTop+row*cellH,
				gridLeft+(col+1)*cellW, gridTop+(row+1)*cellH,
			)
			text11, _ := ocrInverted(img, fullRect, work, name, "11", "")
			text6, _ := ocrInverted(img, fullRect, work, name+"_b", "6", "")
			cellText := text11 + "\n" + text6

			// Stat cells: also OCR with the left 30% (tick + icon) cropped
			// out. The icon often gets misread as a lowercase letter run
			// glued to the first word of the label (Juno's orbital-ring
			// icon → "orn" before "BITAL RAY ASSISTS"). Stripping it
			// produces a clean label that the regex picks over the
			// glued-prefix version on length. We keep the full-cell text
			// in cellText too because the strip sometimes loses the value
			// (a lone "1" digit next to the icon edge).
			if row != 0 || col != 0 {
				stripRect := image.Rect(
					gridLeft+col*cellW+cellW*30/100, gridTop+row*cellH,
					gridLeft+(col+1)*cellW, gridTop+(row+1)*cellH,
				)
				strip11, _ := ocrInverted(img, stripRect, work, name+"_s", "11", "")
				cellText += "\n" + strip11
			}

			if row == 0 && col == 0 {
				parsePersonalHeroCell(cellText, res)
			} else if key, val, ok := parsePersonalStatCell(cellText); ok {
				if len(res.HeroesPlayed) == 0 {
					// Stats with no hero card is a parse failure on the
					// hero-info cell — skip rather than dropping the stat
					// into a nameless bucket.
					continue
				}
				if res.HeroesPlayed[0].Stats == nil {
					res.HeroesPlayed[0].Stats = map[string]int{}
				}
				res.HeroesPlayed[0].Stats[key] = val
			}
		}
	}

	return res, nil
}

// parsePersonalHeroCell parses the top-left hero info card (hero name, %
// played, play time) into res.Hero, res.Role, and one HeroPlay entry. Keeps
// the same shape as the SUMMARY tab's heroes_played so a merge by filename
// timestamp can fold both into the same record.
func parsePersonalHeroCell(text string, res *MatchResult) {
	heroes := extractHeroes(text)
	if len(heroes) > 0 {
		res.Hero = heroes[0]
		if r, ok := heroRoles[res.Hero]; ok {
			res.Role = r
		}
	}
	pct := 0
	if m := regexp.MustCompile(`(\d{1,3})\s*%`).FindStringSubmatch(text); m != nil {
		pct, _ = strconv.Atoi(m[1])
	}
	playTime := ""
	if m := regexp.MustCompile(`(\d{1,2}:\d{2})`).FindStringSubmatch(text); m != nil {
		playTime = m[1]
	}
	if res.Hero != "" && (pct > 0 || playTime != "") {
		res.HeroesPlayed = append(res.HeroesPlayed, HeroPlay{
			Hero:          res.Hero,
			PercentPlayed: pct,
			PlayTime:      playTime,
		})
	}
}

// parsePersonalStatCell extracts (label_key, value) from one stat card.
// Tesseract often reads card icons as prefix junk ("PP 41%", "-@- PLAYERS
// SAVED"), so we don't require the line to be a clean value or label —
// instead we scan non-AVG lines for the first 1-4 digit number (value) and
// the longest uppercase phrase (label), trimming the icon noise as a side
// effect.
var (
	personalPctRe   = regexp.MustCompile(`(\d{1,4})\s*%`)
	personalIntRe   = regexp.MustCompile(`\d{1,4}`)
	personalLabelRe = regexp.MustCompile(`[A-Z][A-Z\s]{4,}[A-Z]`)
)

func parsePersonalStatCell(text string) (string, int, bool) {
	// Pass 1: prefer a %-suffixed digit. Percent stats always have a %, and
	// the % is a strong disambiguator against icon-misread digits like "a7?".
	val := -1
	for _, line := range strings.Split(text, "\n") {
		if strings.Contains(strings.ToUpper(line), "AVG") {
			continue
		}
		if m := personalPctRe.FindStringSubmatch(line); m != nil {
			val, _ = strconv.Atoi(m[1])
			break
		}
	}
	// Pass 2: longest digit run on a non-AVG line. Integer stats (kills,
	// rescues) don't have %, so we pick the run with the most digits — icon
	// noise is usually a single random digit, real values are typically 2+
	// digits or a uniquely-correct single digit.
	if val < 0 {
		bestLen := 0
		for _, line := range strings.Split(text, "\n") {
			if strings.Contains(strings.ToUpper(line), "AVG") {
				continue
			}
			for _, m := range personalIntRe.FindAllString(line, -1) {
				if len(m) > bestLen {
					bestLen = len(m)
					val, _ = strconv.Atoi(m)
				}
			}
		}
	}
	if val < 0 {
		return "", 0, false
	}
	var label string
	for _, line := range strings.Split(text, "\n") {
		if strings.Contains(strings.ToUpper(line), "AVG") {
			continue
		}
		for _, m := range personalLabelRe.FindAllString(line, -1) {
			m = trimShortBoundaryWords(strings.TrimSpace(m))
			if len(m) > len(label) {
				label = m
			}
		}
	}
	if label == "" {
		return "", 0, false
	}
	return labelToKey(label), val, true
}

// trimShortBoundaryWords drops 1-3 character words from the start and end of
// the extracted label. Tesseract often glues icon-misread runs ("CS", "PP",
// "VA") to a real label like "SOUND BARRIERS PROVIDED" via a space; the real
// labels are always multi-word and each word is 5+ characters, so stripping
// short boundary words cheaply removes the noise without an icon allowlist.
func trimShortBoundaryWords(s string) string {
	words := strings.Fields(s)
	for len(words) > 1 && len(words[0]) <= 3 {
		words = words[1:]
	}
	for len(words) > 1 && len(words[len(words)-1]) <= 3 {
		words = words[:len(words)-1]
	}
	return strings.Join(words, " ")
}

// labelToKey turns an OCR'd uppercase label into a stable snake_case key.
func labelToKey(label string) string {
	lower := strings.ToLower(label)
	key := regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(lower, "_")
	return strings.Trim(key, "_")
}

// knownRanks is the OW2 competitive tier list, used to snap OCR'd tier text.
var knownRanks = []string{
	"bronze", "silver", "gold", "platinum", "diamond",
	"master", "grandmaster", "champion",
}

// knownModifiers is the OW2 competitive match-outcome modifier list. These
// label the small pills under the rank progress bar.
var knownModifiers = []string{
	"expected", "unexpected", "underdog", "overcharge",
	"victory", "defeat", "draw",
}

// isRankScreenshot detects the post-match competitive RANK PROGRESS screen.
// "RANK PROGRESS" sits in the middle of the screen and is unique to this
// view (SUMMARY / TEAMS / PERSONAL never show it).
func isRankScreenshot(img image.Image, work string) bool {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W*10/100, H*55/100, W*70/100, H*78/100)
	text, err := ocrInverted(img, rect, work, "detect_rank", "11", "")
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToUpper(text), "RANK PROGRESS")
}

// parseRank handles the post-match competitive rank screen: the tier badge
// (PLATINUM 5), the rank-progress bar with its change percentage, the match
// modifier pills (EXPECTED / VICTORY / etc.), and the per-hero SR + delta
// panel on the right. mode is forced to "competitive" because this screen
// only shows up for ranked play.
func parseRank(img image.Image, work string) (*MatchResult, error) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	res := &MatchResult{Mode: "competitive"}

	// Top-left banner: "COMPETITIVE VICTORY!" / "COMPETITIVE DEFEAT!" /
	// "COMPETITIVE DRAW!". Same prefix-match rule as the SUMMARY card so
	// OCR slips like "DEFERT" still classify.
	bannerRect := image.Rect(0, H*7/100, W*45/100, H*22/100)
	bannerText, _ := ocrInverted(img, bannerRect, work, "rank_banner", "11", "")
	upper := strings.ToUpper(bannerText)
	switch {
	case strings.Contains(upper, "VICTOR"):
		res.Result = "victory"
	case strings.Contains(upper, "DEFE"):
		res.Result = "defeat"
	case strings.Contains(upper, "DRAW") || strings.Contains(upper, "DRAU"):
		res.Result = "draw"
	}

	// Tier label: "PLATINUM 5" text sits just below the badge in the center
	// (Y≈60-68% of H — the badge itself takes the band above it).
	tierRect := image.Rect(W*30/100, H*58/100, W*70/100, H*70/100)
	tierText, _ := ocrInverted(img, tierRect, work, "rank_tier", "11", "")
	res.Rank, res.Level = extractRank(tierText)

	// Rank progress bar — "RANK PROGRESS: 21%" caption plus a "+25%" delta
	// pill inside the bar. OCR both in one wider crop and pull each via its
	// own regex.
	progressRect := image.Rect(W*10/100, H*60/100, W*70/100, H*80/100)
	progressText, _ := ocrInverted(img, progressRect, work, "rank_progress", "11", "")
	if m := regexp.MustCompile(`(?i)RANK\s*PROGRESS[^0-9]*(\d{1,3})`).FindStringSubmatch(progressText); m != nil {
		res.RankProgress, _ = strconv.Atoi(m[1])
	}
	if m := regexp.MustCompile(`\+\s*(\d{1,3})\s*%`).FindStringSubmatch(progressText); m != nil {
		res.ChangePercent, _ = strconv.Atoi(m[1])
	}

	// Modifier pills below the progress bar.
	modifierRect := image.Rect(W*10/100, H*78/100, W*55/100, H*90/100)
	modifierText, _ := ocrInverted(img, modifierRect, work, "rank_modifiers", "11", "")
	res.Modifiers = extractModifiers(modifierText)

	// Right-side per-hero SR card: hero portrait + "HERO SR" + 4-digit SR +
	// signed change. The card sits ~85-99% across, mid-height.
	srRect := image.Rect(W*82/100, H*22/100, W*99/100, H*55/100)
	srText, _ := ocrInverted(img, srRect, work, "rank_sr", "11", "")
	res.SR = extractSR(srText)
	if len(res.SR) > 0 {
		res.Hero = res.SR[0].Hero
		if r, ok := heroRoles[res.Hero]; ok {
			res.Role = r
		}
	}

	return res, nil
}

func extractRank(text string) (string, int) {
	lower := strings.ToLower(text)
	rank := ""
	for _, r := range knownRanks {
		if strings.Contains(lower, r) {
			rank = r
			break
		}
	}
	level := 0
	// Anchor the level match on the rank name to avoid picking up unrelated
	// digits from icon noise (e.g. Tesseract reads italic decoration as
	// extra digits before the level). Take the LAST digit in the trailing
	// number-run after the rank — italic fonts often misread to insert a
	// leading digit (so "PLATINUM 5" OCRs as "PLATINUM 35"), and OW2 levels
	// are always 1-5 single digits.
	if rank != "" {
		re := regexp.MustCompile(`(?i)` + rank + `\s*(\d+)`)
		if m := re.FindStringSubmatch(text); m != nil {
			lastDigit := m[1][len(m[1])-1:]
			level, _ = strconv.Atoi(lastDigit)
		}
	}
	return rank, level
}

func extractModifiers(text string) []string {
	lower := strings.ToLower(text)
	seen := map[string]bool{}
	var found []string
	for _, m := range knownModifiers {
		if strings.Contains(lower, m) && !seen[m] {
			found = append(found, m)
			seen[m] = true
		}
	}
	return found
}

// extractSR pulls (hero, SR, change) from the right-side SR panel OCR. SR is
// the first 4-digit integer; change is the first 1-3 digit integer (with
// optional sign) after the SR. Heroes use the existing extractHeroes fuzzy
// matcher.
func extractSR(text string) []HeroSR {
	heroes := extractHeroes(text)
	if len(heroes) == 0 {
		return nil
	}
	out := make([]HeroSR, 0, len(heroes))
	for _, h := range heroes {
		entry := HeroSR{Hero: h}
		if m := regexp.MustCompile(`\b(\d{4})\b`).FindStringSubmatchIndex(text); m != nil {
			entry.SR, _ = strconv.Atoi(text[m[2]:m[3]])
			rest := text[m[1]:]
			if m2 := regexp.MustCompile(`([+\-]?)\s*(\d{1,3})`).FindStringSubmatch(rest); m2 != nil {
				v, _ := strconv.Atoi(m2[2])
				if m2[1] == "-" {
					v = -v
				}
				entry.Change = v
			}
		}
		out = append(out, entry)
	}
	return out
}
