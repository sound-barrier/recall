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
)

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
	Result       string       `json:"result,omitempty"`       // "victory", "defeat", or "draw"
	FinalScore   string       `json:"final_score,omitempty"`  // e.g. "3-1"
	Date         string       `json:"date,omitempty"`         // ISO date, e.g. "2026-05-10"
	FinishedAt   string       `json:"finished_at,omitempty"`  // HH:MM 24h, as shown by the client
	GameLength   string       `json:"game_length,omitempty"`  // MM:SS
	HeroesPlayed []HeroPlay   `json:"heroes_played,omitempty"`
	Performance  *Performance `json:"performance,omitempty"`
}

type HeroPlay struct {
	Hero          string `json:"hero"`
	PercentPlayed int    `json:"percent_played"`
	PlayTime      string `json:"play_time,omitempty"`
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
	"moira": "support", "zenyatta": "support",
}

func ParseScreenshot(imagePath string) (*MatchResult, error) {
	if _, err := exec.LookPath("tesseract"); err != nil {
		return nil, errors.New("tesseract is required but not found on PATH (install with: brew install tesseract)")
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

	work := os.Getenv("OWMETRICS_DEBUG_DIR")
	if work == "" {
		work, err = os.MkdirTemp("", "owmetrics-*")
		if err != nil {
			return nil, err
		}
		defer os.RemoveAll(work)
	} else {
		_ = os.MkdirAll(work, 0700)
	}

	if isSummaryScreenshot(img, work) {
		return parseSummary(img, work)
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
	}
	return res, nil
}

func ParseScreenshotsDir(dir string) (map[string]*MatchResult, error) {
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
		f.Close()
		return "", err
	}
	f.Close()

	args := []string{inPath, "-", "--psm", psm}
	if whitelist != "" {
		args = append(args, "-c", "tessedit_char_whitelist="+whitelist)
	}
	var stdout, stderr bytes.Buffer
	cmd := exec.Command("tesseract", args...)
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

var (
	finalScoreRe = regexp.MustCompile(`(?i)FINAL\s*SCORE[^0-9]{0,8}(\d+)[^0-9]{1,8}(\d+)`)
	dateRe       = regexp.MustCompile(`(?i)DATE[^0-9]{0,8}(\d{1,2}/\d{1,2}/\d{2,4})(?:[^0-9]{1,8}(\d{1,2}:\d{2}))?`)
	gameLenRe    = regexp.MustCompile(`(?i)GAME\s*LENGTH[^0-9]{0,8}(\d{1,2}:\d{2})`)
)

// parseRightCard extracts the map card's fields from one OCR pass: map name,
// result (victory/defeat/draw), final score, date, finish time, game type, and
// game length. Map and game type use the existing fuzzy matchers so they
// tolerate the same OCR slips the in-game banner does.
func parseRightCard(text string, res *MatchResult) {
	upper := strings.ToUpper(text)
	switch {
	case strings.Contains(upper, "VICTORY"):
		res.Result = "victory"
	case strings.Contains(upper, "DEFEAT"):
		res.Result = "defeat"
	case strings.Contains(upper, "DRAW"):
		res.Result = "draw"
	}
	if m := bestKnownMapInText(text); m != "" {
		res.Map = m
	}
	if t := extractGameType(text); t != "" {
		res.Type = t
	}
	if m := finalScoreRe.FindStringSubmatch(text); m != nil {
		res.FinalScore = m[1] + "-" + m[2]
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
