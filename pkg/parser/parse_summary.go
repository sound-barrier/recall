package parser

import (
	"fmt"
	"image"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

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
	} else if cand := candidateNameFromOCR(heroesText); cand != "" {
		// Matcher rejected everything in the panel but OCR DID
		// return text — capture the longest hero-name-shaped token
		// as the "Unknown hero" raw so the leaf chip can surface
		// it and a future YAML release can re-aggregate.
		res.HeroRaw = cand
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

// parsePerformance pulls (total, avg-per-10-min) for each labeled card.
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
// for them on the OW banner font: O/Q for 0, l/I for 1. The match groups are
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
	} else if cand := candidateNameFromOCR(text); cand != "" {
		// No canonical map matched but OCR has alphabetic content
		// in the right-card region — capture as MapRaw for the
		// "Unknown map (newmap?)" UI. Sibling rationale to HeroRaw
		// above.
		res.MapRaw = cand
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
