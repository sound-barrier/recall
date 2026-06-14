package correlate_test

import (
	"testing"
	"time"

	"recall/pkg/correlate"
	"recall/pkg/db"
	"recall/pkg/parser"
)

// ──────────────────────────────────────────────────────────────────
// firstNonEmpty / stringsConflict / intsConflict — pure predicates.
// ──────────────────────────────────────────────────────────────────

func TestFirstNonEmpty(t *testing.T) {
	if got := correlate.FirstNonEmpty("a", "b"); got != "a" {
		t.Errorf("first non-empty wins: got %q", got)
	}
	if got := correlate.FirstNonEmpty("", "b"); got != "b" {
		t.Errorf("zero-value falls through: got %q", got)
	}
	if got := correlate.FirstNonEmpty(0, 7); got != 7 {
		t.Errorf("int zero falls through: got %d", got)
	}
}

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
		if got := correlate.StringsConflict(tc.a, tc.b); got != tc.want {
			t.Errorf("correlate.StringsConflict(%q, %q) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestIntsConflict(t *testing.T) {
	if correlate.IntsConflict(0, 0) || correlate.IntsConflict(0, 5) || correlate.IntsConflict(5, 0) || correlate.IntsConflict(5, 5) {
		t.Error("zero or matching ints must not conflict")
	}
	if !correlate.IntsConflict(5, 6) {
		t.Error("differing non-zero ints must conflict")
	}
}

// ──────────────────────────────────────────────────────────────────
// parseFilenameTimestamp — extracts OW filename timestamp.
// ──────────────────────────────────────────────────────────────────

func TestParseFilenameTimestamp(t *testing.T) {
	ts, ok := correlate.ParseFilenameTimestamp("Overwatch 2 Screenshot 2026.05.10 - 21.29.28.04.png")
	if !ok {
		t.Fatal("expected parse to succeed")
	}
	if ts.Year() != 2026 || ts.Month() != time.May || ts.Day() != 10 ||
		ts.Hour() != 21 || ts.Minute() != 29 || ts.Second() != 28 {
		t.Errorf("wrong timestamp parsed: %v", ts)
	}
	if _, ok := correlate.ParseFilenameTimestamp("manually_renamed.png"); ok {
		t.Error("expected non-timestamped filename to return ok=false")
	}
}

// ──────────────────────────────────────────────────────────────────
// mergeMatchResult — precedence rules now invoked from the aggregator.
// ──────────────────────────────────────────────────────────────────

func TestMergeMatchResult_DisjointFields(t *testing.T) {
	dst := &parser.MatchResult{Map: "rialto", Result: "victory"}
	src := &parser.MatchResult{Eliminations: 17, Damage: 7200}
	correlate.MergeMatchResult(dst, src)
	if dst.Map != "rialto" || dst.Result != "victory" {
		t.Error("disjoint dst fields clobbered")
	}
	if dst.Eliminations != 17 || dst.Damage != 7200 {
		t.Error("src fields not folded in")
	}
}

func TestMergeMatchResult_FirstNonEmptyWins(t *testing.T) {
	dst := &parser.MatchResult{Map: "rialto", Eliminations: 17, Result: "victory"}
	src := &parser.MatchResult{Map: "aatlis", Eliminations: 99, Result: "defeat", Date: "2026-05-10"}
	correlate.MergeMatchResult(dst, src)
	if dst.Map != "rialto" || dst.Eliminations != 17 || dst.Result != "victory" {
		t.Errorf("first-non-empty rule broken: %+v", dst)
	}
	if dst.Date != "2026-05-10" {
		t.Errorf("empty dst field not filled from src: %q", dst.Date)
	}
}

func TestMergeMatchResult_HeroesPlayed_MergeByHeroName(t *testing.T) {
	dst := &parser.MatchResult{HeroesPlayed: []parser.HeroPlay{
		{Hero: "lucio", PercentPlayed: 60, PlayTime: "06:00"},
		{Hero: "kiriko", PercentPlayed: 40, PlayTime: "04:00"},
	}}
	src := &parser.MatchResult{HeroesPlayed: []parser.HeroPlay{
		{Hero: "lucio", Stats: map[string]int{"weapon_accuracy": 24}},
	}}
	correlate.MergeMatchResult(dst, src)
	if len(dst.HeroesPlayed) != 2 {
		t.Fatalf("hero count changed: got %d", len(dst.HeroesPlayed))
	}
	lucio := dst.HeroesPlayed[0]
	if lucio.PercentPlayed != 60 || lucio.PlayTime != "06:00" {
		t.Errorf("lucio metadata lost: %+v", lucio)
	}
	if lucio.Stats["weapon_accuracy"] != 24 {
		t.Errorf("lucio stats not folded: %+v", lucio.Stats)
	}
}

func TestMergeMatchResult_SR_MergeByHero(t *testing.T) {
	dst := &parser.MatchResult{SR: []parser.HeroSR{{Hero: "juno", SR: 2867}}}
	src := &parser.MatchResult{SR: []parser.HeroSR{
		{Hero: "juno", Change: 22},
		{Hero: "lucio", SR: 3200, Change: 30},
	}}
	correlate.MergeMatchResult(dst, src)
	if len(dst.SR) != 2 {
		t.Fatalf("expected 2 SR rows after merge, got %d", len(dst.SR))
	}
	if dst.SR[0].SR != 2867 || dst.SR[0].Change != 22 {
		t.Errorf("juno SR fold broken: %+v", dst.SR[0])
	}
}

// ──────────────────────────────────────────────────────────────────
// rowsConflict — signature predicates.
// ──────────────────────────────────────────────────────────────────

func TestRowsConflict(t *testing.T) {
	base := &parser.MatchResult{Map: "rialto", Date: "2026-05-10", FinishedAt: "21:29"}
	tests := []struct {
		name string
		b    *parser.MatchResult
		want bool
	}{
		{"compatible (one empty)", &parser.MatchResult{Map: "rialto"}, false},
		{"map conflict", &parser.MatchResult{Map: "aatlis"}, true},
		{"date conflict", &parser.MatchResult{Date: "2026-05-11"}, true},
		{"finished_at conflict", &parser.MatchResult{FinishedAt: "22:00"}, true},
		{"E/A/D conflict", &parser.MatchResult{Eliminations: 5}, false}, // base zeroes
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := correlate.RowsConflict(base, tc.b, nil); got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────
// unionSortedStrings — set-union with stable sort.
// ──────────────────────────────────────────────────────────────────

func TestUnionSortedStrings(t *testing.T) {
	got := correlate.UnionSortedStrings([]string{"b", "a", "c"}, []string{"c", "d"})
	want := []string{"a", "b", "c", "d"}
	if len(got) != len(want) {
		t.Fatalf("got %v want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
}

// ──────────────────────────────────────────────────────────────────
// resolveMatchKey — the new correlation pass.
// ──────────────────────────────────────────────────────────────────

func TestResolveMatchKey_AdoptsByEADSignature(t *testing.T) {
	// Existing teams row with E/A/D=17/16/11, no map conflict.
	// New SUMMARY arrives ~3 min later with the same E/A/D — must
	// adopt the existing match_key via the auto-adopt EAD-bridge
	// window (<5 min).
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.29.28 _sb.png",
			MatchKey:     "match-2026-05-10T21-29-28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	newR := &parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11, Map: "rialto"}
	key, cands := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.32.30 _summary.png", newR, snap)
	if key != "match-2026-05-10T21-29-28" {
		t.Errorf("expected EAD-bridge adoption, got %q", key)
	}
	if cands != nil {
		t.Errorf("expected no candidates on auto-adopt, got %+v", cands)
	}
}

func TestResolveMatchKey_AdoptsByTimestampWindow(t *testing.T) {
	// Existing SUMMARY at 21:29:28. New PERSONAL (no E/A/D) arrives 13s
	// later. Must adopt the SUMMARY's key via the timestamp-window rule.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.29.28 _sum.png",
			MatchKey: "match-2026-05-10T21-29-28",
			Map:      "rialto",
		}},
	}
	newR := &parser.MatchResult{Hero: "lucio"}
	key, _ := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.29.41 _personal.png", newR, snap)
	if key != "match-2026-05-10T21-29-28" {
		t.Errorf("expected timestamp-window adoption, got %q", key)
	}
}

func TestResolveMatchKey_RejectsConflictingWindowMatch(t *testing.T) {
	// Within window but map disagrees — must NOT adopt.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.29.28 .png",
			MatchKey: "match-2026-05-10T21-29-28",
			Map:      "rialto",
		}},
	}
	newR := &parser.MatchResult{Map: "aatlis"}
	key, _ := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.29.41 .png", newR, snap)
	if key == "match-2026-05-10T21-29-28" {
		t.Errorf("expected conflict to block adoption, got %q", key)
	}
	if key != "match-2026-05-10T21-29-41" {
		t.Errorf("expected fresh key minted from new filename ts, got %q", key)
	}
}

func TestResolveMatchKey_TiebreakClosestInTime(t *testing.T) {
	// Two SUMMARY screens in window: one at 21:29:28 (rialto), one at 21:30:00.
	// New PERSONAL at 21:29:31 (3s after first, 29s before second) must
	// land on the closer (first) SUMMARY's key.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{
			{Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.29.28 _a.png", MatchKey: "match-A"},
			{Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.30.00 _b.png", MatchKey: "match-B"},
		},
	}
	newR := &parser.MatchResult{Hero: "lucio"}
	key, _ := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.29.31 _p.png", newR, snap)
	if key != "match-A" {
		t.Errorf("expected closer match (A) to win tiebreak, got %q", key)
	}
}

func TestResolveMatchKey_FreshKeyForUntimestamped(t *testing.T) {
	snap := db.Screenshots{}
	key, _ := correlate.ResolveMatchKey("manually_renamed.png", &parser.MatchResult{Hero: "lucio"}, snap)
	if key != "unmatched-manually_renamed.png" {
		t.Errorf("expected unmatched: prefix, got %q", key)
	}
}

func TestResolveMatchKey_FreshKeyForTimestampedNoCandidates(t *testing.T) {
	snap := db.Screenshots{}
	key, _ := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.29.28 .png", &parser.MatchResult{Hero: "lucio"}, snap)
	if key != "match-2026-05-10T21-29-28" {
		t.Errorf("expected match:<ts> from filename, got %q", key)
	}
}
