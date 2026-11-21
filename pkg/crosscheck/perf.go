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

// perfCard is one SUMMARY Total Performance card: a total, its rate, and how
// to write a total back onto a reading.
type perfCard struct {
	total    stat
	rate     func(*parser.Performance) float64
	setTotal func(*parser.MatchResult, int)
}

var perfCards = []perfCard{
	{
		eliminations,
		func(p *parser.Performance) float64 { return p.Eliminations.AvgPer10Min },
		func(d *parser.MatchResult, total int) { d.Eliminations = total },
	},
	{
		assists,
		func(p *parser.Performance) float64 { return p.Assists.AvgPer10Min },
		func(d *parser.MatchResult, total int) { d.Assists = total },
	},
	{
		deaths,
		func(p *parser.Performance) float64 { return p.Deaths.AvgPer10Min },
		func(d *parser.MatchResult, total int) { d.Deaths = total },
	},
}

// perfMisread is one total its own card's rate condemns: the card, the total
// as read, and the total the rate supports over the minutes played.
type perfMisread struct {
	card     perfCard
	total    int
	expected float64
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

// perfFindings turns one SUMMARY's misread totals into findings, the derived
// total riding along beside the one read.
func perfFindings(s Source) []finding {
	var out []finding
	for _, m := range perfMisreads(s) {
		out = append(out, finding{field: m.card.total.path(), readings: []match.FieldReading{
			ocrReading(s.File, strconv.Itoa(m.total)), derivedReading(s.File, m.expected),
		}})
	}
	return out
}

// perfMisreads checks one SUMMARY's cards. The three cards share the minutes
// played, so the cards that agree with the play time corroborate it; when
// every card with a rate disagrees, the play time is the misread, not each
// total, and no total is condemned. A total the parse never read is no
// reading and is skipped.
func perfMisreads(s Source) []perfMisread {
	seconds, ok := playedSeconds(s.Data.HeroesPlayed)
	if s.Data.Performance == nil || !ok {
		return nil
	}
	checked, agreeing := 0, 0
	var off []perfMisread
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
		off = append(off, perfMisread{card: card, total: total, expected: expected})
	}
	if checked > 1 && agreeing == 0 {
		return nil
	}
	return off
}

// WithoutDisownedTotals is s's reading with each E/A/D total that
// perf_total_vs_rate condemns left unread (0), by the same arithmetic as that
// check. Every other field, and every total the check does not condemn, is
// s's as read, and a screenshot other than a SUMMARY comes back whole.
//
// The check proves only that a total and its rate disagree, not which of
// them, or the play time, was misread, so the view does not put the rate's
// total in the condemned one's place: a misread rate would make it a wrong
// value. It is for a caller that compares screenshots before anyone has
// judged the flag, and would otherwise hold a screenshot to a total it
// disowns. s is not touched.
func WithoutDisownedTotals(s Source) parser.MatchResult {
	out := s.Data
	if s.Type != parser.TypeSummary {
		return out
	}
	for _, m := range perfMisreads(s) {
		m.card.setTotal(&out, 0)
	}
	return out
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
