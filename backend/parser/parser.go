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
	Competitive  bool   `json:"competitive"`
	Role         string `json:"role"`
	Hero         string `json:"hero"`
	Eliminations int    `json:"eliminations"`
	Assists      int    `json:"assists"`
	Deaths       int    `json:"deaths"`
	Damage       int    `json:"damage"`
	Healing      int    `json:"healing"`
	Mitigation   int    `json:"mitigation"`
}

// knownMaps is the OW2 map list, used to fix Tesseract misreads on map names
// by snapping the OCR result to the closest match.
var knownMaps = []string{
	"antarctic peninsula", "blizzard world", "busan", "circuit royal",
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

	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()

	yTop, yBot := findHighlightedRowY(img)
	if yTop < 0 {
		return nil, errors.New("could not locate the highlighted (lighter blue) row in the scoreboard")
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
	res.Map, res.Type, res.Competitive = extractHeader(headerText)
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
func extractHeader(text string) (mapName, gameType string, competitive bool) {
	upper := strings.ToUpper(text)

	// Competitive: "MPETIT" is the most distinctive substring; falls back to
	// any of the partial signatures Tesseract tends to leave intact.
	for _, sig := range []string{"MPETIT", "ETITIV", "OMPETI"} {
		if strings.Contains(upper, sig) {
			competitive = true
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

	// Type: fuzzy match on each known mode. Each pattern allows the common
	// I/L/1 and O/0 substitutions Tesseract produces on the OW2 banner font.
	typePatterns := []struct {
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
	for _, p := range typePatterns {
		if p.re.MatchString(upper) {
			gameType = p.name
			break
		}
	}
	return
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
