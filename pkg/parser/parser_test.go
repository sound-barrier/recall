package parser

import (
	"reflect"
	"testing"
)

// ──────────────────────────────────────────────────────────────────────────
// HeroRole — exported wrapper around heroRoles map.
// ──────────────────────────────────────────────────────────────────────────

func TestHeroRole(t *testing.T) {
	tests := []struct{ hero, want string }{
		{"lucio", "support"},
		{"kiriko", "support"},
		{"reinhardt", "tank"},
		{"d.va", "tank"},
		{"wrecking ball", "tank"},
		{"junker queen", "tank"},
		{"genji", "dps"},
		{"soldier: 76", "dps"},
		{"soldier 76", "dps"},
		{"unknown_hero", ""},
		{"", ""},
	}
	for _, tc := range tests {
		if got := HeroRole(tc.hero); got != tc.want {
			t.Errorf("HeroRole(%q) = %q, want %q", tc.hero, got, tc.want)
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────
// digitize — fix letter↔digit OCR confusion in italic OW2 font.
// ──────────────────────────────────────────────────────────────────────────

func TestDigitize(t *testing.T) {
	// Per parser.go:1122, the replacer maps:
	//   O o Q q → 0
	//   I l L   → 1
	// So lowercase l ALSO becomes 1, and uppercase L becomes 1.
	tests := []struct{ in, want string }{
		{"O", "0"},
		{"OOO", "000"},
		{"Q", "0"},
		{"I", "1"},
		{"l", "1"},
		{"L", "1"},
		{"123", "123"},               // already digits
		{"abc", "abc"},               // no replacements
		{"plOyer", "p10yer"},         // lowercase l→1, then O→0
		{"OQI Ll", "001 11"},         // multiple kinds
		{"PLATINUM 5", "P1AT1NUM 5"}, // both L→1 and I→1 fire
	}
	for _, tc := range tests {
		if got := digitize(tc.in); got != tc.want {
			t.Errorf("digitize(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────
// normalizeDate — MM/DD/YY (client display) → YYYY-MM-DD (ISO, sortable).
// ──────────────────────────────────────────────────────────────────────────

func TestNormalizeDate(t *testing.T) {
	tests := []struct{ in, want string }{
		{"5/10/26", "2026-05-10"},
		{"05/10/26", "2026-05-10"},
		{"12/31/26", "2026-12-31"},
		{"1/1/26", "2026-01-01"},
		{"5/10/2026", "2026-05-10"},  // 4-digit year handled
		{"not a date", "not a date"}, // no match → returned unchanged
		{"", ""},
	}
	for _, tc := range tests {
		if got := normalizeDate(tc.in); got != tc.want {
			t.Errorf("normalizeDate(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────
// extractRank — finds the OW2 tier name + level. Per the parser comments
// in parser.go:1462, the level extraction must pick the LAST digit in the
// trailing number-run because italic fonts misread "PLATINUM 5" as
// "PLATINUM 35".
// ──────────────────────────────────────────────────────────────────────────

func TestExtractRank(t *testing.T) {
	tests := []struct {
		name      string
		text      string
		wantRank  string
		wantLevel int
	}{
		{"plain platinum 5", "PLATINUM 5", "platinum", 5},
		{"mixed case", "Platinum 3", "platinum", 3},
		{"OCR adds leading digit (35 → 5)", "PLATINUM 35", "platinum", 5},
		{"gold 1", "gold 1", "gold", 1},
		{"diamond 4", "DIAMOND 4", "diamond", 4},
		{"unknown rank → empty", "WIZARD 7", "", 0},
		{"empty text", "", "", 0},
		{"rank without level digit", "PLATINUM", "platinum", 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotRank, gotLevel := extractRank(tc.text)
			if gotRank != tc.wantRank {
				t.Errorf("rank = %q, want %q", gotRank, tc.wantRank)
			}
			if gotLevel != tc.wantLevel {
				t.Errorf("level = %d, want %d", gotLevel, tc.wantLevel)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// extractModifiers — collects known modifier pills regardless of case.
// ──────────────────────────────────────────────────────────────────────────

func TestExtractModifiers(t *testing.T) {
	tests := []struct {
		name string
		text string
		want []string
	}{
		{
			name: "expected + victory",
			text: "EXPECTED VICTORY",
			want: []string{"expected", "victory"},
		},
		{
			// "unexpected" contains "expected" as a substring, and
			// extractModifiers uses substring search, so both match.
			// Listed in order of the knownModifiers slice.
			name: "single unexpected matches both expected + unexpected",
			text: "UNEXPECTED",
			want: []string{"expected", "unexpected"},
		},
		{
			name: "mixed case is normalized",
			text: "Expected Defeat",
			want: []string{"expected", "defeat"},
		},
		{
			name: "no known modifiers → nil",
			text: "asdf garbled",
			want: nil,
		},
		{
			name: "duplicates collapsed",
			text: "VICTORY victory VICTORY",
			want: []string{"victory"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractModifiers(tc.text)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// extractInts — generic integer extractor used in various card readers.
// ──────────────────────────────────────────────────────────────────────────

func TestExtractInts(t *testing.T) {
	tests := []struct {
		name string
		text string
		want []int
	}{
		{"single", "17", []int{17}},
		{"multiple", "17 5 3", []int{17, 5, 3}},
		{"mixed text", "ELIMINATIONS 17 ASSISTS 5", []int{17, 5}},
		// extractInts returns an empty slice (not nil) on no-match.
		{"no ints", "ELIMINATIONS", []int{}},
		{"empty", "", []int{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractInts(tc.text)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// extractHeroes — fuzzy match against the known hero list.
// ──────────────────────────────────────────────────────────────────────────

func TestExtractHeroes(t *testing.T) {
	tests := []struct {
		name string
		text string
		want []string
	}{
		{
			name: "single hero",
			text: "LUCIO",
			want: []string{"lucio"},
		},
		{
			// extractHeroes returns results in alphabetical order
			// (iteration over the heroRoles map, sorted internally).
			name: "mixed case (alphabetical output)",
			text: "Lucio Kiriko",
			want: []string{"kiriko", "lucio"},
		},
		{
			name: "no heroes",
			text: "garbled text",
			want: nil,
		},
		{
			name: "punctuation in hero name (D.Va)",
			text: "D.VA",
			want: []string{"d.va"},
		},
		{
			name: "multi-word hero (Wrecking Ball)",
			text: "WRECKING BALL",
			want: []string{"wrecking ball"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractHeroes(tc.text)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// extractSR — pulls (hero, SR, change) from the rank screen's panel OCR.
// Each hero detected gets the same first-4-digit SR + first signed integer
// after it. (Realistic OW2 has one hero per rank screen but the function
// generalizes.)
// ──────────────────────────────────────────────────────────────────────────

func TestExtractSR(t *testing.T) {
	t.Run("single hero with positive change", func(t *testing.T) {
		got := extractSR("LUCIO HERO SR 2754 +30")
		want := []HeroSR{{Hero: "lucio", SR: 2754, Change: 30}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("negative change", func(t *testing.T) {
		got := extractSR("LUCIO HERO SR 2700 -25")
		want := []HeroSR{{Hero: "lucio", SR: 2700, Change: -25}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("no heroes → nil", func(t *testing.T) {
		if got := extractSR("2754 +30"); got != nil {
			t.Errorf("expected nil for hero-less text, got %v", got)
		}
	})
}

// ──────────────────────────────────────────────────────────────────────────
// parseHeroesPlayed — slices the heroes column into per-hero blocks and
// extracts percent + play time. Heroes with 0% AND no play time are
// skipped (those are empty card slots).
// ──────────────────────────────────────────────────────────────────────────

func TestParseHeroesPlayed(t *testing.T) {
	t.Run("two heroes with percent + play time", func(t *testing.T) {
		text := `LUCIO
60%
6:30
KIRIKO
40%
4:30`
		got := parseHeroesPlayed(text)
		want := []HeroPlay{
			{Hero: "lucio", PercentPlayed: 60, PlayTime: "6:30"},
			{Hero: "kiriko", PercentPlayed: 40, PlayTime: "4:30"},
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("empty slot (0% no time) is dropped", func(t *testing.T) {
		text := `LUCIO
100%
11:25
KIRIKO
0%`
		got := parseHeroesPlayed(text)
		want := []HeroPlay{
			{Hero: "lucio", PercentPlayed: 100, PlayTime: "11:25"},
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("no heroes detected → nil", func(t *testing.T) {
		if got := parseHeroesPlayed("garbage 50% 1:23"); got != nil {
			t.Errorf("got %v, want nil", got)
		}
	})
}

// ──────────────────────────────────────────────────────────────────────────
// parsePerformance — pulls (total, avg-per-10-min) for each labeled
// performance card. Per parser.go:1023 the total is the LAST pure-integer
// line before the label, ignoring noise like "S 4" (skull-X icon misread).
// The avg is anchored on "MIN" so the "10" in "AVG PER 10 MIN" isn't
// picked up.
// ──────────────────────────────────────────────────────────────────────────

func TestParsePerformance(t *testing.T) {
	t.Run("clean three-stat performance card", func(t *testing.T) {
		text := `17
ELIMINATIONS
AVG PER 10 MIN: 14.5
16
ASSISTS
AVG PER 10 MIN: 13.0
11
DEATHS
AVG PER 10 MIN: 9.1`
		got := parsePerformance(text)
		if got == nil {
			t.Fatal("expected non-nil performance")
		}
		if got.Eliminations.Total != 17 || got.Eliminations.AvgPer10Min != 14.5 {
			t.Errorf("eliminations: %+v", got.Eliminations)
		}
		if got.Assists.Total != 16 || got.Assists.AvgPer10Min != 13.0 {
			t.Errorf("assists: %+v", got.Assists)
		}
		if got.Deaths.Total != 11 || got.Deaths.AvgPer10Min != 9.1 {
			t.Errorf("deaths: %+v", got.Deaths)
		}
	})

	t.Run("AVG PER 10 MIN does not steal the '10' as value", func(t *testing.T) {
		// If anchoring were wrong, the parser might capture "10" from
		// "AVG PER 10 MIN" as the avg value. Test asserts the real value.
		text := `17
ELIMINATIONS
AVG PER 10 MIN: 8.2`
		got := parsePerformance(text)
		if got == nil || got.Eliminations.AvgPer10Min != 8.2 {
			t.Errorf("expected 8.2, got %+v", got)
		}
	})

	t.Run("icon-noise lines before total are ignored", func(t *testing.T) {
		// Per parser.go:1023 — "S 4" (Tesseract's misread of the skull-X
		// icon next to "17") must be ignored; only the pure-integer line
		// "17" wins.
		text := `S 4
17
ELIMINATIONS`
		got := parsePerformance(text)
		if got == nil || got.Eliminations.Total != 17 {
			t.Errorf("expected total=17, got %+v", got)
		}
	})

	t.Run("missing labels → returns nil performance", func(t *testing.T) {
		// No ELIMINATIONS/ASSISTS/DEATHS labels detected → all zeros →
		// parsePerformance returns nil.
		if got := parsePerformance("just noise"); got != nil {
			t.Errorf("got %+v, want nil", got)
		}
	})
}

// ──────────────────────────────────────────────────────────────────────────
// parsePanelStats — extracts (value, label) pairs from the scoreboard's
// right-side panel OCR. Short noise lines between value and label (the
// orange tick mark Tesseract reads as a 1-3 letter run) are skipped.
// ──────────────────────────────────────────────────────────────────────────

func TestParsePanelStats(t *testing.T) {
	t.Run("clean two-card panel", func(t *testing.T) {
		text := `35
PLAYERS KNOCKED BACK
24
WEAPON ACCURACY`
		got := parsePanelStats(text)
		if got["players_knocked_back"] != 35 {
			t.Errorf("players_knocked_back: got %d, want 35", got["players_knocked_back"])
		}
		if got["weapon_accuracy"] != 24 {
			t.Errorf("weapon_accuracy: got %d, want 24", got["weapon_accuracy"])
		}
	})

	t.Run("short noise line between value and label is tolerated", func(t *testing.T) {
		text := `35
PP
PLAYERS KNOCKED BACK`
		got := parsePanelStats(text)
		if got["players_knocked_back"] != 35 {
			t.Errorf("expected 35, got %d", got["players_knocked_back"])
		}
	})

	t.Run("trailing %% on percent-suffixed value", func(t *testing.T) {
		text := `24%
WEAPON ACCURACY`
		got := parsePanelStats(text)
		if got["weapon_accuracy"] != 24 {
			t.Errorf("expected 24, got %d", got["weapon_accuracy"])
		}
	})

	t.Run("empty input → empty map", func(t *testing.T) {
		got := parsePanelStats("")
		if len(got) != 0 {
			t.Errorf("expected empty, got %v", got)
		}
	})
}

// ──────────────────────────────────────────────────────────────────────────
// parsePersonalStatCell — extracts (label_key, value) from one stat card
// on the PERSONAL tab's 3×3 grid. Icon noise like "PP 41%" should leave
// the value intact ("41") and recover the label.
// ──────────────────────────────────────────────────────────────────────────

func TestParsePersonalStatCell(t *testing.T) {
	t.Run("clean cell", func(t *testing.T) {
		key, val, ok := parsePersonalStatCell("41%\nWEAPON ACCURACY")
		if !ok || key != "weapon_accuracy" || val != 41 {
			t.Errorf("got (%q, %d, %v)", key, val, ok)
		}
	})

	t.Run("icon noise prefix is stripped", func(t *testing.T) {
		key, val, ok := parsePersonalStatCell("PP 41%\nWEAPON ACCURACY")
		if !ok || key != "weapon_accuracy" || val != 41 {
			t.Errorf("got (%q, %d, %v)", key, val, ok)
		}
	})

	t.Run("multi-word label", func(t *testing.T) {
		key, val, ok := parsePersonalStatCell("13\nSOUND BARRIERS PROVIDED")
		if !ok || key != "sound_barriers_provided" || val != 13 {
			t.Errorf("got (%q, %d, %v)", key, val, ok)
		}
	})

	t.Run("no label → not ok", func(t *testing.T) {
		_, _, ok := parsePersonalStatCell("41")
		if ok {
			t.Errorf("expected not-ok with no label")
		}
	})

	t.Run("no value → not ok", func(t *testing.T) {
		_, _, ok := parsePersonalStatCell("WEAPON ACCURACY")
		if ok {
			t.Errorf("expected not-ok with no value")
		}
	})
}

// ──────────────────────────────────────────────────────────────────────────
// extractHeader — pulls (map, gameType, mode) from the in-game banner.
// Map names are snapped to the knownMaps list via fuzzy match.
// ──────────────────────────────────────────────────────────────────────────

func TestExtractHeader(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		wantMap  string
		wantType string
		wantMode string
	}{
		{
			name:    "rialto control",
			text:    "RIALTO ESCORT COMPETITIVE",
			wantMap: "rialto",
		},
		{
			name:    "fuzzy map snap (RIALT0 with zero → rialto)",
			text:    "RIALT0",
			wantMap: "rialto",
		},
		{
			name:    "suravasa",
			text:    "SURAVASA CLASH COMPETITIVE",
			wantMap: "suravasa",
		},
		{
			name:    "no map detected",
			text:    "asdf garbled",
			wantMap: "",
		},
		{
			name:    "throne of anubis (multi-word)",
			text:    "THRONE OF ANUBIS",
			wantMap: "throne of anubis",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotMap, _, _ := extractHeader(tc.text)
			if gotMap != tc.wantMap {
				t.Errorf("map = %q, want %q", gotMap, tc.wantMap)
			}
		})
	}
}
