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
	Map          string   `json:"map"`
	Role         string   `json:"role"`
	Eliminations int      `json:"eliminations"`
	Assists      int      `json:"assists"`
	Deaths       int      `json:"deaths"`
	Damage       int      `json:"damage"`
	Healing      int      `json:"healing"`
	Mitigation   int      `json:"mitigation"`
	Characters   []string `json:"characters"`
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

	headerText, err := ocrInverted(img, image.Rect(0, H/100, W*5/8, H*5/96), work, "header", "6", "")
	if err != nil {
		return nil, fmt.Errorf("header OCR: %w", err)
	}
	stats, err := ocrRowCells(img, yTop, yBot, work)
	if err != nil {
		return nil, fmt.Errorf("row OCR: %w", err)
	}
	// Panel: use raw colour (Tesseract handles the cyan labels best without our
	// custom thresholding). Forces uppercase letters + digits to keep the result
	// tidy and improve OCR confidence.
	panelText, err := ocrRaw(img, image.Rect(W*5/8, H/8, W, H*5/6), work, "panel", "6",
		"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ %")
	if err != nil {
		return nil, fmt.Errorf("panel OCR: %w", err)
	}

	res := &MatchResult{}
	res.Map = extractMap(headerText)
	res.Eliminations, res.Assists, res.Deaths = stats[0], stats[1], stats[2]
	res.Damage, res.Healing, res.Mitigation = stats[3], stats[4], stats[5]
	res.Characters = extractHeroes(panelText)
	if len(res.Characters) > 0 {
		if r, ok := heroRoles[res.Characters[0]]; ok {
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

// findHighlightedRowY locates the contiguous Y range whose horizontal slice
// through the table matches the highlighted (lighter blue) row colour.
func findHighlightedRowY(img image.Image) (int, int) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()

	xMin, xMax := W*23/64, W*9/16
	scores := make([]int, H)
	for y := 0; y < H; y++ {
		count := 0
		for x := xMin; x < xMax; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			if isHighlightBlue(uint8(r>>8), uint8(g>>8), uint8(b>>8)) {
				count++
			}
		}
		scores[y] = count
	}

	threshold := (xMax - xMin) * 1 / 3
	bestStart, bestEnd := -1, -1
	runStart, runEnd := -1, -1
	for y := 0; y < H; y++ {
		if scores[y] >= threshold {
			if runStart == -1 {
				runStart = y
			}
			runEnd = y
		} else if runStart != -1 {
			if runEnd-runStart > bestEnd-bestStart {
				bestStart, bestEnd = runStart, runEnd
			}
			runStart, runEnd = -1, -1
		}
	}
	if runStart != -1 && runEnd-runStart > bestEnd-bestStart {
		bestStart, bestEnd = runStart, runEnd
	}
	return bestStart, bestEnd
}

func isHighlightBlue(r, g, b uint8) bool {
	return r < 160 &&
		g > 105 && g < 210 &&
		b > 130 && b < 230 &&
		int(b) > int(g)+3 &&
		int(g) > int(r)+30
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

// ocrRowCells crops each of the 6 stat columns of the highlighted row and OCRs
// each one with a digit whitelist. Per-cell OCR is more reliable than parsing
// one wide line: a missed cell only loses one stat, not all six.
func ocrRowCells(img image.Image, yTop, yBot int, workDir string) ([6]int, error) {
	bounds := img.Bounds()
	W := bounds.Dx()
	cells := []struct {
		name   string
		cx, hw float64
	}{
		{"col_e", 0.378, 0.018},
		{"col_a", 0.408, 0.014},
		{"col_d", 0.438, 0.016},
		{"col_dmg", 0.483, 0.040},
		{"col_h", 0.527, 0.024},
		{"col_mit", 0.575, 0.034},
	}
	pad := (yBot - yTop) / 6
	yT, yB := yTop+pad, yBot-pad

	var out [6]int
	for i, c := range cells {
		x0 := int((c.cx - c.hw) * float64(W))
		x1 := int((c.cx + c.hw) * float64(W))
		rect := image.Rect(x0, yT, x1, yB)
		// Try PSM 7 (single line) first; fall back to PSM 10 (single character)
		// for cells that come back empty — Tesseract sometimes refuses lone
		// digits in line mode.
		var nums []int
		attempts := []struct{ psm, whitelist string }{
			{"7", "0123456789,"},
			{"10", "0123456789,"},
			{"10", ""},
			{"8", ""},
		}
		for _, a := range attempts {
			text, err := ocrInverted(img, rect, workDir, c.name, a.psm, a.whitelist)
			if err != nil {
				return out, fmt.Errorf("%s: %w", c.name, err)
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

func extractMap(text string) string {
	if i := strings.LastIndex(text, "|"); i >= 0 && i < len(text)-1 {
		return strings.ToLower(strings.TrimSpace(text[i+1:]))
	}
	re := regexp.MustCompile(`(?i)([A-Z][A-Za-z' ]+:\s*[A-Z][A-Za-z' ]+)`)
	if m := re.FindString(text); m != "" {
		return strings.ToLower(strings.TrimSpace(m))
	}
	return strings.ToLower(strings.TrimSpace(text))
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

func extractHeroes(text string) []string {
	upper := strings.ToUpper(text)
	seen := map[string]bool{}
	var found []string
	for _, hero := range heroNamesByLength() {
		if seen[hero] {
			continue
		}
		if strings.Contains(upper, strings.ToUpper(hero)) {
			seen[hero] = true
			found = append(found, hero)
		}
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
