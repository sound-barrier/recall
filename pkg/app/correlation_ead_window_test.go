package app

import (
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// EAD-bridge time-window tests pinning the policy:
//
//   • 0–5 min:   single candidate auto-adopts; multiple candidates
//                surface as ambiguous unless exactly one is
//                corroborated.
//   • 5–30 min:  single candidate surfaces as ambiguous UNLESS the
//                candidate's SUMMARY.finished_at HH:MM matches the
//                existing screenshot's filename HH:MM — that
//                corroborates the bridge and the candidate auto-adopts.
//   • >30 min:   no bridge; resolver falls through to the
//                timestamp-window / fresh-key passes.

func TestMatchByEAD_SingleCandidate_WithinAutoWindow_AutoAdopts(t *testing.T) {
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.29.28 _sb.png",
			MatchKey:     "match-2026-05-10T21-29-28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	cand := candidateFromParse("Overwatch 2 Screenshot 2026.05.10 - 21.31.28 _sb2.png", &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
	})
	key, cands, ok := matchByEAD(cand, snap)
	if !ok {
		t.Fatalf("expected ok=true, got false")
	}
	if key != "match-2026-05-10T21-29-28" {
		t.Errorf("expected adopted key, got %q", key)
	}
	if cands != nil {
		t.Errorf("expected no candidates on auto-adopt, got %+v", cands)
	}
}

func TestMatchByEAD_SingleCandidate_InAmbiguousZone_SurfacesCandidate(t *testing.T) {
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.29.28 _sb.png",
			MatchKey:     "match-2026-05-10T21-29-28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	cand := candidateFromParse("Overwatch 2 Screenshot 2026.05.10 - 21.41.28 _sb2.png", &parser.MatchResult{
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
	if cands[0].MatchKey != "match-2026-05-10T21-29-28" {
		t.Errorf("wrong candidate key: %q", cands[0].MatchKey)
	}
	if cands[0].DistanceSeconds != 720 {
		t.Errorf("wrong distance: %d (want 720)", cands[0].DistanceSeconds)
	}
}

func TestMatchByEAD_OutsideMaxWindow_NoBridge(t *testing.T) {
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.29.28 _sb.png",
			MatchKey:     "match-2026-05-10T21-29-28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	cand := candidateFromParse("Overwatch 2 Screenshot 2026.05.10 - 22.09.28 _sb2.png", &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
	})
	_, _, ok := matchByEAD(cand, snap)
	if ok {
		t.Errorf("expected no bridge >30 min apart, got ok=true")
	}
}

func TestMatchByEAD_MultipleCandidates_SurfacesAllSortedByDistance(t *testing.T) {
	snap := db.Screenshots{
		Teams: []db.TeamsRow{
			{
				Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.27.28 _a.png", MatchKey: "match-A",
				Eliminations: 17, Assists: 16, Deaths: 11,
			},
			{
				Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.33.28 _b.png", MatchKey: "match-B",
				Eliminations: 17, Assists: 16, Deaths: 11,
			},
		},
	}
	// New at 21:31:28 — 4 min after A, 2 min before B.
	cand := candidateFromParse("Overwatch 2 Screenshot 2026.05.10 - 21.31.28 _new.png", &parser.MatchResult{
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
	if cands[0].MatchKey != "match-B" {
		t.Errorf("expected B (closer) first, got %q", cands[0].MatchKey)
	}
	if cands[0].DistanceSeconds != 120 || cands[1].DistanceSeconds != 240 {
		t.Errorf("wrong distances: %+v", cands)
	}
}

func TestResolveMatchKey_AmbiguousMintsSentinelAndReturnsCandidates(t *testing.T) {
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.29.28 _sb.png",
			MatchKey:     "match-2026-05-10T21-29-28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	key, cands := resolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.41.28 _sb2.png", &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
	}, snap)
	wantKey := "ambiguous-Overwatch 2 Screenshot 2026.05.10 - 21.41.28 _sb2.png"
	if key != wantKey {
		t.Errorf("expected sentinel %q, got %q", wantKey, key)
	}
	if len(cands) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(cands))
	}
	if cands[0].MatchKey != "match-2026-05-10T21-29-28" {
		t.Errorf("wrong candidate: %+v", cands[0])
	}
}

// Corroborator-gated promotion: a candidate whose SUMMARY.finished_at
// HH:MM matches an existing screenshot's filename HH:MM auto-adopts
// even at distances inside the 5–30 min ambiguous zone. The
// uncorroborated 5–30 min path is unchanged — those cases still go
// ambiguous.

func TestMatchByEAD_SingleCandidate_InAmbiguousZone_FinishedAtCorroborates_AutoAdopts(t *testing.T) {
	// Live-data shape: post-match SUMMARY at 21:49:53 with
	// finished_at="21:29" bridging to an in-game TEAMS at
	// 21:29:28. 20-min gap is in the 5–30 m ambiguous zone, but
	// SUMMARY's finished_at HH:MM matches TEAMS filename HH:MM
	// exactly, so the bridge auto-adopts.
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.29.28.16.png",
			MatchKey:     "match-2026-05-10T21-29-28",
			Eliminations: 17, Assists: 14, Deaths: 7,
		}},
	}
	cand := candidateFromParse("Overwatch 2 Screenshot 2026.05.10 - 21.49.53.95.png", &parser.MatchResult{
		Map: "aatlis", Hero: "lucio",
		Date: "2026-05-10", FinishedAt: "21:29",
		Eliminations: 17, Assists: 14, Deaths: 7,
	})
	key, cands, ok := matchByEAD(cand, snap)
	if !ok {
		t.Fatalf("expected ok=true, got false")
	}
	if key != "match-2026-05-10T21-29-28" {
		t.Errorf("expected auto-adopt via finished_at corroboration, got key=%q", key)
	}
	if cands != nil {
		t.Errorf("expected no candidates on auto-adopt, got %+v", cands)
	}
}

func TestResolveMatchKey_EADBridge_AmbiguousZone_FinishedAtCorroborates_EndToEnd(t *testing.T) {
	// End-to-end: resolveMatchKey returns the adopted key (not the
	// "ambiguous-" sentinel) when finished_at corroborates. Pins the
	// live-data scenario all the way through the public surface.
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.29.28.16.png",
			MatchKey:     "match-2026-05-10T21-29-28",
			Eliminations: 17, Assists: 14, Deaths: 7,
		}},
	}
	key, cands := resolveMatchKey(
		"Overwatch 2 Screenshot 2026.05.10 - 21.49.53.95.png",
		&parser.MatchResult{
			Map: "aatlis", Hero: "lucio",
			Date: "2026-05-10", FinishedAt: "21:29",
			Eliminations: 17, Assists: 14, Deaths: 7,
		}, snap,
	)
	if key != "match-2026-05-10T21-29-28" {
		t.Errorf("expected adopted key, got %q", key)
	}
	if cands != nil {
		t.Errorf("expected no ambiguous candidates, got %+v", cands)
	}
}

func TestResolveMatchKey_LiveAatlisCascade_EndToEnd(t *testing.T) {
	// Exact replay of the live-data bug from data/db/recall.db:
	// in-game TEAMS at 21:29:28 for aatlis/lucio (EAD=17/14/7);
	// 20 minutes later the user captures the post-match SUMMARY +
	// TEAMS + PERSONAL trio (21:49:53/55/57). All three must
	// adopt match:2026-05-10T21:29:28 instead of cascading into
	// ambiguous keys.
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.29.28.16.png",
			MatchKey:     "match-2026-05-10T21-29-28",
			Eliminations: 17, Assists: 14, Deaths: 7,
		}},
	}
	expectedKey := "match-2026-05-10T21-29-28"

	// 1. Post-match SUMMARY arrives at 21:49:53.95 — finished_at=21:29
	//    matches the existing TEAMS filename HH:MM.
	sumFile := "Overwatch 2 Screenshot 2026.05.10 - 21.49.53.95.png"
	sumResult := &parser.MatchResult{
		Map: "aatlis", Hero: "lucio", Result: "victory",
		Date: "2026-05-10", FinishedAt: "21:29",
		Eliminations: 17, Assists: 14, Deaths: 7,
		HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", PercentPlayed: 100}},
	}
	gotSum, _ := resolveMatchKey(sumFile, sumResult, snap)
	if gotSum != expectedKey {
		t.Fatalf("SUMMARY: got %q, want %q", gotSum, expectedKey)
	}
	snap.Summaries = append(snap.Summaries, db.SummaryRow{
		Filename: sumFile, MatchKey: gotSum,
		Map: sumResult.Map, Hero: sumResult.Hero, Result: sumResult.Result,
		Date: sumResult.Date, FinishedAt: sumResult.FinishedAt,
		PerfElimTotal:    sumResult.Eliminations,
		PerfAssistsTotal: sumResult.Assists,
		PerfDeathsTotal:  sumResult.Deaths,
	})

	// 2. Post-match TEAMS at 21:49:55.46 — same EAD as the
	//    SUMMARY adopted in step 1; it's 1.5 s away (well inside the
	//    auto-window). The bridge now has TWO same-key candidates
	//    (original TEAMS + just-adopted SUMMARY); the SUMMARY
	//    is closer so the auto-window check fires.
	sbFile := "Overwatch 2 Screenshot 2026.05.10 - 21.49.55.46.png"
	sbResult := &parser.MatchResult{
		Map: "aatlis", Hero: "lucio",
		Eliminations: 17, Assists: 14, Deaths: 7,
	}
	gotSB, _ := resolveMatchKey(sbFile, sbResult, snap)
	if gotSB != expectedKey {
		t.Fatalf("TEAMS: got %q, want %q", gotSB, expectedKey)
	}
	snap.Teams = append(snap.Teams, db.TeamsRow{
		Filename: sbFile, MatchKey: gotSB,
		Eliminations: sbResult.Eliminations,
		Assists:      sbResult.Assists,
		Deaths:       sbResult.Deaths,
	})

	// 3. PERSONAL at 21:49:57.02 — no EAD; matchByEAD skips, and
	//    matchByTimestampWindow finds two close siblings, both with
	//    the same (now-adopted) match_key.
	persFile := "Overwatch 2 Screenshot 2026.05.10 - 21.49.57.02.png"
	persResult := &parser.MatchResult{Hero: "lucio"}
	gotPers, _ := resolveMatchKey(persFile, persResult, snap)
	if gotPers != expectedKey {
		t.Fatalf("PERSONAL: got %q, want %q", gotPers, expectedKey)
	}
}

func TestMatchByEAD_MultiCandidate_OneCorroborated_AutoAdoptsCorroborated(t *testing.T) {
	// Two EAD candidates: match:A has finished_at HH:MM agreement
	// with the candidate; match:B is pure EAD collision. Exactly one
	// corroborated → auto-adopt match:A even though both fall inside
	// the bridge window.
	snap := db.Screenshots{
		Teams: []db.TeamsRow{
			{
				Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.29.28.00.png",
				MatchKey:     "match-A",
				Eliminations: 17, Assists: 14, Deaths: 7,
			},
			{
				Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.34.00.00.png",
				MatchKey:     "match-B",
				Eliminations: 17, Assists: 14, Deaths: 7,
			},
		},
	}
	cand := candidateFromParse("Overwatch 2 Screenshot 2026.05.10 - 21.49.53.00.png", &parser.MatchResult{
		Map: "aatlis", Hero: "lucio",
		Date: "2026-05-10", FinishedAt: "21:29", // matches A's filename HH:MM only
		Eliminations: 17, Assists: 14, Deaths: 7,
	})
	key, cands, ok := matchByEAD(cand, snap)
	if !ok {
		t.Fatalf("expected ok=true, got false")
	}
	if key != "match-A" {
		t.Errorf("expected auto-adopt corroborated A, got key=%q cands=%+v", key, cands)
	}
	if cands != nil {
		t.Errorf("expected no ambiguous candidates on auto-adopt, got %+v", cands)
	}
}

func TestMatchByEAD_BridgesToExistingSummaryByPerfEAD(t *testing.T) {
	// Once a SUMMARY adopts an in-game TEAMS key via
	// finished_at corroboration, a downstream TEAMS that arrives
	// within the auto-window of that SUMMARY must see the SUMMARY as
	// an EAD candidate (via its perf totals). Pins the cascade fix
	// where snapshotExisting exposes SUMMARY perf totals to matchByEAD.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.49.53.95.png",
			MatchKey: "match-2026-05-10T21-29-28",
			Map:      "aatlis", Hero: "lucio",
			Date: "2026-05-10", FinishedAt: "21:29",
			PerfElimTotal: 17, PerfAssistsTotal: 14, PerfDeathsTotal: 7,
		}},
	}
	// A TEAMS that arrives 1.5 seconds later with the same EAD —
	// no finished_at of its own, no triple-agreement signal, just
	// physical proximity to the SUMMARY.
	cand := candidateFromParse("Overwatch 2 Screenshot 2026.05.10 - 21.49.55.46.png", &parser.MatchResult{
		Map: "aatlis", Hero: "lucio",
		Eliminations: 17, Assists: 14, Deaths: 7,
	})
	key, cands, ok := matchByEAD(cand, snap)
	if !ok {
		t.Fatalf("expected ok=true, got false")
	}
	if key != "match-2026-05-10T21-29-28" {
		t.Errorf("expected auto-adopt via SUMMARY EAD proximity, got key=%q cands=%+v", key, cands)
	}
}

func TestMatchByEAD_SingleCandidate_InAmbiguousZone_NoCorroborator_StaysAmbiguous(t *testing.T) {
	// Regression pin for cohorts B/D: pure EAD collision with no
	// corroborating fields stays ambiguous even with a single
	// candidate inside the 5–30 m window.
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.29.28 _sb.png",
			MatchKey:     "match-2026-05-10T21-29-28",
			Eliminations: 17, Assists: 14, Deaths: 7,
		}},
	}
	cand := candidateFromParse("Overwatch 2 Screenshot 2026.05.10 - 21.49.53 _sb2.png", &parser.MatchResult{
		// Bare EAD collision: no map / hero / date / finished_at.
		Eliminations: 17, Assists: 14, Deaths: 7,
	})
	key, cands, ok := matchByEAD(cand, snap)
	if !ok {
		t.Fatalf("expected ok=true for ambiguous, got false")
	}
	if key != "" {
		t.Errorf("expected ambiguous (empty key), got %q", key)
	}
	if len(cands) != 1 || cands[0].MatchKey != "match-2026-05-10T21-29-28" {
		t.Errorf("expected single candidate, got %+v", cands)
	}
}

func TestResolveMatchKey_EADBridge_BeyondMaxWindow_MintsFreshKey(t *testing.T) {
	// Cohort B scenario: two matches with identical EAD 7+ days apart.
	// Under the new rules, the EAD bridge refuses to fire; the resolver
	// falls through to fresh-key minted from the new filename.
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.05.03 - 21.29.28 _sb.png",
			MatchKey:     "match-2026-05-03T21-29-28",
			Eliminations: 17, Assists: 16, Deaths: 11,
		}},
	}
	key, cands := resolveMatchKey("Overwatch 2 Screenshot 2026.05.10 - 21.29.28 _sb2.png", &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
	}, snap)
	if key != "match-2026-05-10T21-29-28" {
		t.Errorf("expected fresh key minted from new filename, got %q", key)
	}
	if cands != nil {
		t.Errorf("expected no candidates on no-bridge, got %+v", cands)
	}
}
