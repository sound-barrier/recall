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
	FinalBlows   int      `json:"final_blows"`
	SoloKills    int      `json:"solo_kills"`
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

	tmp, err := os.MkdirTemp("", "owmetrics-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)

	headerText, err := ocrRegion(img, image.Rect(0, 0, W*5/8, H/12), tmp, "header")
	if err != nil {
		return nil, fmt.Errorf("header OCR: %w", err)
	}
	rowText, err := ocrRegion(img, image.Rect(W*23/64, yTop, W*5/8, yBot), tmp, "row")
	if err != nil {
		return nil, fmt.Errorf("row OCR: %w", err)
	}
	panelText, err := ocrRegion(img, image.Rect(W*5/8, H/8, W, H*5/6), tmp, "panel")
	if err != nil {
		return nil, fmt.Errorf("panel OCR: %w", err)
	}

	res := &MatchResult{}
	res.Map = extractMap(headerText)
	res.Eliminations, res.Assists, res.Deaths, res.Damage, res.Healing, res.Mitigation = extractRowStats(rowText)
	res.Characters = extractHeroes(panelText)
	res.FinalBlows = extractIntBeforeLabel(panelText, "FINAL BLOW")
	res.SoloKills = extractIntBeforeLabel(panelText, "SOLO KILLS")
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

// isHighlightBlue matches the lighter blue of the highlighted row. The
// non-highlighted rows have G < ~105 in the table area, so the green channel
// is the cleanest discriminator.
func isHighlightBlue(r, g, b uint8) bool {
	return r < 160 &&
		g > 105 && g < 210 &&
		b > 130 && b < 230 &&
		int(b) > int(g)+3 &&
		int(g) > int(r)+30
}

func ocrRegion(img image.Image, rect image.Rectangle, tmpDir, name string) (string, error) {
	sub := crop(img, rect)
	pre := preprocessForOCR(sub)

	inPath := filepath.Join(tmpDir, name+".png")
	f, err := os.Create(inPath)
	if err != nil {
		return "", err
	}
	if err := png.Encode(f, pre); err != nil {
		f.Close()
		return "", err
	}
	f.Close()

	var stdout, stderr bytes.Buffer
	cmd := exec.Command("tesseract", inPath, "-", "--psm", "6")
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("tesseract failed: %w (%s)", err, stderr.String())
	}
	return stdout.String(), nil
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

// preprocessForOCR thresholds bright pixels to black-on-white and 2x upscales.
// White game-text on coloured/dark backgrounds becomes high-contrast black text
// on a clean white page, which Tesseract is optimised for.
func preprocessForOCR(src image.Image) image.Image {
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	const scale = 2
	out := image.NewGray(image.Rect(0, 0, w*scale, h*scale))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, _ := src.At(x, y).RGBA()
			r8, g8, b8 := r>>8, g>>8, b>>8
			lum := (299*r8 + 587*g8 + 114*b8) / 1000
			maxC := r8
			if g8 > maxC {
				maxC = g8
			}
			if b8 > maxC {
				maxC = b8
			}
			var v uint8 = 255
			// White text or bright saturated text -> black
			if lum > 200 || maxC > 230 {
				v = 0
			}
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

func extractRowStats(text string) (e, a, d, dmg, h, mit int) {
	nums := extractInts(text)
	if len(nums) >= 6 {
		ns := nums[len(nums)-6:]
		return ns[0], ns[1], ns[2], ns[3], ns[4], ns[5]
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

func extractIntBeforeLabel(text, label string) int {
	upper := strings.ToUpper(text)
	idx := strings.Index(upper, label)
	if idx < 0 {
		return 0
	}
	nums := extractInts(text[:idx])
	if len(nums) == 0 {
		return 0
	}
	return nums[len(nums)-1]
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
