package crosscheck

import (
	"slices"
	"strconv"
	"strings"

	"recall/pkg/match"
	"recall/pkg/parser"
)

// sourceDisagreement compares what two screenshots of one match say about
// the same fact: the E/A/D the SUMMARY and the scoreboard both print, the
// result the SUMMARY and the rank screen both print, and whether every hero
// another screen shows is one the SUMMARY lists as played.
func sourceDisagreement(g Group) []finding {
	var out []finding
	for _, st := range []stat{eliminations, assists, deaths} {
		out = append(out, statDisagreement(g, st)...)
	}
	out = append(out, resultDisagreement(g)...)
	return append(out, heroMembership(g)...)
}

func statDisagreement(g Group, st stat) []finding {
	var readings []match.FieldReading
	values := map[int]bool{}
	for _, s := range g.Sources {
		if (s.Type == parser.TypeSummary || s.Type == parser.TypeTeams) && s.reads(st) {
			v := st.of(&s.Data)
			values[v] = true
			readings = append(readings, ocrReading(s.File, strconv.Itoa(v)))
		}
	}
	if len(values) < 2 {
		return nil
	}
	return []finding{{field: st.path(), readings: readings}}
}

func resultDisagreement(g Group) []finding {
	var readings []match.FieldReading
	values := map[string]bool{}
	for _, s := range g.Sources {
		if (s.Type == parser.TypeSummary || s.Type == parser.TypeRank) && s.Data.Result != "" {
			values[s.Data.Result] = true
			readings = append(readings, ocrReading(s.File, s.Data.Result))
		}
	}
	if len(values) < 2 {
		return nil
	}
	return []finding{{field: parser.ScalarPath("result"), readings: readings}}
}

// heroesShownBy names, per screen, the heroes it shows: the PERSONAL tab's
// hero and each rank SR card's hero. The scoreboard prints no hero name, so
// it shows none.
var heroesShownBy = map[parser.ScreenshotType]func(Source) []match.FieldReading{
	parser.TypePersonal: func(s Source) []match.FieldReading {
		if s.Data.Hero == "" {
			return nil
		}
		return []match.FieldReading{ocrReading(s.File, s.Data.Hero)}
	},
	parser.TypeRank: func(s Source) []match.FieldReading {
		var out []match.FieldReading
		for _, sr := range s.Data.SR {
			if sr.Hero != "" {
				out = append(out, ocrReading(s.File, sr.Hero))
			}
		}
		return out
	},
}

// heroMembership flags heroes_played when another screen shows a hero the
// SUMMARY does not list. Without a SUMMARY there is no list to hold it to.
func heroMembership(g Group) []finding {
	listed, listings := summaryHeroes(g)
	if len(listed) == 0 {
		return nil
	}
	var strays []match.FieldReading
	for _, s := range g.Sources {
		if shown, ok := heroesShownBy[s.Type]; ok {
			strays = append(strays, slices.DeleteFunc(shown(s), func(r match.FieldReading) bool { return listed[r.Value] })...)
		}
	}
	if len(strays) == 0 {
		return nil
	}
	return []finding{{field: parser.ScalarPath("heroes_played"), readings: append(listings, strays...)}}
}

// summaryHeroes is every hero a SUMMARY lists, and each SUMMARY's list as a
// reading.
func summaryHeroes(g Group) (map[string]bool, []match.FieldReading) {
	listed := map[string]bool{}
	var listings []match.FieldReading
	for _, s := range g.Sources {
		if s.Type != parser.TypeSummary {
			continue
		}
		names := heroNames(s.Data.HeroesPlayed)
		for _, name := range names {
			listed[name] = true
		}
		if len(names) > 0 {
			listings = append(listings, ocrReading(s.File, strings.Join(names, ", ")))
		}
	}
	return listed, listings
}
