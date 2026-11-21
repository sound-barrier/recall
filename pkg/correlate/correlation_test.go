package correlate_test

import (
	"image"
	"testing"
	"time"

	"recall/pkg/correlate"
	"recall/pkg/db"
	"recall/pkg/match"
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
		{Hero: "juno", Change: new(22)},
		{Hero: "lucio", SR: 3200, Change: new(30)},
	}}
	correlate.MergeMatchResult(dst, src)
	if len(dst.SR) != 2 {
		t.Fatalf("expected 2 SR rows after merge, got %d", len(dst.SR))
	}
	if dst.SR[0].SR != 2867 || dst.SR[0].Change == nil || *dst.SR[0].Change != 22 {
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
	want := match.NewUnmatchedMatchKey("manually_renamed.png").String()
	if key != want {
		t.Errorf("got %q, want %q (URL-safe encoded unmatched key)", key, want)
	}
}

func TestResolveMatchKey_FreshKeyForTimestampedNoCandidates(t *testing.T) {
	snap := db.Screenshots{}
	key, _ := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.29.28 .png", &parser.MatchResult{Hero: "lucio"}, snap)
	if key != "match-2026-05-10T21-29-28" {
		t.Errorf("expected match:<ts> from filename, got %q", key)
	}
}

// ──────────────────────────────────────────────────────────────────
// Grouping past a SUMMARY total its own rate disowns.
// ──────────────────────────────────────────────────────────────────

const (
	misreadSummaryFile = "Overwatch 2 Screenshot 2026.05.10 - 21.29.28 _sum.png"
	misreadSummaryKey  = "match-2026-05-10T21-29-28"
)

// misreadSummaryRow is the anchor misread as stored: 74 eliminations where
// the card's own 12.97 per 10 minutes over 06:56 says 9. Assists and deaths
// agree with their rates, which is what proves the 74 the misread rather
// than the play time.
func misreadSummaryRow(elimRate float64) db.SummaryRow {
	return db.SummaryRow{
		Filename: misreadSummaryFile, MatchKey: misreadSummaryKey,
		Hero: "lucio", Result: "victory", GameLength: "15:45",
		Eliminations: 74, Assists: 10, Deaths: 5,
		PerfElimAvgPer10Min: elimRate, PerfAssistsAvgPer10Min: 14.41, PerfDeathsAvgPer10Min: 7.21,
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100, PlayTime: "06:56"}},
	}
}

// scoreboardReading is the TEAMS shot of the same match, which read the
// eliminations right.
func scoreboardReading() *parser.MatchResult {
	return &parser.MatchResult{Eliminations: 9, Assists: 10, Deaths: 5, Damage: 5200}
}

// summaryReading is the anchor SUMMARY as a parse reads it, with the
// eliminations total given and every card's rate as printed.
func summaryReading(eliminations int) *parser.MatchResult {
	return &parser.MatchResult{
		Hero: "lucio", Result: "victory", GameLength: "15:45",
		Eliminations: eliminations, Assists: 10, Deaths: 5,
		HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", PercentPlayed: 100, PlayTime: "06:56"}},
		Performance: &parser.Performance{
			Eliminations: parser.PerformanceStat{AvgPer10Min: 12.97},
			Assists:      parser.PerformanceStat{AvgPer10Min: 14.41},
			Deaths:       parser.PerformanceStat{AvgPer10Min: 7.21},
		},
	}
}

// TestResolveMatchKey_ScoreboardJoinsAMisreadSummary: the SUMMARY's own
// rate disowns its 74, so the scoreboard reading 9 a minute later, inside
// the merge window, is the same match, not a conflict.
func TestResolveMatchKey_ScoreboardJoinsAMisreadSummary(t *testing.T) {
	snap := db.Screenshots{Summaries: []db.SummaryRow{misreadSummaryRow(12.97)}}
	key, cands := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.30.28 _sb.png", scoreboardReading(), snap)
	if key != misreadSummaryKey || cands != nil {
		t.Errorf("got key %q cands %+v, want the SUMMARY's key %q", key, cands, misreadSummaryKey)
	}
}

// TestResolveMatchKey_MisreadSummaryJoinsItsScoreboard is the other arrival
// order, and the reading the SUMMARY's row will store stays the 74 it read:
// only the comparison leaves the disowned total unknown.
func TestResolveMatchKey_MisreadSummaryJoinsItsScoreboard(t *testing.T) {
	snap := db.Screenshots{Teams: []db.TeamsRow{{
		Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.28.28 _sb.png", MatchKey: "match-2026-05-10T21-28-28",
		Eliminations: 9, Assists: 10, Deaths: 5, Damage: 5200,
	}}}
	summary := summaryReading(74)
	key, _ := correlate.ResolveMatchKey(misreadSummaryFile, summary, snap)
	if key != "match-2026-05-10T21-28-28" {
		t.Errorf("got key %q, want the scoreboard's key", key)
	}
	if summary.Eliminations != 74 {
		t.Errorf("stored eliminations = %d, want the 74 as read", summary.Eliminations)
	}
}

// TestResolveMatchKey_GenuineSummaryTotalStillSplits: a 74 its own rate
// agrees with is a reading, not a misread, so a scoreboard reading 9 is a
// different match.
func TestResolveMatchKey_GenuineSummaryTotalStillSplits(t *testing.T) {
	snap := db.Screenshots{Summaries: []db.SummaryRow{misreadSummaryRow(106.73)}}
	key, _ := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.30.28 _sb.png", scoreboardReading(), snap)
	if key == misreadSummaryKey {
		t.Errorf("a consistent 74 joined a scoreboard reading 9 (key %q)", key)
	}
}

// TestResolveMatchKey_UnprovenMismatchStillSplits: when every card disagrees
// with the play time it is the play time the check blames, so no total is
// proven misread and the mismatch splits as it always has.
func TestResolveMatchKey_UnprovenMismatchStillSplits(t *testing.T) {
	row := misreadSummaryRow(12.97)
	row.Eliminations, row.Assists, row.Deaths = 20, 30, 10
	row.PerfElimAvgPer10Min, row.PerfAssistsAvgPer10Min, row.PerfDeathsAvgPer10Min = 10, 15, 5
	row.HeroesPlayed[0].PlayTime = "05:00"
	snap := db.Screenshots{Summaries: []db.SummaryRow{row}}
	derived := &parser.MatchResult{Eliminations: 5, Assists: 8, Deaths: 3, Damage: 5200}
	key, _ := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.30.28 _sb.png", derived, snap)
	if key == misreadSummaryKey {
		t.Errorf("an unproven mismatch joined the SUMMARY (key %q)", key)
	}
}

// TestResolveMatchKey_ProofReadsTheStoredEvidence: an assists total the
// pixels read as 0 is a reading the rate disagrees with too. With two cards
// off and none agreeing the check blames the play time, so the 74 is not
// proven a misread, and the scoreboard's 9 still splits. Without the
// evidence the 0 would be no reading and the proof would wrongly stand.
func TestResolveMatchKey_ProofReadsTheStoredEvidence(t *testing.T) {
	row := misreadSummaryRow(12.97)
	row.Assists, row.Deaths, row.PerfDeathsAvgPer10Min = 0, 0, 0
	assistsRead := parser.FieldEvidence{Field: parser.ScalarPath("assists"), Rect: image.Rect(10, 10, 40, 30)}
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{row},
		FieldEvidence: map[db.FileRef]db.ScreenshotEvidence{
			db.FileRef{Filename: misreadSummaryFile}.Filed(): {Fields: []parser.FieldEvidence{assistsRead}},
		},
	}
	key, _ := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.30.28 _sb.png", scoreboardReading(), snap)
	if key == misreadSummaryKey {
		t.Errorf("the 74 was taken as proven misread despite the assists reading (key %q)", key)
	}
}

// TestMatchByEAD_FingerprintsWhatWasRead: a total the rate disowns is no
// fingerprint, read or derived, so a scoreboard 20 minutes on is not
// bridged to the misread SUMMARY at all. The rate's total is arithmetic
// over two more readings, either of which can be the misread one.
func TestMatchByEAD_FingerprintsWhatWasRead(t *testing.T) {
	snap := db.Screenshots{Summaries: []db.SummaryRow{misreadSummaryRow(12.97)}}
	cand := correlate.CandidateFromParse("Overwatch 2 Screenshot 2026.05.10 - 21.49.28 _sb.png", scoreboardReading())
	if key, cands, ok := correlate.MatchByEAD(cand, snap); ok {
		t.Errorf("got key %q cands %+v, want no bridge on a disowned total", key, cands)
	}
}

const splitScoreboardKey = "match-2026-05-10T21-30-28"

// staleSplit is the store before a re-parse: the misread SUMMARY and its
// scoreboard filed under two keys.
func staleSplit() db.Screenshots {
	return db.Screenshots{
		Summaries: []db.SummaryRow{misreadSummaryRow(12.97)},
		Teams: []db.TeamsRow{{
			Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.30.28 _sb.png", MatchKey: splitScoreboardKey,
			Eliminations: 9, Assists: 10, Deaths: 5, Damage: 5200,
		}},
	}
}

// TestResolveMatchKey_ReParseHealsAStaleSplit: Re-parse All correlates each
// file against a snapshot that still holds every old row, its own included.
// The SUMMARY now reads its 9, and in either order both files land on one
// key, not in the ambiguous queue: the stale row's disowned 74 must not
// become a second 9/10/5 fingerprint.
func TestResolveMatchKey_ReParseHealsAStaleSplit(t *testing.T) {
	t.Run("scoreboard first", func(t *testing.T) {
		snap := staleSplit()
		key, cands := correlate.ResolveMatchKey(snap.Teams[0].Filename, scoreboardReading(), snap)
		requireKey(t, key, cands, splitScoreboardKey)
		key, cands = correlate.ResolveMatchKey(misreadSummaryFile, summaryReading(9), snap)
		requireKey(t, key, cands, splitScoreboardKey)
	})
	t.Run("summary first", func(t *testing.T) {
		snap := staleSplit()
		key, cands := correlate.ResolveMatchKey(misreadSummaryFile, summaryReading(9), snap)
		requireKey(t, key, cands, splitScoreboardKey)
		snap.Summaries[0].MatchKey, snap.Summaries[0].Eliminations = key, 9
		key, cands = correlate.ResolveMatchKey(snap.Teams[0].Filename, scoreboardReading(), snap)
		requireKey(t, key, cands, splitScoreboardKey)
	})
}

func requireKey(t *testing.T, key string, cands []db.AmbiguousCandidate, want string) {
	t.Helper()
	if key != want || cands != nil {
		t.Fatalf("got key %q cands %+v, want %q", key, cands, want)
	}
}

// TestResolveMatchKey_MisreadRateKeepsACorrectTotal: when it is the rate
// the OCR misread (12.97 read as 1297), the check condemns a total the
// screen printed right. That total must still group: a scoreboard reading
// the same 9/10/5 three minutes on, past the merge window, still bridges.
func TestResolveMatchKey_MisreadRateKeepsACorrectTotal(t *testing.T) {
	row := misreadSummaryRow(1297)
	row.Eliminations = 9
	snap := db.Screenshots{Summaries: []db.SummaryRow{row}}
	key, cands := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.32.28 _sb.png", scoreboardReading(), snap)
	requireKey(t, key, cands, misreadSummaryKey)
}

// TestResolveMatchKey_MisreadPlayTimeKeepsACorrectTotal: with one card's
// rate the only one read, nothing corroborates the play time, so a misread
// 36:56 condemns the 9 the screen printed. It must not split the SUMMARY
// from a scoreboard reading 9 a minute later.
func TestResolveMatchKey_MisreadPlayTimeKeepsACorrectTotal(t *testing.T) {
	row := misreadSummaryRow(12.97)
	row.Eliminations, row.PerfAssistsAvgPer10Min, row.PerfDeathsAvgPer10Min = 9, 0, 0
	row.HeroesPlayed[0].PlayTime = "36:56"
	snap := db.Screenshots{Summaries: []db.SummaryRow{row}}
	key, cands := correlate.ResolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.30.28 _sb.png", scoreboardReading(), snap)
	requireKey(t, key, cands, misreadSummaryKey)
}
