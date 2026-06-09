package parser

import (
	"regexp"
	"sort"
	"strings"
)

// candidateNameFromOCR returns the longest alphabetic-ish token in the
// OCR text — used as the `*_raw` fallback when the matchers (extract
// Heroes / bestKnownMapInText / snapToKnownMap) fail to find a
// canonical match. The leaf-row chip shows this raw text in
// parentheses so the user can recognise "Unknown hero (miyazaki?)"
// and the maintainer can spot what new hero needs adding to
// heroes.yaml. Returns "" when no plausible token exists.
//
// "Plausible token" = a contiguous run of letters / apostrophe /
// dot / colon / space starting and ending with a letter, length
// 3–40. OW hero / map names all fit this shape.
var candidateNameRe = regexp.MustCompile(`[A-Za-z][A-Za-z'.: ]{1,38}[A-Za-z]`)

func candidateNameFromOCR(text string) string {
	matches := candidateNameRe.FindAllString(text, -1)
	longest := ""
	for _, m := range matches {
		clean := strings.TrimSpace(m)
		if len(clean) > len(longest) {
			longest = clean
		}
	}
	return strings.ToLower(longest)
}

// heroRoles + heroDisplayNames are populated in owdata.go's init() from
// pkg/parser/heroes.yaml. Edit heroes.yaml to add or rename a hero.

// HeroRole returns the role ("tank", "dps", "support") for the given hero
// name, or "" for an unknown hero. Accepts any casing or diacritic form
// — input is normalized to the OCR-matching key. Exported so other
// packages (e.g. metrics label resolution) can resolve roles without
// reaching into the unexported lookup map.
func HeroRole(hero string) string {
	return loadDataset().heroRoles[normalize(hero)]
}

// FirstKnownHeroIn is the exported entry point for the boot
// re-aggregator. Given a raw OCR string previously rejected by
// extractHeroes, re-runs the matcher against the CURRENT
// heroes.yaml roster and returns the first canonical match, or ""
// if still unknown. Mirrors extractHeroes' return contract for
// single-hero callers (the re-aggregator only updates one canonical
// column per row).
func FirstKnownHeroIn(rawHero string) string {
	hs := extractHeroes(rawHero)
	if len(hs) == 0 {
		return ""
	}
	return hs[0]
}

func extractHeroes(text string) []string {
	// Normalize OCR text the same way hero-name keys were normalized at
	// load time (lowercase + diacritic-strip + colon-strip + whitespace-
	// collapse). Both sides of the substring/Levenshtein comparison live
	// in the same character space; without this, "Soldier: 76" in OCR
	// text wouldn't substring-match the colon-stripped "soldier 76" key,
	// and "Lúcio" wouldn't match "lucio". See owdata.go's normalize()
	// for the full rule list.
	normText := normalize(text)
	seen := map[string]bool{}
	var found []string
	// Pass 1: exact substring match.
	for _, hero := range heroNamesByLength() {
		if seen[hero] {
			continue
		}
		if strings.Contains(normText, hero) {
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
	//
	// Length-gate the candidates at 5: short hero names (Mei, Ana, Ashe,
	// Echo, Emre, Juno, D.va) used to participate in Pass 2 with a
	// threshold-1 floor, which made a sliding 3-char window over an
	// unknown hero like "miyazaki" accept "aza" → "ana" (one edit) or
	// "miy" → "mei" (the original bug). For genuinely new heroes the
	// upstream parser writes hero='' + hero_raw=<ocr> so the leaf chip
	// can surface "Unknown hero (miyazaki?)" instead of silently
	// attributing it to a lookalike.
	//
	// The /6 ratio is tighter than the historical /4 — len 7 still
	// admits 1 edit (so JUMKRAT → junkrat keeps working) but len 14
	// admits only 2 (was 3). Same baseline as snapToKnownMap's
	// existing percentage gate.
	const minFuzzyLen = 5
	bestHero := ""
	bestDist := -1
	for _, hero := range heroNamesByLength() {
		if len(hero) < minFuzzyLen {
			continue
		}
		if len(hero) > len(normText) {
			continue
		}
		threshold := max(len(hero)/6, 1)
		for i := 0; i+len(hero) <= len(normText); i++ {
			d := levenshtein(normText[i:i+len(hero)], hero)
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
	roles := loadDataset().heroRoles
	names := make([]string, 0, len(roles))
	for k := range roles {
		names = append(names, k)
	}
	sort.Slice(names, func(i, j int) bool { return len(names[i]) > len(names[j]) })
	return names
}
