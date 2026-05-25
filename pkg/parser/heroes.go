package parser

import (
	"sort"
	"strings"
)

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
	"moira": "support", "wuyang": "support", "zenyatta": "support",
}

// HeroRole returns the role ("tank", "dps", "support") for the given hero
// name, or "" for an unknown hero. Exported so other packages (e.g. metrics
// label resolution) can resolve roles without reaching into the unexported
// heroRoles map.
func HeroRole(hero string) string {
	return heroRoles[hero]
}

func extractHeroes(text string) []string {
	upper := strings.ToUpper(text)
	seen := map[string]bool{}
	var found []string
	// Pass 1: exact substring match.
	for _, hero := range heroNamesByLength() {
		if seen[hero] {
			continue
		}
		if strings.Contains(upper, strings.ToUpper(hero)) {
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
	lower := strings.ToLower(text)
	bestHero := ""
	bestDist := -1
	for _, hero := range heroNamesByLength() {
		if len(hero) > len(lower) {
			continue
		}
		threshold := len(hero) / 4
		if threshold < 1 {
			threshold = 1
		}
		for i := 0; i+len(hero) <= len(lower); i++ {
			d := levenshtein(lower[i:i+len(hero)], hero)
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
