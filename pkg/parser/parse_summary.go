package parser

import (
	"fmt"
	"image"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// isSummaryScreenshot detects the post-match SUMMARY tab by OCRing the upper-
// middle band and looking for labels that appear only on that screen. The
// TEAMS tab has the same top-of-page tab strip ("SUMMARY TEAMS
// PERSONAL") so we can't key on tab labels alone — "HEROES PLAYED" / "TOTAL
// PERFORMANCE" / "PERCENT PLAYED" are unique to the SUMMARY layout.
func isSummaryScreenshot(img image.Image, work string) (bool, error) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W/40, H/12, W*3/4, H*3/10)
	text, err := ocrInverted(img, rect, ocrSpec{workDir: work, name: "detect_summary", psm: "6", whitelist: ""})
	if err != nil {
		return false, err
	}
	upper := strings.ToUpper(text)
	return strings.Contains(upper, "HEROES PLAYED") ||
		strings.Contains(upper, "TOTAL PERFORMANCE") ||
		strings.Contains(upper, "PERCENT PLAYED"), nil
}

// parseSummary handles the post-match SUMMARY tab: three columns (Heroes
// Played cards on the left, Total Performance cards in the middle, a map card
// on the right with result/score/date/mode/game-length). Each column is OCR'd
// independently so a failure in one doesn't drop fields from the others.
//
// PSM 11 (sparse text) is used for the three column OCRs because each card
// mixes large italic / styled glyphs with smaller labels, separated by icons.
// PSM 6 (uniform block) tends to merge an icon into the digit next to it
// ("17" → "Oe au") or drop italic hero names entirely.
func parseSummary(img image.Image, work string) (*MatchResult, error) {
	res := &MatchResult{}
	if err := readSummaryHeroes(img, work, res); err != nil {
		return nil, fmt.Errorf("summary heroes OCR: %w", err)
	}
	if err := readSummaryPerformance(img, work, res); err != nil {
		return nil, fmt.Errorf("summary performance OCR: %w", err)
	}
	if err := readSummaryCard(img, work, res); err != nil {
		return nil, fmt.Errorf("summary card OCR: %w", err)
	}
	return res, nil
}

// readSummaryHeroes reads the Heroes Played column into heroes_played and the
// primary hero + role.
func readSummaryHeroes(img image.Image, work string, res *MatchResult) error {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W/40, H/8, W*30/100, H*92/100)
	text, err := ocrInverted(img, rect, ocrSpec{workDir: work, name: "summary_heroes", psm: "11", whitelist: ""})
	if err != nil {
		return err
	}
	res.HeroesPlayed = parseHeroesPlayed(text)
	if len(res.HeroesPlayed) > 0 {
		res.Hero = res.HeroesPlayed[0].Hero
		if r, ok := loadDataset().heroRoles[res.Hero]; ok {
			res.Role = r
		}
	} else if cand := candidateNameFromOCR(text); cand != "" {
		// Matcher rejected everything in the panel but OCR DID
		// return text — capture the longest hero-name-shaped token
		// as the "Unknown hero" raw so the leaf chip can surface
		// it and a future YAML release can re-aggregate.
		res.HeroRaw = cand
	}
	recordHeroCardEvidence(img, res, rect)
	return nil
}

// readSummaryPerformance reads the Total Performance column, mirroring its
// totals onto the flat E/A/D fields the dossier reads.
func readSummaryPerformance(img image.Image, work string, res *MatchResult) error {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W*30/100, H/8, W*62/100, H*92/100)
	text, err := ocrInverted(img, rect, ocrSpec{workDir: work, name: "summary_perf", psm: "11", whitelist: ""})
	if err != nil {
		return err
	}
	perf, readFields := parsePerformance(text)
	if perf == nil {
		return nil
	}
	res.Performance = perf
	res.Eliminations = perf.Eliminations.Total
	res.Assists = perf.Assists.Total
	res.Deaths = perf.Deaths.Total
	for _, field := range readFields {
		recordPerfTotal(img, res, field, rect)
	}
	return nil
}

// perfCardFields names the Total Performance cards, top to bottom, by the
// JSON field each one's total fills.
var perfCardFields = []string{"eliminations", "assists", "deaths"}

// recordPerfTotal records where field's card prints its total, with what the
// digit templates read there. When the total cannot be found it falls back to
// column, the region OCR read the whole performance column from.
func recordPerfTotal(img image.Image, res *MatchResult, field string, column image.Rectangle) {
	box, ok := perfTotalBox(img, slices.Index(perfCardFields, field))
	if !ok {
		res.recordEvidence(img, ScalarPath(field), column)
		return
	}
	res.recordCrossChecked(img, ScalarPath(field), box, numberTemplate(img, box))
}

// perfTotalBox is a performance card's total. The column right of the card's
// icon stacks the total, its label and the per-10-minute average, and the
// total is set tallest, so it is the tallest band of ink there, cut to its
// ink. Cards sit at a fixed pitch, scaled from the 1440p layout.
func perfTotalBox(img image.Image, card int) (image.Rectangle, bool) {
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	top := 324 + 321*card
	column := image.Rect(w*1170/2560, h*top/1440, w*1500/2560, h*(top+312)/1440)
	band, ok := newInkGrid(img, column).tallestBand()
	if !ok {
		return image.Rectangle{}, false
	}
	digits, _ := newInkGrid(img, band).inkBounds()
	return digits.Inset(-inkPad(img)).Intersect(column), true
}

// readSummaryCard reads the right-hand map card.
func readSummaryCard(img image.Image, work string, res *MatchResult) error {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	rect := image.Rect(W*62/100, H/12, W*99/100, H*95/100)
	text, err := ocrInverted(img, rect, ocrSpec{workDir: work, name: "summary_card", psm: "11", whitelist: ""})
	if err != nil {
		return err
	}
	parseRightCard(text, res)
	for _, f := range []struct {
		field string
		read  bool
	}{
		{"map", res.Map != "" || res.MapRaw != ""},
		{"result", res.Result != ""},
		{"final_score", res.FinalScore != ""},
		{"date", res.Date != ""},
		{"finished_at", res.FinishedAt != ""},
		{"game_length", res.GameLength != ""},
	} {
		if f.read {
			res.recordEvidence(img, ScalarPath(f.field), rect)
		}
	}
	return nil
}

// recordHeroCardEvidence notes rect as the source of the hero name (resolved
// or raw) and of each hero's percent played — the SUMMARY column and the
// PERSONAL hero card both read all of them from one region.
func recordHeroCardEvidence(img image.Image, res *MatchResult, rect image.Rectangle) {
	if res.Hero != "" || res.HeroRaw != "" {
		res.recordEvidence(img, ScalarPath("hero"), rect)
	}
	for _, hp := range res.HeroesPlayed {
		if hp.PercentPlayed > 0 {
			res.recordEvidence(img, HeroPercentPath(hp.Hero), rect)
		}
	}
}

// parseHeroesPlayed reads the heroes column block by block. Each hero shows
// NAME / XX% / MM:SS; the percent markers are the reliable anchor — digits OCR
// cleanly even when the italic name is mangled — so we split on them and
// fuzzy-resolve the hero name in the text leading up to each (bestHeroForName),
// instead of requiring an exact name match that silently drops a garbled hero
// ("BRIGITIE", "JUNG"). Heroes with no percent and no play time are empty card
// slots, skipped.
func parseHeroesPlayed(text string) []HeroPlay {
	pctRe := regexp.MustCompile(`(\d{1,3})\s*%`)
	timeRe := regexp.MustCompile(`\d{1,2}:\d{2}`)
	marks := pctRe.FindAllStringSubmatchIndex(text, -1)

	var out []HeroPlay
	seen := map[string]bool{}
	nameStart := 0
	for k, m := range marks {
		hero := bestHeroForName(text[nameStart:m[0]])
		nameStart = m[1] // next block's name region starts after this percent
		pct, _ := strconv.Atoi(text[m[2]:m[3]])
		timeEnd := len(text)
		if k+1 < len(marks) {
			timeEnd = marks[k+1][0]
		}
		playTime := timeRe.FindString(text[m[1]:timeEnd])
		if hero == "" || seen[hero] || (pct == 0 && playTime == "") {
			continue
		}
		seen[hero] = true
		out = append(out, HeroPlay{Hero: hero, PercentPlayed: pct, PlayTime: playTime})
	}
	return out
}

// parsePerformance pulls (total, avg-per-10-min) for each labeled card, and
// names (by JSON field) the stats whose label carried digits — a 0 read off the
// card counts, a label with no digits beside it does not.
// The total is the largest "digit line" in the per-stat segment — a line whose
// whole content is a 1-3 digit number, allowing the glyphs the OW italic
// numerals get mis-OCR'd into (O/o/Q/q→0; I/i/l/L and the vertical-stroke
// brackets |/]/[ →1, normalized by normalizePerfDigits). This filters icon
// noise like "S 4" (the skull-X / crossed-swords misread) while still
// recovering a value the font mangled — e.g. "11" scanned as "1]", which the
// old pure-digit pick dropped in favor of the icon's stray "4". The avg is
// anchored on "MIN" so we don't match "10" inside "AVG PER 10 MIN".
var (
	perfDigitLineRe = regexp.MustCompile(`(?m)^\s*([\dOoQqIilL|\]\[]{1,3})\s*$`)
	perfAvgRe       = regexp.MustCompile(`(?i)MIN[^0-9]{1,8}(\d+(?:\.\d+)?)`)
)

// perfDigitReplacer maps the OW font's mis-OCR'd numeral glyphs back to digits.
// Applied only to perfDigitLineRe matches (already all digit-like), so the
// bracket→1 substitutions can't corrupt real text elsewhere.
var perfDigitReplacer = strings.NewReplacer(
	"O", "0", "o", "0", "Q", "0", "q", "0",
	"I", "1", "i", "1", "l", "1", "L", "1",
	"|", "1", "]", "1", "[", "1",
)

func normalizePerfDigits(s string) string { return perfDigitReplacer.Replace(s) }

func parsePerformance(text string) (*Performance, []string) {
	upper := strings.ToUpper(text)
	perf := &Performance{}
	found := false
	var readFields []string
	pairs := []struct {
		keyword, field string
		stat           *PerformanceStat
	}{
		{"ELIMINAT", "eliminations", &perf.Eliminations},
		{"ASSIST", "assists", &perf.Assists},
		{"DEATH", "deaths", &perf.Deaths},
	}
	prevEnd := 0
	for _, p := range pairs {
		idx := strings.Index(upper, p.keyword)
		if idx < 0 {
			continue
		}
		start := prevEnd
		if start > idx {
			start = 0
		}
		stat, read := readPerfStat(text, start, idx)
		*p.stat = stat
		prevEnd = idx + len(p.keyword)
		if read {
			readFields = append(readFields, p.field)
		}
		if stat.Total != 0 || stat.AvgPer10Min != 0 {
			found = true
		}
	}
	if !found {
		return nil, nil
	}
	return perf, readFields
}

// readPerfStat reads the stat whose label starts at idx; read reports whether
// either its total or its average carried digits.
//
// Total: the largest digit line in text[start:idx], the segment between the
// previous stat's label and this one. Segmenting isolates this stat's digits
// (so the assists "19" can't shadow deaths "6"), and taking the max rejects
// the small icon glyph Tesseract reads as a stray digit beside the value — the
// crossed-swords ELIMINATIONS icon reads as "4" right before the label, which
// the old "last line before the label" pick wrongly grabbed over the real "9".
//
// Avg: first decimal-or-int after "MIN" within ~120 chars of the label.
func readPerfStat(text string, start, idx int) (stat PerformanceStat, read bool) {
	if best := largestDigitLine(text[start:idx]); best >= 0 {
		stat.Total, read = best, true
	}
	to := min(idx+120, len(text))
	if m := perfAvgRe.FindStringSubmatch(text[idx:to]); m != nil {
		stat.AvgPer10Min, _ = strconv.ParseFloat(m[1], 64)
		read = true
	}
	return stat, read
}

// largestDigitLine returns the largest normalized digit-line value in seg, or
// -1 when seg has none.
func largestDigitLine(seg string) int {
	best := -1
	for _, m := range perfDigitLineRe.FindAllStringSubmatch(seg, -1) {
		if n, err := strconv.Atoi(normalizePerfDigits(m[1])); err == nil && n > best {
			best = n
		}
	}
	return best
}

// scoreDigit accepts digits plus the letters Tesseract commonly substitutes
// for them on the OW banner font: O/Q for 0, l/I for 1. The match groups are
// passed through digitize() before being used as a final score.
var (
	finalScoreRe = regexp.MustCompile(`(?i)FINAL\s*SCORE[^\dOoQqIlL]*([\dOoQqIlL]+)[^\dOoQqIlL]*([\dOoQqIlL]+)`)
	dateRe       = regexp.MustCompile(`(?i)DATE[^0-9]{0,8}(\d{1,2}/\d{1,2}/\d{2,4})(?:[^0-9]{1,8}(\d{1,2}:\d{2}))?`)
	gameLenRe    = regexp.MustCompile(`(?i)GAME\s*LENGTH[^0-9]{0,8}(\d{1,2}:\d{2})`)
)

// detectResult classifies win/loss/draw from OCR text by prefix match (e.g.
// "DEFE", "VICTOR") rather than full-word equality so OCR slips like "DEFERT"
// still classify. Shared by the SUMMARY right card and the rank screen's
// banner. Returns "" when no result token is present.
func detectResult(text string) string {
	upper := strings.ToUpper(text)
	switch {
	case strings.Contains(upper, "VICTOR"):
		return "victory"
	case strings.Contains(upper, "DEFE"):
		return "defeat"
	case strings.Contains(upper, "DRAW") || strings.Contains(upper, "DRAU"):
		return "draw"
	}
	return ""
}

// rightCardFields is the regex→field ladder parseRightCard walks: each entry
// runs its regex once and, on a match, assigns the captured groups to the
// MatchResult field(s) it owns.
var rightCardFields = []struct {
	re     *regexp.Regexp
	assign func(m []string, res *MatchResult)
}{
	{finalScoreRe, func(m []string, res *MatchResult) {
		res.FinalScore = digitize(m[1]) + "-" + digitize(m[2])
	}},
	{dateRe, func(m []string, res *MatchResult) {
		res.Date = normalizeDate(m[1])
		if len(m) > 2 && m[2] != "" {
			res.FinishedAt = m[2]
		}
	}},
	{gameLenRe, func(m []string, res *MatchResult) {
		res.GameLength = m[1]
	}},
}

// parseRightCard extracts the map card's fields from one OCR pass: map name,
// result (victory/defeat/draw), final score, date, finish time, game type, and
// game length.
func parseRightCard(text string, res *MatchResult) {
	if r := detectResult(text); r != "" {
		res.Result = r
	}
	if m := bestKnownMapInText(text); m != "" {
		res.Map = m
	} else if cand := candidateNameFromOCR(text); cand != "" {
		// No canonical map matched but OCR has alphabetic content
		// in the right-card region — capture as MapRaw for the
		// "Unknown map (newmap?)" UI. Sibling rationale to HeroRaw
		// above.
		res.MapRaw = cand
	}
	if t := extractGameMode(text); t != "" {
		res.GameMode = t
	}
	for _, f := range rightCardFields {
		if m := f.re.FindStringSubmatch(text); m != nil {
			f.assign(m, res)
		}
	}
}
