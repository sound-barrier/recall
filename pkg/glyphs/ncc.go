package glyphs

import (
	"fmt"
	"math"
)

// NCC is the normalized cross-correlation of two equal-length vectors: 1 when
// one is a brightness and contrast shift of the other, -1 when it is the
// inversion, and 0 when either is flat, since a flat patch correlates with
// nothing. It panics when the lengths differ; every caller compares cells of
// one fixed size, so a mismatch is a bug, not an input.
func NCC(a, b []float64) float64 {
	if len(a) != len(b) {
		panic(fmt.Sprintf("glyphs.NCC: vector lengths %d and %d differ", len(a), len(b)))
	}
	meanA, meanB := mean(a), mean(b)
	var cross, varA, varB float64
	for i := range a {
		da, db := a[i]-meanA, b[i]-meanB
		cross += da * db
		varA += da * da
		varB += db * db
	}
	if varA == 0 || varB == 0 {
		return 0
	}
	return cross / math.Sqrt(varA*varB)
}

func mean(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	var sum float64
	for _, x := range v {
		sum += x
	}
	return sum / float64(len(v))
}
