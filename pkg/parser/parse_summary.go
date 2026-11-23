package parser

import (
	"fmt"
	"image"
	"regexp"
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
// on the right with result/score/date/mode/game-length). Each column — and
// each performance card within its column — is OCR'd from its own region so
// one's text can't leak into another's. Any OCR error fails the whole parse,
// so a half-read screenshot is never stored.
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

// readSummaryPerformance reads the Total Performance cards, mirroring their
// totals onto the flat E/A/D fields the dossier reads.
func readSummaryPerformance(img image.Image, work string, res *MatchResult) error {
	perf, totals, err := readPerfCards(img, work)
	if err != nil || perf == nil {
		return err
	}
	res.Performance = perf
	res.Eliminations = perf.Eliminations.Total
	res.Assists = perf.Assists.Total
	res.Deaths = perf.Deaths.Total
	for _, card := range totals {
		recordPerfTotal(img, res, card)
	}
	return nil
}

// perfCards are the Total Performance cards, top to bottom: the label each
// prints and the JSON field its total fills.
var perfCards = []struct{ label, field string }{
	{"ELIMINAT", "eliminations"},
	{"ASSIST", "assists"},
	{"DEATH", "deaths"},
}

// readPerfCards reads each card on its own and lists the cards whose total
// it read: a card read only for its average leaves its total the 0 nothing
// read, which names no region. It returns a nil Performance when no card
// showed a total or average above 0.
//
// A card is read only right of its icon. One pass over the whole column took
// the icons in, and the crossed-swords ELIMINATIONS icon's blade reads as a
// digit line of its own ("74", "4", "7") that nothing in the column's text
// tells apart from the total beside it.
func readPerfCards(img image.Image, work string) (*Performance, []int, error) {
	perf := &Performance{}
	stats := [...]*PerformanceStat{&perf.Eliminations, &perf.Assists, &perf.Deaths}
	var totals []int
	for card := range perfCards {
		stat, totalRead, err := readPerfCard(img, work, card)
		if err != nil {
			return nil, nil, err
		}
		*stats[card] = stat
		if totalRead {
			totals = append(totals, card)
		}
	}
	if *perf == (Performance{}) {
		return nil, nil, nil
	}
	return perf, totals, nil
}

// readPerfCard reads one card's column twice: a digits-only pass for the
// total, since the OW font's 1 reads as "T" on a plain pass, and a plain pass
// for the label and the average, which the digits-only pass runs into the
// "10" of "AVG PER 10 MIN". A card whose label was not read reads as
// nothing; totalRead reports the total was read.
func readPerfCard(img image.Image, work string, card int) (stat PerformanceStat, totalRead bool, err error) {
	column := perfCardColumn(img, card)
	name := "summary_perf_" + perfCards[card].field
	text, err := ocrInverted(img, column, ocrSpec{workDir: work, name: name, psm: "11"})
	if err != nil {
		return stat, false, err
	}
	digits, err := ocrInverted(img, column, ocrSpec{workDir: work, name: name + "_total", psm: "11", whitelist: "0123456789."})
	if err != nil || !strings.Contains(strings.ToUpper(text), perfCards[card].label) {
		return stat, false, err
	}
	stat, totalRead = parsePerfCard(digits, text)
	return stat, totalRead, nil
}

// recordPerfTotal records where a card prints its total, with what the digit
// templates read there. When the total cannot be found it falls back to the
// card's column, the region OCR read the card from.
func recordPerfTotal(img image.Image, res *MatchResult, card int) {
	field, column := ScalarPath(perfCards[card].field), perfCardColumn(img, card)
	box, ok := perfTotalBox(img, column)
	if !ok {
		res.recordEvidence(img, field, column)
		return
	}
	res.recordCrossChecked(img, field, box, numberTemplate(img, box))
}

// perfCardColumn is the column right of a performance card's icon. It stacks
// the total, the label and the per-10-minute average, and below them a NEW
// CAREER BEST badge when the card earned one. Cards sit at a fixed pitch,
// scaled from the 1440p layout.
func perfCardColumn(img image.Image, card int) image.Rectangle {
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	top := 324 + 321*card
	return image.Rect(w*1170/2560, h*top/1440, w*1500/2560, h*(top+312)/1440)
}

// perfTotalBox is a card's total inside its column: the total is set tallest,
// so it is the tallest band of ink there, cut to its ink.
func perfTotalBox(img image.Image, column image.Rectangle) (image.Rectangle, bool) {
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

// perfTotalRe is a card's total as a digits-only pass reads it, and
// perfAvgRe its average, anchored on "MIN" so the "10" of "AVG PER 10 MIN"
// is not taken for it.
var (
	perfTotalRe = regexp.MustCompile(`^\d{1,3}$`)
	perfAvgRe   = regexp.MustCompile(`(?i)MIN[^0-9]{1,8}(\d+(?:\.\d+)?)`)
)

// parsePerfCard reads a card's total from the first line its digits-only
// pass read and its average from its plain pass; totalRead reports the
// total carried digits. The total is set above everything else on the card, so the
// first line is it — the larger digits below it are the average run into
// the "10" of its label.
func parsePerfCard(digits, text string) (stat PerformanceStat, totalRead bool) {
	stat.Total, totalRead = firstDigitLine(digits)
	if m := perfAvgRe.FindStringSubmatch(text); m != nil {
		stat.AvgPer10Min, _ = strconv.ParseFloat(m[1], 64)
	}
	return stat, totalRead
}

// firstDigitLine is the first non-blank line of text when that line is a
// total; ok is false when it is anything else or text has no lines.
func firstDigitLine(text string) (n int, ok bool) {
	for line := range strings.Lines(text) {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if !perfTotalRe.MatchString(line) {
			return 0, false
		}
		n, err := strconv.Atoi(line)
		return n, err == nil
	}
	return 0, false
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
