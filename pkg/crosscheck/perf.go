package crosscheck

import (
	"math"
	"strconv"

	"recall/pkg/match"
	"recall/pkg/parser"
)

// minPerfSeconds is the least play time a rate is held to: under a minute a
// rate rounded to two places says too little about a whole-number total.
const minPerfSeconds = 60

// perfCard is one SUMMARY Total Performance card: a total and its rate.
type perfCard struct {
	total stat
	rate  func(*parser.Performance) float64
}

var perfCards = []perfCard{
	{eliminations, func(p *parser.Performance) float64 { return p.Eliminations.AvgPer10Min }},
	{assists, func(p *parser.Performance) float64 { return p.Assists.AvgPer10Min }},
	{deaths, func(p *parser.Performance) float64 { return p.Deaths.AvgPer10Min }},
}

// perfTotalVsRate holds each SUMMARY total to its own card's rate over the
// minutes the SUMMARY says were played. The derived total rides along as a
// reading, the value the card's own arithmetic supports.
func perfTotalVsRate(g Group) []finding {
	var out []finding
	for _, s := range g.Sources {
		if s.Type == parser.TypeSummary {
			out = append(out, perfFindings(s)...)
		}
	}
	return out
}

// perfFindings checks one SUMMARY's cards. The three cards share the minutes
// played, so the cards that agree with the play time corroborate it; when
// every card with a rate disagrees, the play time is the misread, not each
// total, and nothing is flagged. A total the parse never read is no reading
// and is skipped.
func perfFindings(s Source) []finding {
	seconds, ok := playedSeconds(s.Data.HeroesPlayed)
	if s.Data.Performance == nil || !ok {
		return nil
	}
	checked, agreeing := 0, 0
	var off []finding
	for _, card := range perfCards {
		rate := card.rate(s.Data.Performance)
		if rate <= 0 || !s.reads(card.total) {
			continue
		}
		checked++
		total := card.total.of(&s.Data)
		expected := rate * float64(seconds) / 600
		if !totalDisagrees(total, expected) {
			agreeing++
			continue
		}
		off = append(off, finding{field: card.total.path(), readings: []match.FieldReading{
			ocrReading(s.File, strconv.Itoa(total)), derivedReading(s.File, expected),
		}})
	}
	if checked > 1 && agreeing == 0 {
		return nil
	}
	return off
}

// playedSeconds is the minutes a SUMMARY's rates were taken over, as its hero
// cards' summed play time: not ok when a card lacks its time, when the cards
// leave a hero out (listsEveryHero), or under minPerfSeconds.
func playedSeconds(heroes []parser.HeroPlay) (int, bool) {
	seconds, ok := timedSeconds(heroes)
	return seconds, ok && seconds >= minPerfSeconds && listsEveryHero(heroes)
}

// totalDisagrees allows two either way for small totals, where the rate's
// rounding alone moves the product by one or two, and 15% for large ones.
func totalDisagrees(total int, expected float64) bool {
	return math.Abs(float64(total)-expected) > max(2, 0.15*expected)
}
