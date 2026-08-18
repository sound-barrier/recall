package parser

import (
	"image"
	"regexp"
	"strconv"
	"strings"
)

// The rank pill: which tier and level the screen settled on, and the season-4
// caption naming the share of players the reading sits above.

// rankTierLevel reads the tier label ("PLATINUM 5") that sits just below the
// badge, from the same wide band the detector probes (10-70% W, down to 78% H,
// which also holds the "RANK PROGRESS" caption extractRank ignores): a tighter
// center crop garbles the tier on some captures ("GOLD" → "GOD" / "6010" /
// "solo"), so extractRank returns no rank and the whole screen is
// misclassified as summary/unknown.
// The returned bandText is the PRIMARY (PSM 11) pass over this band. It is
// handed back rather than discarded because the season-4 percentile caption
// ("HIGHER RANKED THAN 57% OF PLAYERS") renders inside this same crop and is
// legible in it on every capture in the corpus — so reading the percentile
// costs no additional Tesseract invocation, which at ~8 OCR passes per rank
// screen is worth more than a tidier signature.
func rankTierLevel(img image.Image, work string) (rank string, level int, bandText string) {
	bounds := img.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	tierRect := image.Rect(W*10/100, H*55/100, W*70/100, H*78/100)
	tierText, _ := ocrInverted(img, tierRect, ocrSpec{workDir: work, name: "rank_tier", psm: "11", whitelist: ""})
	rank, level = extractRank(tierText)
	// The 2026-07 UI renders the division caption in a stylized face whose
	// numerals the sparse pass misreads as letters ("GOLD 3" → "GOLD J",
	// "PLATINUM 5" → "PI ATINUM J" — and J is ambiguous between 3 and 5, so
	// no digitize mapping can recover it) or that corrupt the tier word
	// itself ("FOLD?"). A PSM-6 re-read of the SAME band resolves the
	// caption line cleanly; the whitelist pins the alphabet to tier words +
	// levels 1-5 so the numeral cannot resolve to a letter. Fires only when
	// the sparse pass came back incomplete — no committed old-UI golden has
	// level 0, so the existing corpus never re-reads.
	if rank == "" || level == 0 {
		v2Text, _ := ocrInverted(img, tierRect, ocrSpec{workDir: work, name: "rank_tier_v2", psm: "6", whitelist: rankTierWhitelist})
		if r2, l2 := extractRank(v2Text); r2 != "" && (rank == "" || l2 != 0) {
			rank, level = r2, l2
		}
	}
	return rank, level, tierText
}

var (
	rankProgressRe = regexp.MustCompile(`(-?\d{1,3})\s*%`)
	// The sign is REQUIRED, not optional, and that is load-bearing. The bands
	// this runs over also carry "RANK PROGRESS: 67%" and "HIGHER RANKED THAN
	// 57% OF PLAYERS"; an optional sign would match those and store a progress
	// or population figure as the match's rank movement. The pill always
	// renders its sign ("+40%", "-32%"), so requiring one costs nothing.
	rankChangeRe = regexp.MustCompile(`([+-])\s*(\d{1,3})\s*%`)
	// Anchored on the WORDS, not on "some percentage in this band". The band
	// also holds "RANK PROGRESS: 67%", which sits on the same row and would win
	// a bare `(\d+)%` scan. RANKED is spelled loosely because the caption's tail
	// clips at the crop's right edge ("HIGHER RANKED THAN 57% ¢") and OCR
	// wobbles on the surrounding glyphs, but the two words either side of the
	// number are what make the match unambiguous.
	//
	// [ \t] rather than \s, deliberately: \s matches a newline, so if the
	// caption's own number were ever clipped away the match would jump to the
	// NEXT OCR line and store whatever percentage began it — and the line
	// above this one in the band is "RANK PROGRESS: 67%".
	rankPercentileRe = regexp.MustCompile(`(?i)HIGHER[ \t]+RANKED[ \t]+THAN[ \t]+(\d{1,3})[ \t]*%`)
)

// extractRankPercentile reads the season-4 "HIGHER RANKED THAN 57% OF PLAYERS"
// caption — the share of the population the player is above.
//
// nil means the screen did not show one, which is a real state rather than a
// failure: the caption is absent for the whole of placements, where there is no
// settled rank to be a percentile of. That is why the field is a pointer all
// the way to the database — a 0 here would claim the player is above nobody.
func extractRankPercentile(bandText string) *int {
	m := rankPercentileRe.FindStringSubmatch(bandText)
	if m == nil {
		return nil
	}
	pct, err := strconv.Atoi(m[1])
	if err != nil || pct < 0 || pct > 100 {
		return nil
	}
	return &pct
}

// rankTierWhitelist constrains the PSM-6 tier re-read to tier words, the
// 1-5 level digits, and the RANK PROGRESS caption's own characters — an
// alphabet with no letter the stylized numerals can escape into.
const rankTierWhitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ12345:% "

// rankFuzzyMaxPct caps the tier-snap Levenshtein distance as a percentage of the
// tier name's length (floor of 1, mirroring snapToKnownMap). It lets a mis-OCR'd
// tier word recover from a glyph slip — "GOD"→gold, "CHAMPON"→champion — without
// matching unrelated words ("WIZARD" stays unmatched). This is the #499
// generalization lever: untested tiers (Bronze/Champion/Diamond) survive
// imperfect OCR instead of silently returning no rank.
const rankFuzzyMaxPct = 25

var rankWordRe = regexp.MustCompile(`[a-z]+`)

// snapTier resolves the OCR'd tier band to a canonical tier. An exact substring
// match wins; otherwise the nearest known tier (by Levenshtein distance, within
// the length-scaled threshold) to any alphabetic word in the text. It also
// returns the matched text token, so the level read can anchor on the
// (possibly garbled) word rather than the canonical tier.
func snapTier(lower string) (tier, word string) {
	for _, r := range loadDataset().ranks {
		if strings.Contains(lower, r) {
			return r, r
		}
	}
	bestDist := -1
	for _, w := range rankWordRe.FindAllString(lower, -1) {
		// 3 is the floor so a dropped-letter "GOD" can still reach the 4-char
		// "gold"; shorter words can't clear any tier's threshold, and longer
		// tiers exclude a 3-char word by length difference alone.
		if len(w) < 3 {
			continue
		}
		for _, r := range loadDataset().ranks {
			threshold := max(len(r)*rankFuzzyMaxPct/100, 1)
			if d := levenshtein(w, r); d <= threshold && (bestDist < 0 || d < bestDist) {
				bestDist, tier, word = d, r, w
			}
		}
	}
	return tier, word
}

func extractRank(text string) (string, int) {
	rank, word := snapTier(strings.ToLower(text))
	if rank == "" {
		return "", 0
	}
	// Anchor the level on the matched tier word (the canonical tier on an exact
	// hit, the garbled token when fuzzy-snapped). Allow digit-lookalike letters
	// after it ("GOLD I" — the italic "1" OCRs as the letter I) and digitize
	// before reading. Take the LAST digit of the trailing run: italic fonts
	// misread "PLATINUM 5" as "PLATINUM 35", and OW levels are single digits 1-5.
	level := 0
	re := regexp.MustCompile(`(?i)` + regexp.QuoteMeta(word) + `\s*([0-9OoQqIlL]+)`)
	if m := re.FindStringSubmatch(text); m != nil {
		d := digitize(m[1])
		level, _ = strconv.Atoi(d[len(d)-1:])
	}
	return rank, level
}
