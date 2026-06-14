package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

// A comma-grouped value ("1,367") must parse as one number — the old
// `\d{1,4}` regex split it at the comma and the longest-run pick kept "367".
func TestParsePersonalStatCell_CommaGroupedNumber(t *testing.T) {
	cases := []struct {
		name    string
		text    string
		wantKey string
		wantVal int
	}{
		{
			"comma value not split at the separator",
			"1,367\nHEALING KASA HEALING\nAVG PER 10 MIN: 3,098",
			"healing_kasa_healing", 1367,
		},
		{
			"4-digit comma value, no separator",
			"1,094\nREMEDY AURA HEALING\nAVG PER 10 MIN: 2,481",
			"remedy_aura_healing", 1094,
		},
		{
			"correct comma value beats a longer icon-misread on another pass",
			"1,496\nPULSAR TORPEDOES HEALING\n4496\nAVG PER 10 MIN: 1,636",
			"pulsar_torpedoes_healing", 1496,
		},
	}
	for _, c := range cases {
		key, val, ok := parser.ParsePersonalStatCell(c.text, 0)
		if !ok || key != c.wantKey || val != c.wantVal {
			t.Errorf("%s:\n  got  (%q, %d, %v)\n  want (%q, %d, true)",
				c.name, key, val, ok, c.wantKey, c.wantVal)
		}
	}
}

// The crossed-swords ELIMINATIONS icon OCRs as a stray "4" right before the
// label; the real "9" sits just before it. Segmenting per stat + taking the
// max picks 9 without letting the assists "19" shadow the deaths "6".
func TestParsePerformance_RejectsIconDigitBesideValue(t *testing.T) {
	text := "TOTAL PERFORMANCE\n9\n4\nELIMINATIONS\n" +
		"AVG PER 10 MIN: 6.64\n19\nASSISTS\n" +
		"AVG PER 10 MIN: 14.02\n6\nDEATHS\nAVG PER 10 MIN: 4.43"
	perf := parser.ParsePerformance(text)
	if perf == nil {
		t.Fatal("parsePerformance returned nil")
	}
	if perf.Eliminations.Total != 9 || perf.Assists.Total != 19 || perf.Deaths.Total != 6 {
		t.Errorf("E/A/D totals = %d/%d/%d, want 9/19/6",
			perf.Eliminations.Total, perf.Assists.Total, perf.Deaths.Total)
	}
}
