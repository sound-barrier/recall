package parser_test

import (
	"reflect"
	"testing"

	"recall/pkg/parser"
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
		if got := parser.HeroRole(tc.hero); got != tc.want {
			t.Errorf("HeroRole(%q) = %q, want %q", tc.hero, got, tc.want)
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────
// digitize — fix letter↔digit OCR confusion in italic OW font.
// ──────────────────────────────────────────────────────────────────────────

func TestDigitize(t *testing.T) {
	// Per parser.Digitize behavior, the replacer maps:
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
		if got := parser.Digitize(tc.in); got != tc.want {
			t.Errorf("parser.Digitize(%q) = %q, want %q", tc.in, got, tc.want)
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
		if got := parser.NormalizeDate(tc.in); got != tc.want {
			t.Errorf("parser.NormalizeDate(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────
// extractRank — finds the OW tier name + level. Per the ExtractRank
// implementation/comments, the level extraction must pick the LAST digit in
// the trailing number-run because italic fonts misread "PLATINUM 5" as
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
		{"italic 1 OCRs as letter I (GOLD I → 1)", "GOLD I", "gold", 1},
		{"lowercase l as the level (GOLD l → 1)", "GOLD l", "gold", 1},
		{"diamond 4", "DIAMOND 4", "diamond", 4},
		// Fuzzy-snap garbled tiers (the #499 generalization lever): even when the
		// tier word is mis-OCR'd, it should resolve to the nearest known tier so
		// untested tiers (Bronze/Champion/Diamond) don't silently fail.
		{"GOLD garbled to GOD", "GOD 5", "gold", 5},
		{"PLATINUM garbled to PLATNUM", "PLATNUM 2", "platinum", 2},
		{"CHAMPION garbled to CHAMPON", "CHAMPON 3", "champion", 3},
		{"DIAMOND garbled to DAMOND", "DAMOND 1", "diamond", 1},
		{"BRONZE garbled to BRONZ", "BRONZ 4", "bronze", 4},
		{"unknown rank → empty", "WIZARD 7", "", 0},
		{"empty text", "", "", 0},
		{"rank without level digit", "PLATINUM", "platinum", 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotRank, gotLevel := parser.ExtractRank(tc.text)
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
			name: "uphill battle win (underdog who won)",
			text: "UPHILL BATTLE VICTORY",
			want: []string{"uphill battle", "victory"},
		},
		{
			name: "reversal loss (favoured who lost)",
			text: "REVERSAL DEFEAT",
			want: []string{"reversal", "defeat"},
		},
		{
			name: "consolation loss (underdog who lost)",
			text: "CONSOLATION DEFEAT",
			want: []string{"consolation", "defeat"},
		},
		{
			// Both end in "streak"; the full label keeps them distinct.
			name: "win streak stays distinct from loss streak",
			text: "WIN STREAK",
			want: []string{"win streak"},
		},
		{
			name: "calibration + volatile",
			text: "CALIBRATION VOLATILE",
			want: []string{"calibration", "volatile"},
		},
		{
			// Match-condition pills order before the result in knownModifiers.
			name: "new map + leaver compensation",
			text: "DEFEAT NEW MAP LEAVER COMPENSATION",
			want: []string{"new map", "leaver compensation", "defeat"},
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
			got := parser.ExtractModifiers(tc.text)
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
			got := parser.ExtractInts(tc.text)
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
		{
			// Regression: pre-fix, the Pass-2 fuzzy match slid "mei"
			// (len 3, threshold floor = 1) across "miyazaki" and
			// accepted the 1-edit window "miy" → "mei", silently
			// attributing every Miyazaki play to Mei. The
			// short-hero length-gate kills that class — heroes < 5
			// chars now require exact match. Confirms across the
			// other 3-/4-char heroes that share the same risk.
			name: "unknown hero name does not fuzzy-match a short known hero",
			text: "MIYAZAKI",
			want: nil,
		},
		{
			// Preserves the legitimate use of Pass 2: a single
			// Tesseract glyph slip on a long hero (Junkrat: 7 chars,
			// threshold 1 under both old and new formulas) still
			// recovers the canonical name.
			name: "long hero with 1-letter OCR mistake still resolves",
			text: "JUMKRAT",
			want: []string{"junkrat"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := parser.ExtractHeroes(tc.text)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// extractSR — pulls (hero, SR, change) from the rank screen's panel OCR.
// Each hero detected gets the same first-4-digit SR + first signed integer
// after it. (Realistic OW has one hero per rank screen but the function
// generalizes.)
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// snapToKnownMap + bestKnownMapInText — fuzzy match against the known
// map list. Mirrors the heroes contract: short OOV strings stay OOV,
// genuine OCR slips on known maps still recover.
// ──────────────────────────────────────────────────────────────────────────

func TestSnapToKnownMap(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{"exact-after-normalize", "RIALTO", "rialto"},
		{"one-letter OCR slip", "JUNKERTQWN", "junkertown"},
		// An unknown short map-like string must NOT collapse to a
		// real map. Pre-fix the 40% threshold made many short
		// strings snap; the 15% gate + length floor blocks it.
		{"unknown OOV stays OOV", "ZULU", "ZULU"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := parser.SnapToKnownMap(tc.in); got != tc.want {
				t.Errorf("parser.SnapToKnownMap(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestBestKnownMapInText(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{
			name: "map name embedded in garbled header",
			in:   "© HYBRID - COMPETITIVE] HOLLYWOOD [/MF'7:/]5",
			want: "hollywood",
		},
		{
			// A brand-new unknown map name must not be snapped to a
			// short known map. Pre-fix, a 5-char OOV string could
			// slide into a 5-char window of e.g. "ilios" with a
			// 30%/floor-1 threshold and match.
			name: "unknown map text does not snap to short known map",
			in:   "BRAND NEW UNKNOWN MAP",
			want: "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := parser.BestKnownMapInText(tc.in); got != tc.want {
				t.Errorf("parser.BestKnownMapInText(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestExtractSR(t *testing.T) {
	t.Run("single hero with change", func(t *testing.T) {
		got := parser.ExtractSR("LUCIO HERO SR 2754 +30")
		want := []parser.HeroSR{{Hero: "lucio", SR: 2754, Change: 30}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	// The card shows the change as a coloured arrow, not a sign, so extractSR
	// returns the magnitude; parseRank applies the direction from the match
	// result. A stray "-" in the OCR therefore doesn't flip the sign here.
	t.Run("change is a magnitude (sign comes from the result)", func(t *testing.T) {
		got := parser.ExtractSR("LUCIO HERO SR 2700 -25")
		want := []parser.HeroSR{{Hero: "lucio", SR: 2700, Change: 25}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	// Regression: the panel stacks one card per hero, each with its OWN SR. The
	// old code grabbed the first 4-digit run in the whole blob and copied it onto
	// every hero, so two cards reported one (wrong) SR.
	t.Run("two cards get distinct SRs, not the first repeated", func(t *testing.T) {
		got := parser.ExtractSR("BRIGITTE SR 2778 ^102\nANA SR 1896 ^8")
		want := []parser.HeroSR{
			{Hero: "brigitte", SR: 2778, Change: 102},
			{Hero: "ana", SR: 1896, Change: 8},
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	// digitize recovers the SR's letter-shaped digits (O/Q/I/l/L) but must not
	// mint a phantom change out of the card's stray trailing letters.
	t.Run("digit-lookalike SR recovered, trailing letters are not a change", func(t *testing.T) {
		got := parser.ExtractSR("KIRIKO SR 17O0 Le")
		want := []parser.HeroSR{{Hero: "kiriko", SR: 1700, Change: 0}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("no heroes → nil", func(t *testing.T) {
		if got := parser.ExtractSR("2754 +30"); got != nil {
			t.Errorf("expected nil for hero-less text, got %v", got)
		}
	})
}

// srFromRun reduces an OCR digit run to a plausible SR, dropping a stray edge
// digit from a 5-digit run but refusing to guess when a merge is ambiguous.
func TestSRFromRun(t *testing.T) {
	cases := []struct {
		run  string
		want int
	}{
		{"2754", 2754},  // clean 4-digit
		{"500", 0},      // too short
		{"0500", 0},     // 4-digit but below the 1000 floor
		{"91777", 1777}, // 5-digit: leading change-arrow digit dropped
		{"02144", 2144}, // 5-digit: leading icon digit dropped
		{"21579", 0},    // 5-digit merge: both edge-drops in range → ambiguous, reject
		{"123456", 0},   // 6-digit, out of scope
	}
	for _, c := range cases {
		if got := parser.SRFromRun(c.run); got != c.want {
			t.Errorf("SRFromRun(%q) = %d, want %d", c.run, got, c.want)
		}
	}
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
		got := parser.ParseHeroesPlayed(text)
		want := []parser.HeroPlay{
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
		got := parser.ParseHeroesPlayed(text)
		want := []parser.HeroPlay{
			{Hero: "lucio", PercentPlayed: 100, PlayTime: "11:25"},
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("no heroes detected → nil", func(t *testing.T) {
		if got := parser.ParseHeroesPlayed("garbage 50% 1:23"); got != nil {
			t.Errorf("got %v, want nil", got)
		}
	})
}

// ──────────────────────────────────────────────────────────────────────────
// parsePerformance — pulls (total, avg-per-10-min) for each labeled
// performance card. Per parsePerformance, the total is the LAST pure-integer
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
		got := parser.ParsePerformance(text)
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
		got := parser.ParsePerformance(text)
		if got == nil || got.Eliminations.AvgPer10Min != 8.2 {
			t.Errorf("expected 8.2, got %+v", got)
		}
	})

	t.Run("icon-noise lines before total are ignored", func(t *testing.T) {
		// Per ParsePerformance's OCR-noise handling, "S 4" (Tesseract's
		// misread of the skull-X icon next to "17") must be ignored; only
		// the pure-integer line "17" wins.
		text := `S 4
17
ELIMINATIONS`
		got := parser.ParsePerformance(text)
		if got == nil || got.Eliminations.Total != 17 {
			t.Errorf("expected total=17, got %+v", got)
		}
	})

	t.Run("missing labels → returns nil performance", func(t *testing.T) {
		// No ELIMINATIONS/ASSISTS/DEATHS labels detected → all zeros →
		// parsePerformance returns nil.
		if got := parser.ParsePerformance("just noise"); got != nil {
			t.Errorf("got %+v, want nil", got)
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
		key, val, ok := parser.ParsePersonalStatCell("41%\nWEAPON ACCURACY", 0)
		if !ok || key != "weapon_accuracy" || val != 41 {
			t.Errorf("got (%q, %d, %v)", key, val, ok)
		}
	})

	t.Run("icon noise prefix is stripped", func(t *testing.T) {
		key, val, ok := parser.ParsePersonalStatCell("PP 41%\nWEAPON ACCURACY", 0)
		if !ok || key != "weapon_accuracy" || val != 41 {
			t.Errorf("got (%q, %d, %v)", key, val, ok)
		}
	})

	t.Run("multi-word label", func(t *testing.T) {
		key, val, ok := parser.ParsePersonalStatCell("13\nSOUND BARRIERS PROVIDED", 0)
		if !ok || key != "sound_barriers_provided" || val != 13 {
			t.Errorf("got (%q, %d, %v)", key, val, ok)
		}
	})

	t.Run("no label → not ok", func(t *testing.T) {
		_, _, ok := parser.ParsePersonalStatCell("41", 0)
		if ok {
			t.Errorf("expected not-ok with no label")
		}
	})

	t.Run("no value → not ok", func(t *testing.T) {
		_, _, ok := parser.ParsePersonalStatCell("WEAPON ACCURACY", 0)
		if ok {
			t.Errorf("expected not-ok with no value")
		}
	})
}

// TestParsePersonalStatCell_AvgAnchorsValue covers icon-noise disambiguation:
// a hero-ability icon OCRs as a spurious single digit whose position relative
// to the real value varies (leading OR trailing), so the value is anchored on
// AVG-per-10-min × play-time. Texts are the real OCR from the Wuyang / Juno /
// Mizuki PERSONAL fixtures.
func TestParsePersonalStatCell_AvgAnchorsValue(t *testing.T) {
	cases := []struct {
		name    string
		text    string
		playMin float64
		wantVal int
	}{
		{ // "5 PLAYERS SAVED" — icon noise "4" LEADS the real "5".
			name: "leading icon digit", playMin: 3.5, wantVal: 5,
			text: "® y 4 5\n-@- PLAYERS SAVED\nAVG PER 10 MIN: 14.26",
		},
		{ // "2 ORBITAL RAY ASSISTS" — noise "4" TRAILS (NEW CAREER BEST).
			name: "trailing icon digit", playMin: 9.13, wantVal: 2,
			text: "2\nORBITAL RAY ASSISTS\nAVG PER 10 MIN: 2.19\n4\nNEW CAREER BEST!",
		},
		{ // "1 PLAYER SAVED" — noise "8" sits between the value and label.
			name: "noise between value and label", playMin: 4.4, wantVal: 1,
			text: "1\n8\nPLAYER SAVED\nAVG PER 10 MIN: 2.27",
		},
		{ // "0 TIDAL BLAST KILLS" — no AVG on a zero card; the clean "0"
			// wins a cross-pass vote against the icon misread "4".
			name: "zero value, no avg, cross-pass vote", playMin: 3.5, wantVal: 0,
			text: "M4 o\nTIDAL BLAST KILLS\nPed 0\nTIDAL BLAST KILLS\n0\nTIDAL BLAST KILLS",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, val, ok := parser.ParsePersonalStatCell(c.text, c.playMin)
			if !ok {
				t.Fatalf("expected ok for %q", c.text)
			}
			if val != c.wantVal {
				t.Errorf("val = %d, want %d", val, c.wantVal)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// SnapHeroStatKey — corrects OCR mangling of per-hero stat-key names by
// snapping to the canonical list in hero_stats.yaml.
// ──────────────────────────────────────────────────────────────────────────

func TestSnapHeroStatKey(t *testing.T) {
	cases := []struct {
		name, hero, raw, want string
	}{
		// Exact canonical → returned unchanged.
		{"exact match (juno)", "juno", "orbital_ray_assists", "orbital_ray_assists"},
		// Real-world OCR mangling captured from a production parse.
		{"icon noise (juno orbital)", "juno", "ooorsitall_ray_assists", "orbital_ray_assists"},
		// Dropped trailing 's' on a label — Tesseract eats final S sometimes.
		{"dropped final s (mizuki)", "mizuki", "player_saved", "players_saved"},
		// No canonical for this hero — pass through.
		{"unknown hero", "kiriko", "anything_garbled", "anything_garbled"},
		// Too far from any canonical (>40% distance) — pass through.
		{"too far from canonical", "juno", "asdfghjkl", "asdfghjkl"},
		// Empty input → empty (no canonical to snap to).
		{"empty input", "juno", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parser.SnapHeroStatKey(tc.hero, tc.raw); got != tc.want {
				t.Errorf("SnapHeroStatKey(%q, %q) = %q, want %q", tc.hero, tc.raw, got, tc.want)
			}
		})
	}
}
