package app

import (
	"reflect"
	"testing"

	"recall/pkg/parser"
)

// ──────────────────────────────────────────────────────────────────────────
// mergeByTimestamp — groups screenshots whose filename timestamps are within
// the merge window. Files without a parseable timestamp become loners.
// ──────────────────────────────────────────────────────────────────────────

func TestMergeByTimestamp_GroupsWithinWindow(t *testing.T) {
	// Two files 13s apart should land in one group; a third file ~30 min later
	// is a separate match.
	parsed := map[string]*parser.MatchResult{
		"2026.05.10 - 21.29.28 _summary.png":    {Map: "rialto", Result: "victory", Date: "2026-05-10", FinishedAt: "21:29"},
		"2026.05.10 - 21.29.41 _scoreboard.png": {Eliminations: 17, Assists: 16, Deaths: 11},
		"2026.05.10 - 22.05.00 _summary.png":    {Map: "aatlis", Result: "defeat", Date: "2026-05-10", FinishedAt: "22:05"},
	}
	got := mergeByTimestamp(parsed)
	if len(got) != 2 {
		t.Fatalf("expected 2 groups, got %d: %+v", len(got), got)
	}
	// First group is the rialto pair (E/A/D merged with SUMMARY metadata).
	first := got[0]
	if first.Data.Map != "rialto" || first.Data.Eliminations != 17 {
		t.Errorf("first group merged poorly: %+v", first.Data)
	}
	if len(first.Sources) != 2 {
		t.Errorf("first group should hold 2 sources, got %d", len(first.Sources))
	}
	if first.Key != "match:2026-05-10T21:29:28" {
		t.Errorf("first group key derived from earliest screenshot: got %q", first.Key)
	}
}

func TestMergeByTimestamp_IsolatesLoners(t *testing.T) {
	parsed := map[string]*parser.MatchResult{
		"renamed_no_timestamp.png":           {Map: "ilios", Eliminations: 5},
		"2026.05.10 - 21.29.28 _summary.png": {Map: "rialto", Result: "victory"},
	}
	got := mergeByTimestamp(parsed)
	if len(got) != 2 {
		t.Fatalf("loner should not merge with timestamped row; got %d rows", len(got))
	}
	var loner *mergedRow
	for i, r := range got {
		if r.Key == "unmatched:renamed_no_timestamp.png" {
			loner = &got[i]
		}
	}
	if loner == nil {
		t.Fatalf("expected an `unmatched:` row for the loner, got %+v", got)
	}
	if loner.Data.Map != "ilios" {
		t.Errorf("loner data lost: %+v", loner.Data)
	}
}

func TestMergeByTimestamp_SplitsConflictingMetadataInSameWindow(t *testing.T) {
	// Two SUMMARY screens 30s apart with conflicting (date, finished_at):
	// rapid match-history scrub. Must split into two groups even though they
	// fall inside the merge window.
	parsed := map[string]*parser.MatchResult{
		"2026.05.10 - 21.29.28 _summary.png": {Map: "rialto", Result: "victory", Date: "2026-05-10", FinishedAt: "21:29"},
		"2026.05.10 - 21.29.58 _summary.png": {Map: "aatlis", Result: "defeat", Date: "2026-05-10", FinishedAt: "20:50"},
	}
	got := mergeByTimestamp(parsed)
	if len(got) != 2 {
		t.Fatalf("expected split into 2 groups by metadata, got %d: %+v", len(got), got)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// splitByMatchMetadata — buckets a timestamp-window group by SUMMARY signature.
// ──────────────────────────────────────────────────────────────────────────

func TestSplitByMatchMetadata_NoSplitWhenOneSignature(t *testing.T) {
	group := []fileEntry{
		{file: "a.png", res: &parser.MatchResult{Date: "2026-05-10", FinishedAt: "21:29"}},
		{file: "b.png", res: &parser.MatchResult{Eliminations: 17}},
	}
	got := splitByMatchMetadata(group)
	if len(got) != 1 || len(got[0]) != 2 {
		t.Fatalf("expected single group of 2; got %+v", got)
	}
}

func TestSplitByMatchMetadata_AssignsUnsignedToNearestBucket(t *testing.T) {
	ts := func(file string) fileEntry {
		t, _ := parseFilenameTimestamp(file)
		return fileEntry{file: file, ts: t, res: &parser.MatchResult{}}
	}
	a := ts("2026.05.10 - 21.29.28 _summary.png")
	a.res = &parser.MatchResult{Date: "2026-05-10", FinishedAt: "21:29"}
	b := ts("2026.05.10 - 21.30.00 _summary.png")
	b.res = &parser.MatchResult{Date: "2026-05-10", FinishedAt: "21:30"}
	unsigned := ts("2026.05.10 - 21.29.30 _personal.png") // 2s after a, 30s before b

	got := splitByMatchMetadata([]fileEntry{a, b, unsigned})
	if len(got) != 2 {
		t.Fatalf("expected 2 buckets, got %d", len(got))
	}
	// Find which bucket holds `unsigned`.
	for _, bucket := range got {
		for _, e := range bucket {
			if e.file == unsigned.file {
				// `unsigned` should be in the same bucket as `a`.
				hasA := false
				for _, x := range bucket {
					if x.file == a.file {
						hasA = true
					}
				}
				if !hasA {
					t.Errorf("unsigned not bucketed with nearest summary (a): %+v", bucket)
				}
				return
			}
		}
	}
	t.Fatal("unsigned not assigned to any bucket")
}

// ──────────────────────────────────────────────────────────────────────────
// mergeByStatsSignature — folds rows with identical E/A/D.
// ──────────────────────────────────────────────────────────────────────────

func TestMergeByStatsSignature_FoldsScoreboardIntoSummary(t *testing.T) {
	rows := []mergedRow{
		{
			Key:     "match:2026-05-10T21:29:28",
			Sources: []string{"summary.png"},
			Data:    parser.MatchResult{Map: "rialto", Result: "victory", Eliminations: 17, Assists: 16, Deaths: 11},
		},
		{
			Key:     "unmatched:scoreboard.png",
			Sources: []string{"scoreboard.png"},
			Data:    parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200},
		},
	}
	got := mergeByStatsSignature(rows)
	if len(got) != 1 {
		t.Fatalf("expected 1 merged row, got %d: %+v", len(got), got)
	}
	if got[0].Data.Map != "rialto" || got[0].Data.Damage != 7200 {
		t.Errorf("merged data lost fields: %+v", got[0].Data)
	}
	if got[0].Key != "match:2026-05-10T21:29:28" {
		t.Errorf("merged row should keep the match: key, got %q", got[0].Key)
	}
}

func TestMergeByStatsSignature_NoMergeOnZeroEAD(t *testing.T) {
	// All-zero rows must never be folded — they represent parse failures.
	rows := []mergedRow{
		{Key: "a", Sources: []string{"a"}, Data: parser.MatchResult{}},
		{Key: "b", Sources: []string{"b"}, Data: parser.MatchResult{}},
	}
	got := mergeByStatsSignature(rows)
	if len(got) != 2 {
		t.Fatalf("zero-EAD rows must not merge; got %d", len(got))
	}
}

// ──────────────────────────────────────────────────────────────────────────
// statsRowsMergeable / findStatsMergePair — exact-EAD plus no field conflict.
// ──────────────────────────────────────────────────────────────────────────

func TestStatsRowsMergeable(t *testing.T) {
	// a has all signature fields set so each conflict case can flip exactly one
	// against it.
	a := mergedRow{Data: parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
		Map: "rialto", Date: "2026-05-10", FinishedAt: "21:29", Hero: "lucio",
		Damage: 7200,
	}}
	tests := []struct {
		name string
		b    mergedRow
		want bool
	}{
		{"exact EAD, no other fields → mergeable", mergedRow{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11}}, true},
		{"different EAD", mergedRow{Data: parser.MatchResult{Eliminations: 18, Assists: 16, Deaths: 11}}, false},
		{"map conflict", mergedRow{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11, Map: "aatlis"}}, false},
		{"date conflict", mergedRow{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11, Date: "2026-05-11"}}, false},
		{"finished_at conflict", mergedRow{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11, FinishedAt: "22:00"}}, false},
		{"hero conflict", mergedRow{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11, Hero: "kiriko"}}, false},
		{"damage conflict (both non-zero, different)", mergedRow{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11, Damage: 8000}}, false},
		{"damage equal → still mergeable", mergedRow{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200}}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := statsRowsMergeable(a, tc.b); got != tc.want {
				t.Fatalf("got %v want %v (a=%+v b=%+v)", got, tc.want, a.Data, tc.b.Data)
			}
		})
	}
}

func TestStatsRowsMergeable_ZeroEAD(t *testing.T) {
	a := mergedRow{Data: parser.MatchResult{}}
	b := mergedRow{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11}}
	if statsRowsMergeable(a, b) {
		t.Errorf("a's zero-EAD must reject merge")
	}
	if statsRowsMergeable(b, a) {
		t.Errorf("b's zero-EAD must reject merge")
	}
}

func TestFindStatsMergePair(t *testing.T) {
	rows := []mergedRow{
		{Data: parser.MatchResult{Eliminations: 5, Assists: 2, Deaths: 3}},
		{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11}},
		{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200}},
	}
	i, j := findStatsMergePair(rows)
	if i != 1 || j != 2 {
		t.Fatalf("expected pair (1,2), got (%d,%d)", i, j)
	}
}

func TestFindStatsMergePair_NoMatch(t *testing.T) {
	rows := []mergedRow{
		{Data: parser.MatchResult{Eliminations: 5}},
		{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11}},
	}
	i, j := findStatsMergePair(rows)
	if i != -1 || j != -1 {
		t.Errorf("expected (-1,-1), got (%d,%d)", i, j)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// combineStatsRows — merges data, dedups sources, picks earlier match key.
// ──────────────────────────────────────────────────────────────────────────

func TestCombineStatsRows_EarlierMatchKeyWins(t *testing.T) {
	a := mergedRow{Key: "match:2026-05-10T21:30:00", Sources: []string{"b.png"}, Data: parser.MatchResult{Eliminations: 17}}
	b := mergedRow{Key: "match:2026-05-10T21:29:28", Sources: []string{"a.png"}, Data: parser.MatchResult{Eliminations: 17, Damage: 7200}}
	got := combineStatsRows(a, b)
	if got.Key != "match:2026-05-10T21:29:28" {
		t.Errorf("earlier match: key must win, got %q", got.Key)
	}
	if got.Data.Damage != 7200 {
		t.Errorf("damage not merged: %+v", got.Data)
	}
	if !reflect.DeepEqual(got.Sources, []string{"a.png", "b.png"}) {
		t.Errorf("sources not dedup-sorted: %v", got.Sources)
	}
}

func TestCombineStatsRows_UnmatchedKeyDoesNotOverrideMatch(t *testing.T) {
	a := mergedRow{Key: "match:2026-05-10T21:29:28", Sources: []string{"sum.png"}, Data: parser.MatchResult{Eliminations: 17}}
	b := mergedRow{Key: "unmatched:loner.png", Sources: []string{"loner.png"}, Data: parser.MatchResult{Eliminations: 17, Damage: 7200}}
	got := combineStatsRows(a, b)
	if got.Key != "match:2026-05-10T21:29:28" {
		t.Errorf("unmatched: key must not overwrite a real match: key, got %q", got.Key)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// timestampWindowOverlap — any pair within mergeWindow makes the slices overlap.
// ──────────────────────────────────────────────────────────────────────────

func TestTimestampWindowOverlap(t *testing.T) {
	tests := []struct {
		name string
		a, b []string
		want bool
	}{
		{
			name: "13s apart → overlap",
			a:    []string{"2026.05.10 - 21.29.28 .png"},
			b:    []string{"2026.05.10 - 21.29.41 .png"},
			want: true,
		},
		{
			name: "5 minutes apart → no overlap",
			a:    []string{"2026.05.10 - 21.29.28 .png"},
			b:    []string{"2026.05.10 - 21.34.28 .png"},
			want: false,
		},
		{
			name: "exactly mergeWindow apart → overlap (boundary inclusive)",
			a:    []string{"2026.05.10 - 21.29.28 .png"},
			b:    []string{"2026.05.10 - 21.31.28 .png"},
			want: true,
		},
		{
			name: "no parseable timestamps → no overlap",
			a:    []string{"renamed.png"},
			b:    []string{"also-renamed.png"},
			want: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := timestampWindowOverlap(tc.a, tc.b); got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// rowsConflict — any string/int signature field with disagreeing non-zero
// values is a conflict.
// ──────────────────────────────────────────────────────────────────────────

func TestRowsConflict(t *testing.T) {
	base := mergedRow{Data: parser.MatchResult{Map: "rialto", Date: "2026-05-10", FinishedAt: "21:29"}}
	tests := []struct {
		name string
		b    mergedRow
		want bool
	}{
		{"compatible (one empty)", mergedRow{Data: parser.MatchResult{Map: "rialto"}}, false},
		{"map conflict", mergedRow{Data: parser.MatchResult{Map: "aatlis"}}, true},
		{"date conflict", mergedRow{Data: parser.MatchResult{Date: "2026-05-11"}}, true},
		{"finished_at conflict", mergedRow{Data: parser.MatchResult{FinishedAt: "22:00"}}, true},
		{"hero conflict", mergedRow{Data: parser.MatchResult{Hero: "kiriko"}}, false}, // base.Hero empty
		{"eliminations conflict", mergedRow{Data: parser.MatchResult{Eliminations: 5}}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := rowsConflict(base, tc.b); got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

// ──────────────────────────────────────────────────────────────────────────
// unionSortedStrings — set-union with a stable sorted output.
// ──────────────────────────────────────────────────────────────────────────

func TestUnionSortedStrings(t *testing.T) {
	got := unionSortedStrings([]string{"b", "a", "c"}, []string{"c", "d"})
	want := []string{"a", "b", "c", "d"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestUnionSortedStrings_EmptyInputs(t *testing.T) {
	got := unionSortedStrings(nil, nil)
	if len(got) != 0 {
		t.Fatalf("expected empty result, got %v", got)
	}
	got = unionSortedStrings([]string{"x"}, nil)
	if !reflect.DeepEqual(got, []string{"x"}) {
		t.Fatalf("got %v want [x]", got)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// findMergeIntoExisting — picks an existing row via stats-sig OR window-with-
// no-conflict.
// ──────────────────────────────────────────────────────────────────────────

func TestFindMergeIntoExisting_StatsSignature(t *testing.T) {
	existing := []mergedRow{
		{Data: parser.MatchResult{Map: "rialto", Eliminations: 17, Assists: 16, Deaths: 11}},
	}
	nr := mergedRow{Data: parser.MatchResult{Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200}}
	if got := findMergeIntoExisting(nr, existing); got != 0 {
		t.Fatalf("expected index 0 via stats-sig, got %d", got)
	}
}

func TestFindMergeIntoExisting_TimestampWindowFallback(t *testing.T) {
	existing := []mergedRow{
		{Sources: []string{"2026.05.10 - 21.29.28 .png"}, Data: parser.MatchResult{Map: "rialto"}},
	}
	// New row has no EAD signature, but its timestamp is 13s after existing's
	// only source — and no field conflicts.
	nr := mergedRow{Sources: []string{"2026.05.10 - 21.29.41 .png"}, Data: parser.MatchResult{Hero: "lucio"}}
	if got := findMergeIntoExisting(nr, existing); got != 0 {
		t.Fatalf("expected index 0 via window fallback, got %d", got)
	}
}

func TestFindMergeIntoExisting_RejectsConflictingWindowMatch(t *testing.T) {
	existing := []mergedRow{
		{Sources: []string{"2026.05.10 - 21.29.28 .png"}, Data: parser.MatchResult{Map: "rialto"}},
	}
	// Within window BUT map disagrees — must NOT merge.
	nr := mergedRow{Sources: []string{"2026.05.10 - 21.29.41 .png"}, Data: parser.MatchResult{Map: "aatlis"}}
	if got := findMergeIntoExisting(nr, existing); got != -1 {
		t.Fatalf("expected -1 (no merge due to map conflict), got %d", got)
	}
}

func TestFindMergeIntoExisting_NoCandidate(t *testing.T) {
	existing := []mergedRow{
		{Sources: []string{"2026.05.10 - 21.29.28 .png"}, Data: parser.MatchResult{Map: "rialto", Eliminations: 5}},
	}
	nr := mergedRow{Sources: []string{"2026.05.10 - 22.00.00 .png"}, Data: parser.MatchResult{Eliminations: 17}}
	if got := findMergeIntoExisting(nr, existing); got != -1 {
		t.Fatalf("expected -1, got %d", got)
	}
}
