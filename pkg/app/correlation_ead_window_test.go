package app

import (
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// EAD-bridge time-window tests pinning the policy:
//
//   • 0–5 min:   single candidate auto-adopts; multiple candidates
//                surface as ambiguous.
//   • 5–30 min:  single candidate surfaces as ambiguous (the screenshot
//                might be a delayed-capture of the same match OR a
//                back-to-back match with identical stats — only the
//                user knows).
//   • >30 min:   no bridge; resolver falls through to the
//                timestamp-window / fresh-key passes.

func TestMatchByEAD_SingleCandidate_WithinAutoWindow_AutoAdopts(t *testing.T) {
	snap := db.Screenshots{
		Scoreboards: []db.ScoreboardRow{{
			Filename:     "2026.05.10 - 21.29.28 _sb.png",
			MatchKey:     "match:2026-05-10T21:29:28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	cand := candidateFromParse("2026.05.10 - 21.31.28 _sb2.png", &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
	})
	key, cands, ok := matchByEAD(cand, snap)
	if !ok {
		t.Fatalf("expected ok=true, got false")
	}
	if key != "match:2026-05-10T21:29:28" {
		t.Errorf("expected adopted key, got %q", key)
	}
	if cands != nil {
		t.Errorf("expected no candidates on auto-adopt, got %+v", cands)
	}
}

func TestMatchByEAD_SingleCandidate_InAmbiguousZone_SurfacesCandidate(t *testing.T) {
	snap := db.Screenshots{
		Scoreboards: []db.ScoreboardRow{{
			Filename:     "2026.05.10 - 21.29.28 _sb.png",
			MatchKey:     "match:2026-05-10T21:29:28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	cand := candidateFromParse("2026.05.10 - 21.41.28 _sb2.png", &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
	})
	key, cands, ok := matchByEAD(cand, snap)
	if !ok {
		t.Fatalf("expected ok=true for ambiguous bridge, got false")
	}
	if key != "" {
		t.Errorf("expected empty key on ambiguous, got %q", key)
	}
	if len(cands) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(cands))
	}
	if cands[0].MatchKey != "match:2026-05-10T21:29:28" {
		t.Errorf("wrong candidate key: %q", cands[0].MatchKey)
	}
	if cands[0].DistanceS != 720 {
		t.Errorf("wrong distance: %d (want 720)", cands[0].DistanceS)
	}
}

func TestMatchByEAD_OutsideMaxWindow_NoBridge(t *testing.T) {
	snap := db.Screenshots{
		Scoreboards: []db.ScoreboardRow{{
			Filename:     "2026.05.10 - 21.29.28 _sb.png",
			MatchKey:     "match:2026-05-10T21:29:28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	cand := candidateFromParse("2026.05.10 - 22.09.28 _sb2.png", &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
	})
	_, _, ok := matchByEAD(cand, snap)
	if ok {
		t.Errorf("expected no bridge >30 min apart, got ok=true")
	}
}

func TestMatchByEAD_MultipleCandidates_SurfacesAllSortedByDistance(t *testing.T) {
	snap := db.Screenshots{
		Scoreboards: []db.ScoreboardRow{
			{
				Filename: "2026.05.10 - 21.27.28 _a.png", MatchKey: "match:A",
				Eliminations: 17, Assists: 16, Deaths: 11,
			},
			{
				Filename: "2026.05.10 - 21.33.28 _b.png", MatchKey: "match:B",
				Eliminations: 17, Assists: 16, Deaths: 11,
			},
		},
	}
	// New at 21:31:28 — 4 min after A, 2 min before B.
	cand := candidateFromParse("2026.05.10 - 21.31.28 _new.png", &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
	})
	key, cands, ok := matchByEAD(cand, snap)
	if !ok || key != "" {
		t.Fatalf("expected ambiguous multi (ok=true key=''): ok=%v key=%q", ok, key)
	}
	if len(cands) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(cands))
	}
	// Closer (B at 2min) should sort first.
	if cands[0].MatchKey != "match:B" {
		t.Errorf("expected B (closer) first, got %q", cands[0].MatchKey)
	}
	if cands[0].DistanceS != 120 || cands[1].DistanceS != 240 {
		t.Errorf("wrong distances: %+v", cands)
	}
}

func TestResolveMatchKey_AmbiguousMintsSentinelAndReturnsCandidates(t *testing.T) {
	snap := db.Screenshots{
		Scoreboards: []db.ScoreboardRow{{
			Filename:     "2026.05.10 - 21.29.28 _sb.png",
			MatchKey:     "match:2026-05-10T21:29:28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	key, cands := resolveMatchKey("2026.05.10 - 21.41.28 _sb2.png", &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
	}, snap)
	wantKey := "ambiguous:2026.05.10 - 21.41.28 _sb2.png"
	if key != wantKey {
		t.Errorf("expected sentinel %q, got %q", wantKey, key)
	}
	if len(cands) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(cands))
	}
	if cands[0].MatchKey != "match:2026-05-10T21:29:28" {
		t.Errorf("wrong candidate: %+v", cands[0])
	}
}

func TestResolveMatchKey_EADBridge_BeyondMaxWindow_MintsFreshKey(t *testing.T) {
	// Cohort B scenario: two matches with identical EAD 7+ days apart.
	// Under the new rules, the EAD bridge refuses to fire; the resolver
	// falls through to fresh-key minted from the new filename.
	snap := db.Screenshots{
		Scoreboards: []db.ScoreboardRow{{
			Filename:     "2026.05.03 - 21.29.28 _sb.png",
			MatchKey:     "match:2026-05-03T21:29:28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	key, cands := resolveMatchKey("2026.05.10 - 21.29.28 _sb2.png", &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
	}, snap)
	if key != "match:2026-05-10T21:29:28" {
		t.Errorf("expected fresh key minted from new filename, got %q", key)
	}
	if cands != nil {
		t.Errorf("expected no candidates on no-bridge, got %+v", cands)
	}
}
