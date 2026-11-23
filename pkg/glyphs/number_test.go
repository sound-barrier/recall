package glyphs_test

import (
	"image"
	"testing"

	"recall/pkg/glyphs"
)

func TestReadNumber_ReadsDigitsAtBothScales(t *testing.T) {
	refs := digitReferences(t)
	cases := []struct {
		name  string
		strip numberStrip
		want  int
	}{
		{"1.0x", numberStrip{text: "907", cell: cellFull, gap: cellFull}, 907},
		{"0.75x", numberStrip{text: "907", cell: cellSmall, gap: cellSmall}, 907},
		{"every digit", numberStrip{text: "1234567890", cell: cellSmall, gap: cellSmall}, 1234567890},
		{"narrow ones beside a wide digit", numberStrip{text: "117", cell: cellFull, gap: cellFull}, 117},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			img, rect := drawNumber(t, tc.strip)
			addNoise(img, 20)

			got, ok := refs.ReadNumber(img, rect)

			if !ok || got.Value != tc.want {
				t.Fatalf("ReadNumber = (%+v, %v), want %d", got, ok, tc.want)
			}
			if got.Score < glyphs.MinScore || got.Margin < glyphs.MinMargin {
				t.Fatalf("accepted reading %+v sits below the accept rule", got)
			}
		})
	}
}

func TestReadNumber_SkipsThousandsSeparators(t *testing.T) {
	refs := digitReferences(t)
	for text, want := range map[string]int{"1,234": 1234, "12,345,678": 12345678} {
		t.Run(text, func(t *testing.T) {
			img, rect := drawNumber(t, numberStrip{text: text, cell: cellFull, gap: cellFull})

			got, ok := refs.ReadNumber(img, rect)

			if !ok || got.Value != want {
				t.Fatalf("ReadNumber(%s) = (%+v, %v), want %d", text, got, ok, want)
			}
		})
	}
}

// A short blob anywhere a thousands separator cannot sit is a decimal point,
// a sign, or a misplaced mark: dropping it would turn 12.97 into 1297 and -12
// into 12, so the read is inconclusive instead.
func TestReadNumber_ShortBlobOutsideAThousandsSlotIsInconclusive(t *testing.T) {
	refs := digitReferences(t)
	for _, text := range []string{"12.97", "-12", "12,34", "1234,", ",123", "1,,234", "1,2345", "1234,567"} {
		t.Run(text, func(t *testing.T) {
			img, rect := drawNumber(t, numberStrip{text: text, cell: cellFull, gap: cellFull})

			if got, ok := refs.ReadNumber(img, rect); ok {
				t.Fatalf("ReadNumber(%s) guessed %+v", text, got)
			}
		})
	}
}

func TestReadNumber_RejectsAGlyphNoReferenceResembles(t *testing.T) {
	img, rect := drawNumber(t, numberStrip{text: "1x", cell: cellFull, gap: cellFull})

	if got, ok := digitReferences(t).ReadNumber(img, rect); ok {
		t.Fatalf("ReadNumber read a non-digit as %+v", got)
	}
}

func TestReadNumber_RejectsAnAmbiguousBestMatch(t *testing.T) {
	var refs glyphs.References
	eight, _ := drawNumber(t, numberStrip{text: "8", cell: cellFull, gap: cellFull})
	for _, digit := range []int{3, 8} {
		if err := refs.AddDigit(digit, eight); err != nil {
			t.Fatal(err)
		}
	}
	img, rect := drawNumber(t, numberStrip{text: "8", cell: cellFull, gap: cellFull})

	if got, ok := refs.ReadNumber(img, rect); ok {
		t.Fatalf("two labels tied on one glyph, yet ReadNumber accepted %+v", got)
	}
}

func TestReadNumber_TouchingGlyphsAreInconclusive(t *testing.T) {
	img, rect := drawNumber(t, numberStrip{text: "00", cell: cellFull, gap: -cellFull})

	if got, ok := digitReferences(t).ReadNumber(img, rect); ok {
		t.Fatalf("ReadNumber read two fused glyphs as %+v", got)
	}
}

func TestReadNumber_EmptyReferenceSetReadsNothing(t *testing.T) {
	img, rect := drawNumber(t, numberStrip{text: "42", cell: cellFull, gap: cellFull})
	var empty glyphs.References

	if got, ok := empty.ReadNumber(img, rect); ok {
		t.Fatalf("an empty reference set read %+v", got)
	}
}

func TestReadNumber_BlankRectReadsNothing(t *testing.T) {
	img, _ := drawNumber(t, numberStrip{text: "42", cell: cellFull, gap: cellFull})

	if got, ok := digitReferences(t).ReadNumber(img, image.Rect(0, 0, 4, 4)); ok {
		t.Fatalf("a rect with no ink read %+v", got)
	}
}

func TestAddDigit_RefusesAnythingButOneDigitGlyph(t *testing.T) {
	two, _ := drawNumber(t, numberStrip{text: "42", cell: cellFull, gap: cellFull})
	one, _ := drawNumber(t, numberStrip{text: "4", cell: cellFull, gap: cellFull})
	var refs glyphs.References
	if err := refs.AddDigit(4, two); err == nil {
		t.Error("AddDigit accepted a two-glyph reference")
	}
	if err := refs.AddDigit(10, one); err == nil {
		t.Error("AddDigit accepted 10 as a digit")
	}
	fused, _ := drawNumber(t, numberStrip{text: "00", cell: cellFull, gap: -cellFull})
	if err := refs.AddDigit(0, fused); err == nil {
		t.Error("AddDigit accepted two touching glyphs as one")
	}
}
