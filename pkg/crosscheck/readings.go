package crosscheck

import (
	"math"
	"slices"
	"strconv"
	"strings"

	"recall/pkg/match"
	"recall/pkg/parser"
)

func ocrReading(file, value string) match.FieldReading {
	return match.FieldReading{SourceFile: file, Origin: match.OriginOCR, Value: value}
}

func templateReading(file, value string) match.FieldReading {
	return match.FieldReading{SourceFile: file, Origin: match.OriginTemplate, Value: value}
}

func derivedReading(file string, value float64) match.FieldReading {
	return match.FieldReading{SourceFile: file, Origin: match.OriginDerived, Value: strconv.Itoa(int(math.Round(value)))}
}

// stat is one integer scalar of a match by its JSON name.
type stat struct {
	name string
	of   func(*parser.MatchResult) int
}

func (s stat) path() parser.FieldPath { return parser.ScalarPath(s.name) }

var (
	eliminations = stat{"eliminations", func(d *parser.MatchResult) int { return d.Eliminations }}
	assists      = stat{"assists", func(d *parser.MatchResult) int { return d.Assists }}
	deaths       = stat{"deaths", func(d *parser.MatchResult) int { return d.Deaths }}
	damage       = stat{"damage", func(d *parser.MatchResult) int { return d.Damage }}
	healing      = stat{"healing", func(d *parser.MatchResult) int { return d.Healing }}
	mitigation   = stat{"mitigation", func(d *parser.MatchResult) int { return d.Mitigation }}

	scalarStats = []stat{eliminations, assists, deaths, damage, healing, mitigation}
)

// records reports whether the parse recorded a region for field: whether the
// pixels produced the value, which is the only way to tell a 0 read off the
// screen from the 0 a field holds when no pass read anything.
func (s Source) records(field parser.FieldPath) bool {
	return slices.ContainsFunc(s.Evidence, func(ev parser.FieldEvidence) bool { return ev.Field == field })
}

// reads reports whether st is a reading this screenshot made.
func (s Source) reads(st stat) bool {
	return st.of(&s.Data) != 0 || s.records(st.path())
}

// clockSeconds reads an "MM:SS" or "H:MM:SS" clock.
func clockSeconds(clock string) (int, bool) {
	if clock == "" {
		return 0, false
	}
	total := 0
	for part := range strings.SplitSeq(clock, ":") {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return 0, false
		}
		total = total*60 + n
	}
	return total, true
}

// timedSeconds sums every hero's play time, not ok when any hero lacks one:
// a sum missing a hero would understate the minutes and condemn every total.
func timedSeconds(heroes []parser.HeroPlay) (int, bool) {
	total := 0
	for _, h := range heroes {
		seconds, ok := clockSeconds(h.PlayTime)
		if !ok {
			return 0, false
		}
		total += seconds
	}
	return total, len(heroes) > 0
}

// matchMinutes is the longest the match can have run by what it says: its
// game length or its heroes' summed play time, whichever is longer. The
// longer one gives the lower rate, so a cap judged on it accuses nothing a
// shorter misread clock would.
func matchMinutes(d parser.MatchResult) float64 {
	seconds, _ := clockSeconds(d.GameLength)
	played := 0
	for _, h := range d.HeroesPlayed {
		if s, ok := clockSeconds(h.PlayTime); ok {
			played += s
		}
	}
	return float64(max(seconds, played)) / 60
}
