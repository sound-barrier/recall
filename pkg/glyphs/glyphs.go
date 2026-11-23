// Package glyphs recognizes Overwatch stat digits by normalized
// cross-correlation against reference pixels cut from real screenshots. It is a cross-check beside Tesseract, never a replacement: a
// read it cannot make with confidence comes back not ok rather than guessed.
package glyphs

import (
	"cmp"
	"slices"
)

// MinScore and MinMargin are the accept rule every read answers to: the best
// reference must correlate at least MinScore with the pixels, and beat the
// best reference of any other label by at least MinMargin.
const (
	MinScore  = 0.80
	MinMargin = 0.05
)

// template is one reference cut, already normalized to the vector the
// readers compare against.
type template struct {
	label string
	vec   []float64
}

type verdict struct {
	label         string
	score, margin float64
}

// classify names the label whose best reference correlates highest with vec.
// With a single label in refs nothing competes, so the runner-up counts as a
// perfect anti-correlation.
func classify(vec []float64, refs []template) (verdict, bool) {
	bestByLabel := map[string]float64{}
	for _, ref := range refs {
		score := NCC(vec, ref.vec)
		if seen, ok := bestByLabel[ref.label]; !ok || score > seen {
			bestByLabel[ref.label] = score
		}
	}
	ranked := make([]verdict, 0, len(bestByLabel))
	for label, score := range bestByLabel {
		ranked = append(ranked, verdict{label: label, score: score})
	}
	if len(ranked) == 0 {
		return verdict{}, false
	}
	slices.SortFunc(ranked, func(a, b verdict) int {
		return cmp.Or(cmp.Compare(b.score, a.score), cmp.Compare(a.label, b.label))
	})
	top, runnerUp := ranked[0], -1.0
	if len(ranked) > 1 {
		runnerUp = ranked[1].score
	}
	top.margin = top.score - runnerUp
	return top, top.score >= MinScore && top.margin >= MinMargin
}
