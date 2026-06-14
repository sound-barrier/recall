package parser

import (
	"fmt"
	"image"
	"math"
	"regexp"
	"strconv"
	"strings"
)

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
				continue
			}
			// Stats with no hero card is a parse failure on the hero-info
			// cell — skip rather than dropping the stat into a nameless
			// bucket. The hero card (r0c0) is parsed first, so its play time
			// is available here to AVG-anchor each stat value.
			if len(res.HeroesPlayed) == 0 {
				continue
			}
			playMin := playTimeMinutes(res.HeroesPlayed[0].PlayTime)
			if key, val, ok := parsePersonalStatCell(cellText, playMin); ok {
				if res.HeroesPlayed[0].Stats == nil {
					res.HeroesPlayed[0].Stats = map[string]int{}
				}
				res.HeroesPlayed[0].Stats[SnapHeroStatKey(res.Hero, key)] = val
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
		if r, ok := loadDataset().heroRoles[res.Hero]; ok {
			res.Role = r
		}
	} else if cand := candidateNameFromOCR(text); cand != "" {
		// Matcher rejected the cell but OCR found a hero-name-shaped
		// token — capture it for the "Unknown hero" UI.
		res.HeroRaw = cand
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
	personalPctRe = regexp.MustCompile(`(\d{1,4})\s*%`)
	// Match a whole comma-grouped number ("1,367") as one token. The old
	// `\d{1,4}` split on the comma, so the longest-run pick in Pass 2 kept
	// "367" and dropped the leading group.
	personalIntRe   = regexp.MustCompile(`\d+(?:,\d+)*`)
	personalLabelRe = regexp.MustCompile(`[A-Z][A-Z\s]{4,}[A-Z]`)
)

func parsePersonalStatCell(text string, playMinutes float64) (string, int, bool) {
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
	// Pass 2: the integer value. A hero-ability icon OCRs as a spurious
	// single digit whose position relative to the real value varies —
	// leading for some stats, trailing for others — so first/last picks are
	// unreliable. Anchor on the cell's "AVG PER 10 MIN" line instead: a real
	// value ≈ avg × playMinutes/10, which cleanly separates the true digit
	// from icon noise.
	if val < 0 {
		expected := -1.0
		if m := perfAvgRe.FindStringSubmatch(text); m != nil && playMinutes > 0 {
			if avg, err := strconv.ParseFloat(m[1], 64); err == nil {
				expected = avg * playMinutes / 10
			}
		}
		val = pickStatValue(text, expected)
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

// pickStatValue chooses the stat's integer from the cell OCR. The longest
// digit run wins on length (a clean "1,177" beats single-digit icon noise);
// among equal-longest candidates it prefers the one closest to `expected`
// (avg × play/10) when known, else the value seen in the most OCR passes,
// else the first. Returns -1 when the cell has no integer.
func pickStatValue(text string, expected float64) int {
	bestLen := 0
	counts := map[int]int{}
	var order []int
	for _, line := range strings.Split(text, "\n") {
		if strings.Contains(strings.ToUpper(line), "AVG") {
			continue
		}
		for _, m := range personalIntRe.FindAllString(line, -1) {
			digits := strings.ReplaceAll(m, ",", "")
			if len(digits) < bestLen {
				continue
			}
			v, _ := strconv.Atoi(digits)
			if len(digits) > bestLen {
				bestLen, counts, order = len(digits), map[int]int{}, order[:0]
			}
			if counts[v] == 0 {
				order = append(order, v)
			}
			counts[v]++
		}
	}
	if len(order) == 0 {
		return -1
	}
	best := order[0]
	for _, v := range order[1:] {
		if statValueBetter(v, best, counts, expected) {
			best = v
		}
	}
	return best
}

// statValueBetter reports whether candidate v should displace cur: closer to
// the avg-derived expectation when one is known, otherwise more frequent
// across the OCR passes.
func statValueBetter(v, cur int, counts map[int]int, expected float64) bool {
	if expected >= 0 {
		dv, dc := math.Abs(float64(v)-expected), math.Abs(float64(cur)-expected)
		if dv != dc {
			return dv < dc
		}
	}
	return counts[v] > counts[cur]
}

// playTimeMinutes converts a "MM:SS" play-time string to fractional minutes;
// 0 when unparseable (the caller then skips the AVG anchor).
func playTimeMinutes(mmss string) float64 {
	parts := strings.SplitN(mmss, ":", 2)
	if len(parts) != 2 {
		return 0
	}
	m, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	s, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil {
		return 0
	}
	return float64(m) + float64(s)/60
}
