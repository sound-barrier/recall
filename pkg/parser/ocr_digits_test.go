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

// A small stat value (0/1) next to the card icon OCRs as a letter ("1"→"T",
// "0"→"O"), so no digit survives the value scan and the whole cell used to be
// dropped. With a clean "AVG PER 10 MIN" line the value is recovered from
// avg × play/10 (rounded). Real OCR text from the openqueue reinhardt PERSONAL.
func TestParsePersonalStatCell_RecoversLetterMangledValueFromAvg(t *testing.T) {
	cases := []struct {
		name    string
		text    string
		playMin float64
		wantKey string
		wantVal int
	}{
		{
			"value 1 mis-read as T, recovered from avg 6.46",
			"T\nCHARGE KILL\nAVG PER 10 MIN: 6.46",
			1.53, "charge_kill", 1,
		},
		{
			"value 0 (no digit survives) recovered from avg 0.00",
			"FIRE STRIKE KILLS\nAVG PER 10 MIN: 0.00",
			1.53, "fire_strike_kills", 0,
		},
	}
	for _, c := range cases {
		key, val, ok := parser.ParsePersonalStatCell(c.text, c.playMin)
		if !ok || key != c.wantKey || val != c.wantVal {
			t.Errorf("%s:\n  got  (%q, %d, %v)\n  want (%q, %d, true)",
				c.name, key, val, ok, c.wantKey, c.wantVal)
		}
	}
}

// Two PERSONAL label-scan fixes: the boundary trim keeps 3-char abbreviation
// prefixes (cutting only 1-2 char icon noise) so "OBJ CONTEST TIME" keeps its
// OBJ, and the long "NEW CAREER BEST!" badge is skipped so it can't outscore a
// shorter real label like "CHARGE KILL".
func TestParsePersonalStatCell_KeepsAbbrevPrefixAndSkipsCareerBestBadge(t *testing.T) {
	cases := []struct {
		name, text string
		playMin    float64
		wantKey    string
	}{
		{
			"OBJ prefix survives the boundary trim",
			"00:00\nOBJ CONTEST TIME\nAVG PER 10 MIN: 0.00",
			1.53, "obj_contest_time",
		},
		{
			"NEW CAREER BEST badge doesn't outscore a shorter real label",
			"T\nCHARGE KILL\nAVG PER 10 MIN: 6.46\nNEW CAREER BEST!",
			1.53, "charge_kill",
		},
	}
	for _, c := range cases {
		key, _, ok := parser.ParsePersonalStatCell(c.text, c.playMin)
		if !ok || key != c.wantKey {
			t.Errorf("%s: got key=%q ok=%v, want %q", c.name, key, ok, c.wantKey)
		}
	}
}
