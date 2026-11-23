package crosscheck

import (
	"strconv"

	"recall/pkg/match"
	"recall/pkg/parser"
)

// minRateMinutes is the shortest match the per-10-minute caps judge: in a
// short one a few seconds of clock error swing the rate past any cap.
const minRateMinutes = 5

// statLimit is what no match produces: more than max of a stat in total, or
// more than maxPer10 per 10 minutes. Both sit well past the best games on
// record, so only a misread (an inserted digit, a merged cell) reaches them.
type statLimit struct {
	stat
	max, maxPer10 int
}

var statLimits = []statLimit{
	{eliminations, 150, 60},
	{assists, 150, 60},
	{deaths, 80, 30},
	{damage, 100_000, 40_000},
	{healing, 100_000, 40_000},
	{mitigation, 150_000, 60_000},
}

// bound is one rank-screen reading and the range it must lie in.
type bound struct {
	field  parser.FieldPath
	value  *int
	lo, hi int
}

// plausibleRange flags values no match can produce. The per-10-minute caps
// apply only when the match says how long it ran.
func plausibleRange(g Group) []finding {
	minutes := matchMinutes(g.Merged)
	var out []finding
	for _, s := range g.Sources {
		out = append(out, statsOutOfRange(s, minutes)...)
		out = append(out, rankOutOfRange(s)...)
	}
	return out
}

func statsOutOfRange(s Source, minutes float64) []finding {
	var out []finding
	for _, limit := range statLimits {
		v := limit.of(&s.Data)
		if v == 0 {
			continue
		}
		overRate := minutes >= minRateMinutes && float64(v)*10/minutes > float64(limit.maxPer10)
		if v < 0 || v > limit.max || overRate {
			out = append(out, outOfRange(s, limit.path(), v))
		}
	}
	return out
}

// rankOutOfRange holds the rank screen's readings to their ranges. A 0 level
// or SR is the parser's "not read", not a reading.
func rankOutOfRange(s Source) []finding {
	d := s.Data
	bounds := []bound{
		{parser.ScalarPath("change_percent"), d.ChangePercent, -100, 100},
		{parser.ScalarPath("rank_progress"), d.RankProgress, -100, 100},
		{parser.ScalarPath("rank_percentile"), d.RankPercentile, 0, 100},
	}
	if d.Level != 0 {
		bounds = append(bounds, bound{parser.ScalarPath("level"), &d.Level, 1, 5})
	}
	for _, sr := range d.SR {
		if sr.SR != 0 {
			bounds = append(bounds, bound{parser.SRPath(sr.Hero), &sr.SR, 1, 6000})
		}
	}
	var out []finding
	for _, b := range bounds {
		if b.value != nil && (*b.value < b.lo || *b.value > b.hi) {
			out = append(out, outOfRange(s, b.field, *b.value))
		}
	}
	return out
}

func outOfRange(s Source, field parser.FieldPath, v int) finding {
	return finding{field: field, readings: []match.FieldReading{ocrReading(s.File, strconv.Itoa(v))}}
}
