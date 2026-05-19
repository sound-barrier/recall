package app

import (
	"testing"

	"recall/pkg/parser"
)

// ──────────────────────────────────────────────────────────────────────────
// mergeMatchResult — first-non-empty-wins merge across screenshot types.
// ──────────────────────────────────────────────────────────────────────────

func TestMergeMatchResult_DisjointFields(t *testing.T) {
	// SUMMARY-only fields on the left, scoreboard-only on the right.
	// Merge should fill the union without overwriting anything.
	dst := &parser.MatchResult{
		Map:        "rialto",
		Result:     "victory",
		Date:       "2026-05-10",
		FinishedAt: "21:29",
	}
	src := &parser.MatchResult{
		Eliminations: 17,
		Assists:      16,
		Deaths:       11,
		Damage:       7200,
	}
	mergeMatchResult(dst, src)

	if dst.Map != "rialto" || dst.Result != "victory" {
		t.Errorf("SUMMARY fields lost: map=%q result=%q", dst.Map, dst.Result)
	}
	if dst.Eliminations != 17 || dst.Assists != 16 || dst.Deaths != 11 || dst.Damage != 7200 {
		t.Errorf("scoreboard fields not merged: %+v", dst)
	}
}

func TestMergeMatchResult_FirstNonEmptyWins(t *testing.T) {
	// dst already has values; src's competing values must not overwrite.
	dst := &parser.MatchResult{
		Map:          "rialto",
		Eliminations: 17,
		Result:       "victory",
	}
	src := &parser.MatchResult{
		Map:          "aatlis",  // should NOT overwrite
		Eliminations: 99,        // should NOT overwrite
		Result:       "defeat",  // should NOT overwrite
		Date:         "2026-05-10", // should fill (dst empty)
	}
	mergeMatchResult(dst, src)

	if dst.Map != "rialto" {
		t.Errorf("Map overwritten: got %q want rialto", dst.Map)
	}
	if dst.Eliminations != 17 {
		t.Errorf("Eliminations overwritten: got %d want 17", dst.Eliminations)
	}
	if dst.Result != "victory" {
		t.Errorf("Result overwritten: got %q want victory", dst.Result)
	}
	if dst.Date != "2026-05-10" {
		t.Errorf("Date not filled: got %q", dst.Date)
	}
}

func TestMergeMatchResult_HeroesPlayed_MergeByHeroName(t *testing.T) {
	// Per CLAUDE.md: heroes_played is keyed by hero name. A SUMMARY with
	// [lucio 60%, kiriko 40%] merged with a PERSONAL for lucio (no percent,
	// just stats) should preserve the 60% and add the stats.
	dst := &parser.MatchResult{
		HeroesPlayed: []parser.HeroPlay{
			{Hero: "lucio", PercentPlayed: 60, PlayTime: "06:00"},
			{Hero: "kiriko", PercentPlayed: 40, PlayTime: "04:00"},
		},
	}
	src := &parser.MatchResult{
		HeroesPlayed: []parser.HeroPlay{
			{Hero: "lucio", Stats: map[string]int{"weapon_accuracy": 24}},
		},
	}
	mergeMatchResult(dst, src)

	if len(dst.HeroesPlayed) != 2 {
		t.Fatalf("hero count changed: got %d want 2", len(dst.HeroesPlayed))
	}
	lucio := dst.HeroesPlayed[0]
	if lucio.Hero != "lucio" || lucio.PercentPlayed != 60 || lucio.PlayTime != "06:00" {
		t.Errorf("lucio metadata lost: %+v", lucio)
	}
	if lucio.Stats["weapon_accuracy"] != 24 {
		t.Errorf("lucio stats not merged: %+v", lucio.Stats)
	}
}

func TestMergeMatchResult_HeroesPlayed_AppendsNewHero(t *testing.T) {
	// src introduces a hero not in dst — should be appended.
	dst := &parser.MatchResult{
		HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", PercentPlayed: 100}},
	}
	src := &parser.MatchResult{
		HeroesPlayed: []parser.HeroPlay{{Hero: "kiriko", PercentPlayed: 0, Stats: map[string]int{"x": 1}}},
	}
	mergeMatchResult(dst, src)

	if len(dst.HeroesPlayed) != 2 {
		t.Fatalf("expected 2 heroes after merge, got %d", len(dst.HeroesPlayed))
	}
	if dst.HeroesPlayed[1].Hero != "kiriko" {
		t.Errorf("expected kiriko appended, got %+v", dst.HeroesPlayed)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// inferSoleHeroPercent — fills percent_played=100 for single-hero rows
// where no SUMMARY screenshot was captured.
// ──────────────────────────────────────────────────────────────────────────

func TestInferSoleHeroPercent(t *testing.T) {
	tests := []struct {
		name string
		in   []parser.HeroPlay
		want int
	}{
		{
			name: "scoreboard-only single hero → 100%",
			in:   []parser.HeroPlay{{Hero: "lucio"}},
			want: 100,
		},
		{
			name: "single hero with playtime is left alone",
			in:   []parser.HeroPlay{{Hero: "lucio", PlayTime: "11:25"}},
			want: 0,
		},
		{
			name: "single hero with explicit pct is left alone",
			in:   []parser.HeroPlay{{Hero: "lucio", PercentPlayed: 65}},
			want: 65,
		},
		{
			name: "multi-hero row untouched",
			in:   []parser.HeroPlay{{Hero: "lucio"}, {Hero: "kiriko", PercentPlayed: 40}},
			want: 0,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			d := &parser.MatchResult{HeroesPlayed: append([]parser.HeroPlay(nil), tc.in...)}
			inferSoleHeroPercent(d)
			if got := d.HeroesPlayed[0].PercentPlayed; got != tc.want {
				t.Fatalf("got %d want %d", got, tc.want)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// inferResultFromRank — fills Result from SR change sign when banner OCR
// missed.
// ──────────────────────────────────────────────────────────────────────────

func TestInferResultFromRank(t *testing.T) {
	tests := []struct {
		name string
		d    parser.MatchResult
		want string
	}{
		{
			name: "Result already set is left alone",
			d:    parser.MatchResult{Result: "victory", SR: []parser.HeroSR{{Change: -50}}},
			want: "victory",
		},
		{
			name: "Positive SR change → victory",
			d:    parser.MatchResult{SR: []parser.HeroSR{{Hero: "lucio", Change: 30}}},
			want: "victory",
		},
		{
			name: "Negative SR change → defeat",
			d:    parser.MatchResult{SR: []parser.HeroSR{{Hero: "lucio", Change: -25}}},
			want: "defeat",
		},
		{
			name: "Zero SR change → unchanged (ambiguous)",
			d:    parser.MatchResult{SR: []parser.HeroSR{{Hero: "lucio", Change: 0}}},
			want: "",
		},
		{
			name: "No SR entries → unchanged",
			d:    parser.MatchResult{},
			want: "",
		},
		{
			name: "First non-zero SR entry wins (mixed signs absurd but bounded)",
			d: parser.MatchResult{SR: []parser.HeroSR{
				{Hero: "lucio", Change: 0},
				{Hero: "kiriko", Change: 30},
			}},
			want: "victory",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			d := tc.d // copy
			inferResultFromRank(&d)
			if d.Result != tc.want {
				t.Fatalf("got %q want %q", d.Result, tc.want)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// screenshotType — classifies a single parsed result into one of four
// canonical screenshot types. Order matters: scoreboard MUST be checked
// before personal (a scoreboard parse populates both E/A/D and the right
// panel's hero stats).
// ──────────────────────────────────────────────────────────────────────────

func TestScreenshotType(t *testing.T) {
	tests := []struct {
		name string
		r    *parser.MatchResult
		want string
	}{
		{
			name: "nil → unknown",
			r:    nil,
			want: "unknown",
		},
		{
			name: "Rank populated → rank (highest priority)",
			r: &parser.MatchResult{
				Rank:         "platinum",
				Eliminations: 17, // scoreboard fields present too — rank still wins
				HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", Stats: map[string]int{"x": 1}}},
			},
			want: "rank",
		},
		{
			name: "Result+date → summary",
			r:    &parser.MatchResult{Result: "victory", Date: "2026-05-10"},
			want: "summary",
		},
		{
			name: "GameLength alone → summary (no other rank/eaD fields)",
			r:    &parser.MatchResult{GameLength: "11:25"},
			want: "summary",
		},
		{
			name: "Scoreboard with E/A/D AND panel hero stats → scoreboard (NOT personal)",
			r: &parser.MatchResult{
				Eliminations: 17,
				Assists:      16,
				Deaths:       11,
				HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", Stats: map[string]int{"weapon_accuracy": 24}}},
			},
			want: "scoreboard",
		},
		{
			name: "Hero stats only (no E/A/D) → personal",
			r: &parser.MatchResult{
				HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", Stats: map[string]int{"weapon_accuracy": 24}}},
			},
			want: "personal",
		},
		{
			name: "Damage only (no E/A/D ints, but Damage > 0) → scoreboard",
			r:    &parser.MatchResult{Damage: 7200},
			want: "scoreboard",
		},
		{
			name: "Empty MatchResult → unknown",
			r:    &parser.MatchResult{},
			want: "unknown",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := screenshotType(tc.r); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// mergeTypeMaps — unions two filename → type maps; non-empty values win.
// ──────────────────────────────────────────────────────────────────────────

func TestMergeTypeMaps(t *testing.T) {
	t.Run("both nil → nil", func(t *testing.T) {
		if got := mergeTypeMaps(nil, nil); got != nil {
			t.Fatalf("got %v want nil", got)
		}
	})
	t.Run("a alone is returned (copy)", func(t *testing.T) {
		a := map[string]string{"f1.png": "summary"}
		got := mergeTypeMaps(a, nil)
		if got["f1.png"] != "summary" || len(got) != 1 {
			t.Fatalf("got %v", got)
		}
	})
	t.Run("disjoint keys union", func(t *testing.T) {
		a := map[string]string{"f1.png": "summary"}
		b := map[string]string{"f2.png": "scoreboard"}
		got := mergeTypeMaps(a, b)
		if got["f1.png"] != "summary" || got["f2.png"] != "scoreboard" {
			t.Fatalf("got %v", got)
		}
	})
	t.Run("a value wins over b for same key", func(t *testing.T) {
		a := map[string]string{"f1.png": "summary"}
		b := map[string]string{"f1.png": "scoreboard"}
		got := mergeTypeMaps(a, b)
		if got["f1.png"] != "summary" {
			t.Fatalf("got %q want summary (a wins)", got["f1.png"])
		}
	})
	t.Run("empty a value loses to non-empty b value for same key", func(t *testing.T) {
		a := map[string]string{"f1.png": ""}
		b := map[string]string{"f1.png": "personal"}
		got := mergeTypeMaps(a, b)
		if got["f1.png"] != "personal" {
			t.Fatalf("got %q want personal (b fills the empty)", got["f1.png"])
		}
	})
}

// ──────────────────────────────────────────────────────────────────────────
// stringsConflict / intsConflict — both-non-zero-and-different.
// ──────────────────────────────────────────────────────────────────────────

func TestStringsConflict(t *testing.T) {
	tests := []struct {
		a, b string
		want bool
	}{
		{"", "", false},
		{"x", "", false},
		{"", "x", false},
		{"x", "x", false},
		{"x", "y", true},
	}
	for _, tc := range tests {
		if got := stringsConflict(tc.a, tc.b); got != tc.want {
			t.Errorf("stringsConflict(%q,%q) = %v want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestIntsConflict(t *testing.T) {
	tests := []struct {
		a, b int
		want bool
	}{
		{0, 0, false},
		{5, 0, false},
		{0, 5, false},
		{5, 5, false},
		{5, 7, true},
	}
	for _, tc := range tests {
		if got := intsConflict(tc.a, tc.b); got != tc.want {
			t.Errorf("intsConflict(%d,%d) = %v want %v", tc.a, tc.b, got, tc.want)
		}
	}
}
