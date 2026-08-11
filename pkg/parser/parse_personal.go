package parser

import (
	"cmp"
	"fmt"
	"image"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// isPersonalScreenshot detects the post-match PERSONAL tab. The left sidebar
// has a per-hero filter button list followed by an "ALL HEROES" entry —
// neither appears on SUMMARY or TEAMS. The "ALL HEROES" button's vertical
// position shifts down as more heroes get played in a match (single-hero
// match: ~Y=20%; 3-hero match: ~Y=40%; many-hero match: even lower), so we
// OCR the full vertical extent of the sidebar rather than just the top.
func isPersonalScreenshot(img image.Image, work string) (bool, error) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(0, H*15/100, W*12/100, H*85/100)
	text, err := ocrInverted(img, rect, ocrSpec{workDir: work, name: "detect_personal", psm: "11", whitelist: ""})
	if err != nil {
		return false, err
	}
	return strings.Contains(strings.ToUpper(text), "ALL HEROES"), nil
}

// parsePersonal handles the PERSONAL tab: a 3×3 grid where the top-left cell
// is a hero-info card (name / % played / play time) and the other eight are
// hero-specific stat cards (a value, a label, optionally an avg-per-10-min).
// Cards are OCR'd individually because PSM 11 on the whole grid interleaves
// the columns and makes value-label pairing unreliable. Cell labels are kept
// open-ended (snake_case map keys) so we don't need a per-hero allowlist.
// The always-nil error is part of the shared parse-func shape the
// screenshotProbes dispatch table requires.
func parsePersonal(img image.Image, work string) (*MatchResult, error) {
	res := &MatchResult{}
	parsePersonalGrid(img, work, res)
	appendSidebarHeroes(img, work, res)
	return res, nil
}

// parsePersonalGrid OCRs the 3×3 stat grid cell by cell: the hero-info card
// at r0c0 first, then each stat card. X boundaries calibrated against the
// actual card positions at 2560×1440 by scanning for the dark card background
// between the sidebar and the right edge: cards run roughly X=20.5%..96.5% of
// W, not X=11%..99% (that earlier guess put cell 0 mostly inside the
// sidebar). 7px inter-card gaps are absorbed by the integer cell math.
func parsePersonalGrid(img image.Image, work string, res *MatchResult) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	gridLeft := W * 20 / 100
	gridRight := W * 97 / 100
	gridTop := H * 16 / 100
	gridBot := H * 95 / 100
	cellW := (gridRight - gridLeft) / 3
	cellH := (gridBot - gridTop) / 3

	for row := range 3 {
		for col := range 3 {
			name := fmt.Sprintf("personal_r%dc%d", row, col)
			fullRect := image.Rect(
				gridLeft+col*cellW, gridTop+row*cellH,
				gridLeft+(col+1)*cellW, gridTop+(row+1)*cellH,
			)
			stripRect := image.Rect(
				gridLeft+col*cellW+cellW*30/100, gridTop+row*cellH,
				gridLeft+(col+1)*cellW, gridTop+(row+1)*cellH,
			)
			statCell := row != 0 || col != 0
			cellText, err := ocrPersonalCell(img, work, name, fullRect, stripRect, statCell)
			// One unreadable cell is survivable — the other eight cards
			// still land — but the loss is recorded so the app can put the
			// file in the failed-files ledger instead of counting it clean.
			if err != nil {
				res.warnf("%s: OCR failed: %v", name, err)
			}
			if !statCell {
				parsePersonalHeroCell(cellText, res)
				continue
			}
			recordPersonalStat(cellText, res)
		}
	}
}

// ocrPersonalCell OCRs one grid cell. Primary pass: full cell, dual-PSM —
// PSM 11 (sparse) gets large values cleanly; PSM 6 (uniform block) catches
// what 11 drops.
//
// Stat cells also OCR with the left 30% (tick + icon) cropped out. The icon
// often gets misread as a lowercase letter run glued to the first word of the
// label (Juno's orbital-ring icon → "orn" before "BITAL RAY ASSISTS").
// Stripping it produces a clean label that the regex picks over the
// glued-prefix version on length. We keep the full-cell text too because the
// strip sometimes loses the value (a lone "1" digit next to the icon edge).
//
// A failing pass costs the cell its share of the text but never aborts the
// grid walk, so whatever the other passes read still lands. The first pass
// error comes back with the text — all three passes read the same region, so
// one cause names the whole cell's loss — and the caller records it as a
// non-fatal warning rather than discarding it.
func ocrPersonalCell(img image.Image, work, name string, full, strip image.Rectangle, statCell bool) (string, error) {
	text11, err11 := ocrInverted(img, full, ocrSpec{workDir: work, name: name, psm: "11", whitelist: ""})
	text6, err6 := ocrInverted(img, full, ocrSpec{workDir: work, name: name + "_b", psm: "6", whitelist: ""})
	cellText := text11 + "\n" + text6
	if !statCell {
		return cellText, cmp.Or(err11, err6)
	}
	strip11, errStrip := ocrInverted(img, strip, ocrSpec{workDir: work, name: name + "_s", psm: "11", whitelist: ""})
	return cellText + "\n" + strip11, cmp.Or(err11, err6, errStrip)
}

// recordPersonalStat parses one stat card's OCR text and files the (key,
// value) under the selected hero. Stats with no hero card is a parse failure
// on the hero-info cell — skip rather than dropping the stat into a nameless
// bucket. The hero card (r0c0) is parsed first, so its play time is available
// here to AVG-anchor each stat value.
func recordPersonalStat(cellText string, res *MatchResult) {
	if len(res.HeroesPlayed) == 0 {
		return
	}
	playMin := playTimeMinutes(res.HeroesPlayed[0].PlayTime)
	key, val, ok := parsePersonalStatCell(cellText, playMin)
	if !ok {
		return
	}
	if res.HeroesPlayed[0].Stats == nil {
		res.HeroesPlayed[0].Stats = map[string]int{}
	}
	res.HeroesPlayed[0].Stats[SnapHeroStatKey(res.Hero, key)] = val
}

// appendSidebarHeroes reads the left sidebar, which lists every hero played
// (the per-hero filter buttons above "ALL HEROES"). Only the SELECTED hero's
// stats are on screen, but capturing the full roster lets one PERSONAL
// capture correlate by hero-set with the SUMMARY. Append the heroes the
// selected-hero card didn't already carry; they have a name but no per-hero
// stats.
func appendSidebarHeroes(img image.Image, work string, res *MatchResult) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	sidebarText, err := ocrInverted(img, image.Rect(0, H*15/100, W*12/100, H*85/100), ocrSpec{workDir: work, name: "personal_sidebar", psm: "11"})
	if err != nil {
		res.warnf("personal_sidebar: OCR failed: %v", err)
	}
	seen := map[string]bool{}
	for _, hp := range res.HeroesPlayed {
		seen[hp.Hero] = true
	}
	// Keep the sidebar's play order (most-played first); extractHeroes
	// returns roster order, so sort by first appearance in the OCR text.
	roster := extractHeroes(sidebarText)
	lowerSidebar := strings.ToLower(sidebarText)
	sort.SliceStable(roster, func(i, j int) bool {
		return strings.Index(lowerSidebar, roster[i]) < strings.Index(lowerSidebar, roster[j])
	})
	for _, h := range roster {
		if !seen[h] {
			res.HeroesPlayed = append(res.HeroesPlayed, HeroPlay{Hero: h})
			seen[h] = true
		}
	}
}

// parsePersonalHeroCell parses the top-left hero info card (hero name, %
// played, play time) into res.Hero, res.Role, and one HeroPlay entry. Keeps
// the same shape as the SUMMARY tab's heroes_played so a merge by filename
// timestamp can fold both into the same record.
//
// A named hero whose % and play time BOTH failed to read still gets its
// entry, untimed: the eight stat cards on screen belong to it, and dropping
// them (which is what an entry-less hero card does — recordPersonalStat has
// nowhere to file them) is silent data loss. The missing timing is recorded
// as a non-fatal warning instead.
func parsePersonalHeroCell(text string, res *MatchResult) {
	resolveHeroCardName(text, res)
	if res.Hero == "" {
		return
	}
	percentPlayed, playTime := heroCardPlaySplit(text)
	res.HeroesPlayed = append(res.HeroesPlayed, HeroPlay{
		Hero:          res.Hero,
		PercentPlayed: percentPlayed,
		PlayTime:      playTime,
	})
	if percentPlayed == 0 && playTime == "" {
		res.warnf("hero card: %s read without percent played or play time; its stats are recorded untimed", res.Hero)
	}
}

// resolveHeroCardName pins the hero card's name to the roster, setting
// res.Hero + res.Role. When the matcher rejects the cell but OCR found a
// hero-name-shaped token, the raw text is kept for the "Unknown hero" UI.
func resolveHeroCardName(text string, res *MatchResult) {
	if heroes := extractHeroes(text); len(heroes) > 0 {
		res.Hero = heroes[0]
		if r, ok := loadDataset().heroRoles[res.Hero]; ok {
			res.Role = r
		}
		return
	}
	if cand := candidateNameFromOCR(text); cand != "" {
		res.HeroRaw = cand
	}
}

var (
	heroCardPercentRe  = regexp.MustCompile(`(\d{1,3})\s*%`)
	heroCardPlayTimeRe = regexp.MustCompile(`(\d{1,2}:\d{2})`)
)

// heroCardPlaySplit reads the hero card's share of the match: percent played
// and MM:SS play time. Zero / empty when the OCR lost them — both sit against
// the card's icon, which is where Tesseract drops digits first.
func heroCardPlaySplit(text string) (percentPlayed int, playTime string) {
	if m := heroCardPercentRe.FindStringSubmatch(text); m != nil {
		percentPlayed, _ = strconv.Atoi(m[1])
	}
	if m := heroCardPlayTimeRe.FindStringSubmatch(text); m != nil {
		playTime = m[1]
	}
	return percentPlayed, playTime
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
	val := personalStatValue(text, playMinutes)
	if val < 0 {
		return "", 0, false
	}
	label := personalStatLabel(text)
	if label == "" {
		return "", 0, false
	}
	return labelToKey(label), val, true
}

// personalStatValue picks the stat card's numeric value, or -1 when the cell
// has none.
func personalStatValue(text string, playMinutes float64) int {
	// Pass 1: prefer a %-suffixed digit. Percent stats always have a %, and
	// the % is a strong disambiguator against icon-misread digits like "a7?".
	for line := range strings.SplitSeq(text, "\n") {
		if strings.Contains(strings.ToUpper(line), "AVG") {
			continue
		}
		if m := personalPctRe.FindStringSubmatch(line); m != nil {
			val, _ := strconv.Atoi(m[1])
			return val
		}
	}
	// Pass 2: the integer value. A hero-ability icon OCRs as a spurious
	// single digit whose position relative to the real value varies —
	// leading for some stats, trailing for others — so first/last picks are
	// unreliable. Anchor on the cell's "AVG PER 10 MIN" line instead: a real
	// value ≈ avg × playMinutes/10, which cleanly separates the true digit
	// from icon noise.
	expected := -1.0
	if m := perfAvgRe.FindStringSubmatch(text); m != nil && playMinutes > 0 {
		if avg, err := strconv.ParseFloat(m[1], 64); err == nil {
			expected = avg * playMinutes / 10
		}
	}
	val := pickStatValue(text, expected)
	// Last resort: a small value (0/1) sitting next to the card icon often
	// OCRs as a letter ("0"→"O", "1"→"T"), leaving no digit for
	// pickStatValue. When the cell still has a clean AVG line, recover the
	// value from it — value = avg × play/10, rounded — rather than dropping
	// the whole stat cell. The label is read fine; only the lone digit isn't.
	if val < 0 && expected >= 0 {
		return int(math.Round(expected))
	}
	return val
}

// personalStatLabel picks the stat card's label: the longest uppercase phrase
// across all OCR passes, icon-noise trimmed. "" when no plausible label.
func personalStatLabel(text string) string {
	var label string
	for line := range strings.SplitSeq(text, "\n") {
		upper := strings.ToUpper(line)
		// Skip the AVG line and the green "NEW CAREER BEST!" badge. The badge
		// is a long uppercase phrase that otherwise outscores the real stat
		// label in the longest-wins pick — it's the reason trimShortBoundaryWords
		// had to clip 3-char prefixes (its "NEW"), which also clipped legit ones
		// (OBJ CONTEST TIME, RIP-TIRE KILL). Dropping it here lets that trim keep
		// 3-char words. No stat label contains "CAREER".
		if strings.Contains(upper, "AVG") || strings.Contains(upper, "CAREER") {
			continue
		}
		for _, m := range personalLabelRe.FindAllString(line, -1) {
			m = trimShortBoundaryWords(strings.TrimSpace(m))
			if len(m) > len(label) {
				label = m
			}
		}
	}
	return label
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
	for line := range strings.SplitSeq(text, "\n") {
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
