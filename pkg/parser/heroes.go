package parser

import (
	"sort"
	"strings"
)

// heroRoles + heroDisplayNames are populated in owdata.go's init() from
// pkg/parser/heroes.yaml. Edit heroes.yaml to add or rename a hero.

// HeroRole returns the role ("tank", "dps", "support") for the given hero
// name, or "" for an unknown hero. Accepts any casing or diacritic form
// — input is normalized to the OCR-matching key. Exported so other
// packages (e.g. metrics label resolution) can resolve roles without
// reaching into the unexported lookup map.
func HeroRole(hero string) string {
	return heroRoles[normalize(hero)]
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
	bestHero := ""
	bestDist := -1
	for _, hero := range heroNamesByLength() {
		if len(hero) > len(normText) {
			continue
		}
		threshold := len(hero) / 4
		if threshold < 1 {
			threshold = 1
		}
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
	names := make([]string, 0, len(heroRoles))
	for k := range heroRoles {
		names = append(names, k)
	}
	sort.Slice(names, func(i, j int) bool { return len(names[i]) > len(names[j]) })
	return names
}
