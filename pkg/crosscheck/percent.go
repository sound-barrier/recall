package crosscheck

import (
	"math"
	"strconv"

	"recall/pkg/match"
	"recall/pkg/parser"
)

// maxPercentDrift is how far a hero's printed share may sit from its share
// of the listed play time: the client rounds both, against a total it does
// not print.
const maxPercentDrift = 3

// heroPercentVsPlaytime holds each SUMMARY hero card's percent to its share
// of the cards' summed play time, and the percents' sum to 100 plus one
// point of rounding per hero.
//
// A sum short of 100 is deliberately not judged (see listsEveryHero). The
// per-hero split is skipped there too, since shares of the listed time
// overstate every listed hero when one is missing.
//
// A card with no hero name has no path to flag, so it is never flagged; its
// play time still counts toward the total.
func heroPercentVsPlaytime(g Group) []finding {
	var out []finding
	for _, s := range g.Sources {
		if s.Type == parser.TypeSummary {
			out = append(out, percentFindings(s)...)
		}
	}
	return out
}

func percentFindings(s Source) []finding {
	heroes := s.Data.HeroesPlayed
	switch {
	case percentSum(heroes) > 100+len(heroes):
		return everyPercent(s)
	case !listsEveryHero(heroes):
		return nil
	}
	return percentsOffTheirTime(s)
}

func percentSum(heroes []parser.HeroPlay) int {
	sum := 0
	for _, h := range heroes {
		sum += h.PercentPlayed
	}
	return sum
}

// listsEveryHero reports whether a SUMMARY's hero cards account for the whole
// match: their percents sum to 100, less a point of rounding per hero. A
// shorter sum may be a hero with no card rather than a misread (the parser
// drops a card whose name the roster does not know, and the column has room
// for only so many), so the listed play time may fall short of the match.
// Unread percents vouch for nothing. Every check that takes the cards' play
// time for the whole match asks this first.
func listsEveryHero(heroes []parser.HeroPlay) bool {
	return percentSum(heroes) >= 100-len(heroes)
}

// everyPercent flags each hero's percent: a sum over 100 says one is wrong
// without saying which.
func everyPercent(s Source) []finding {
	var out []finding
	for _, h := range s.Data.HeroesPlayed {
		if h.Hero == "" {
			continue
		}
		out = append(out, finding{
			field:    parser.HeroPercentPath(h.Hero),
			readings: []match.FieldReading{ocrReading(s.File, strconv.Itoa(h.PercentPlayed))},
		})
	}
	return out
}

func percentsOffTheirTime(s Source) []finding {
	total, ok := timedSeconds(s.Data.HeroesPlayed)
	if !ok || total == 0 {
		return nil
	}
	var out []finding
	for _, h := range s.Data.HeroesPlayed {
		if h.Hero == "" {
			continue
		}
		seconds, _ := clockSeconds(h.PlayTime)
		share := 100 * float64(seconds) / float64(total)
		if math.Abs(float64(h.PercentPlayed)-share) <= maxPercentDrift {
			continue
		}
		out = append(out, finding{
			field: parser.HeroPercentPath(h.Hero),
			readings: []match.FieldReading{
				ocrReading(s.File, strconv.Itoa(h.PercentPlayed)), derivedReading(s.File, share),
			},
		})
	}
	return out
}
