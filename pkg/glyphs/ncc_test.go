package glyphs_test

import (
	"math"
	"testing"

	"recall/pkg/glyphs"
)

func TestNCC_SelfMatchIsOne(t *testing.T) {
	a := []float64{10, 200, 35, 90, 160}
	if got := glyphs.NCC(a, a); math.Abs(got-1) > 1e-9 {
		t.Fatalf("NCC(a, a) = %v, want 1", got)
	}
}

func TestNCC_InvertedIsMinusOne(t *testing.T) {
	a := []float64{10, 200, 35, 90, 160}
	inverted := make([]float64, len(a))
	for i, v := range a {
		inverted[i] = 255 - v
	}
	if got := glyphs.NCC(a, inverted); math.Abs(got+1) > 1e-9 {
		t.Fatalf("NCC(a, 255-a) = %v, want -1", got)
	}
}

func TestNCC_IgnoresBrightnessAndContrast(t *testing.T) {
	a := []float64{10, 200, 35, 90, 160}
	brighter := make([]float64, len(a))
	for i, v := range a {
		brighter[i] = 0.5*v + 40
	}
	if got := glyphs.NCC(a, brighter); math.Abs(got-1) > 1e-9 {
		t.Fatalf("NCC(a, 0.5a+40) = %v, want 1", got)
	}
}

func TestNCC_FlatVectorCorrelatesWithNothing(t *testing.T) {
	flat := []float64{80, 80, 80, 80}
	if got := glyphs.NCC(flat, []float64{1, 2, 3, 4}); got != 0 {
		t.Fatalf("NCC(flat, ramp) = %v, want 0", got)
	}
}

func TestNCC_PanicsOnLengthMismatch(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("NCC accepted vectors of different lengths")
		}
	}()
	glyphs.NCC([]float64{1, 2}, []float64{1, 2, 3})
}
