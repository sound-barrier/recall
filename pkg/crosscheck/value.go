package crosscheck

import (
	"strconv"
	"strings"

	"recall/pkg/parser"
)

// scalarValues spells each flaggable top-level field of a folded match the
// way a reading spells it. The E/A/D and stat totals come from scalarStats.
var scalarValues = map[parser.FieldPath]func(d parser.MatchResult) string{
	parser.ScalarPath("result"):          func(d parser.MatchResult) string { return d.Result },
	parser.ScalarPath("level"):           func(d parser.MatchResult) string { return strconv.Itoa(d.Level) },
	parser.ScalarPath("change_percent"):  func(d parser.MatchResult) string { return optionalInt(d.ChangePercent) },
	parser.ScalarPath("rank_progress"):   func(d parser.MatchResult) string { return optionalInt(d.RankProgress) },
	parser.ScalarPath("rank_percentile"): func(d parser.MatchResult) string { return optionalInt(d.RankPercentile) },
	parser.ScalarPath("heroes_played"): func(d parser.MatchResult) string {
		return strings.Join(heroNames(d.HeroesPlayed), ", ")
	},
}

// currentValue is what the folded match d holds for field: "" when it holds
// nothing there, as when a re-parse dropped the hero card the path names.
func currentValue(d parser.MatchResult, field parser.FieldPath) string {
	for _, st := range scalarStats {
		if field == st.path() {
			return strconv.Itoa(st.of(&d))
		}
	}
	if of, ok := scalarValues[field]; ok {
		return of(d)
	}
	if v, ok := srValue(d.SR, field); ok {
		return v
	}
	return heroValue(d.HeroesPlayed, field)
}

// srValue reads a rank card's SR path.
func srValue(cards []parser.HeroSR, field parser.FieldPath) (string, bool) {
	for _, sr := range cards {
		if field == parser.SRPath(sr.Hero) {
			return strconv.Itoa(sr.SR), true
		}
	}
	return "", false
}

// heroValue reads a hero's share of the match. Paths are matched whole,
// never cut apart, since a hero key can hold the separating "." ("d.va").
func heroValue(heroes []parser.HeroPlay, field parser.FieldPath) string {
	for _, h := range heroes {
		if field == parser.HeroPercentPath(h.Hero) {
			return strconv.Itoa(h.PercentPlayed)
		}
	}
	return ""
}

func optionalInt(v *int) string {
	if v == nil {
		return ""
	}
	return strconv.Itoa(*v)
}

// heroNames is every named hero card in order; a card with no hero name
// reads as no hero.
func heroNames(heroes []parser.HeroPlay) []string {
	var names []string
	for _, h := range heroes {
		if h.Hero != "" {
			names = append(names, h.Hero)
		}
	}
	return names
}
