package app

import (
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// matchByTimestampWindow ambiguity tests.
//
// When a screenshot's filename timestamp is equidistant (or near-
// equidistant) from rows in two different existing matches, the
// resolver used to silently pick whichever was iterated first. That
// hid a real attribution decision the user needs to make — see
// cohort E in the 400-fixture stress test (8 pinned bugs). The fix
// surfaces the tie as an ambiguous: sentinel + the candidate
// match_keys, the same machinery PR #104 introduced for the EAD
// bridge.

func TestMatchByTimestampWindow_EquidistantBetweenTwoMatches_SurfacesAmbiguous(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{
			{
				Filename: "2026.07.01 - 14.00.00 _x.png",
				MatchKey: "match:X",
				Map:      "rialto",
				Hero:     "lucio",
			},
			{
				Filename: "2026.07.01 - 14.01.30 _y.png",
				MatchKey: "match:Y",
				Map:      "aatlis",
				Hero:     "lucio",
			},
		},
	}
	// PERSONAL at 14:00:45 — exactly 45 s from each SUMMARY.
	cand := candidateFromParse("2026.07.01 - 14.00.45 _p.png",
		&parser.MatchResult{Hero: "lucio"})
	key, cands, ok := matchByTimestampWindow(cand, snap)
	if !ok {
		t.Fatalf("expected ok=true for ambiguous tie, got false")
	}
	if key != "" {
		t.Errorf("expected empty key on ambiguous tie, got %q", key)
	}
	if len(cands) != 2 {
		t.Fatalf("expected 2 candidates, got %+v", cands)
	}
	seen := map[string]bool{}
	for _, c := range cands {
		seen[c.MatchKey] = true
		if c.DistanceS != 45 {
			t.Errorf("expected 45s distance, got %d for %q", c.DistanceS, c.MatchKey)
		}
	}
	if !seen["match:X"] || !seen["match:Y"] {
		t.Errorf("expected both X and Y candidates, got %+v", cands)
	}
}

func TestMatchByTimestampWindow_NearTie_WithinTolerance_SurfacesAmbiguous(t *testing.T) {
	// X SUMMARY 43s away, Y SUMMARY 47s away. 4s apart — within the
	// 5s tie tolerance. Surface both.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{
			{
				Filename: "2026.07.01 - 14.00.02 _x.png",
				MatchKey: "match:X",
				Map:      "rialto",
				Hero:     "lucio",
			},
			{
				Filename: "2026.07.01 - 14.01.32 _y.png",
				MatchKey: "match:Y",
				Map:      "aatlis",
				Hero:     "lucio",
			},
		},
	}
	cand := candidateFromParse("2026.07.01 - 14.00.45 _p.png",
		&parser.MatchResult{Hero: "lucio"})
	_, cands, ok := matchByTimestampWindow(cand, snap)
	if !ok || len(cands) != 2 {
		t.Errorf("expected ambiguous 2-candidate result, got ok=%v cands=%+v", ok, cands)
	}
}

func TestMatchByTimestampWindow_ClearlyCloser_AutoAdopts(t *testing.T) {
	// X SUMMARY 15s away, Y SUMMARY 75s away — well past the 5s
	// tolerance. Adopt X cleanly.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{
			{
				Filename: "2026.07.01 - 14.00.30 _x.png",
				MatchKey: "match:X",
				Map:      "rialto",
				Hero:     "lucio",
			},
			{
				Filename: "2026.07.01 - 14.02.00 _y.png",
				MatchKey: "match:Y",
				Map:      "aatlis",
				Hero:     "lucio",
			},
		},
	}
	cand := candidateFromParse("2026.07.01 - 14.00.45 _p.png",
		&parser.MatchResult{Hero: "lucio"})
	key, cands, ok := matchByTimestampWindow(cand, snap)
	if !ok || key != "match:X" || cands != nil {
		t.Errorf("expected clean adopt of match:X, got ok=%v key=%q cands=%+v", ok, key, cands)
	}
}

func TestMatchByTimestampWindow_IntraMatchEquidistance_NotAmbiguous(t *testing.T) {
	// Two screenshots of the SAME match (key=A), each 30s from the
	// candidate. Not ambiguous — single match_key, no need to ask
	// the user which match it belongs to.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			Filename: "2026.07.01 - 14.00.00 _sum.png",
			MatchKey: "match:A",
			Map:      "rialto",
			Hero:     "lucio",
		}},
		Scoreboards: []db.ScoreboardRow{{
			Filename: "2026.07.01 - 14.01.00 _sb.png",
			MatchKey: "match:A",
			Map:      "rialto",
			Hero:     "lucio",
		}},
	}
	cand := candidateFromParse("2026.07.01 - 14.00.30 _p.png",
		&parser.MatchResult{Hero: "lucio"})
	key, cands, ok := matchByTimestampWindow(cand, snap)
	if !ok || key != "match:A" || cands != nil {
		t.Errorf("expected clean adopt of match:A, got ok=%v key=%q cands=%+v", ok, key, cands)
	}
}
