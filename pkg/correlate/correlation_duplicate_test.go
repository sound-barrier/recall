package correlate_test

import (
	"testing"

	"recall/pkg/correlate"
	"recall/pkg/db"
)

// Duplicate-sweep fingerprint tests pinning the policy:
//
//   - ≤30 min:  owned exclusively by the EAD bridge / timestamp window —
//     the duplicate fingerprint never fires there.
//   - 30 min – 7 days: an existing tracked match whose full TEAMS stat
//     line (E/A/D + damage/healing/mitigation) exactly equals the new
//     match's is a duplicate candidate.
//   - >7 days: no flag.
//
// The stat line must carry real signal: all-zero E/A/D rows and
// zero-damage rows are OCR-garbage / entropy-starved and never match.

const dupNewKey = "match-2026-05-10T21-14-03"

// newSnap builds the canonical two-match snapshot: an original TEAMS row
// under origKey and the new match's TEAMS row under dupNewKey, 3 h 8 m
// 41 s later (distance 11321 s), identical six-field stat line.
func newSnap(origKey string) db.Screenshots {
	return db.Screenshots{
		Teams: []db.TeamsRow{
			{
				Filename:     "Overwatch 2 Screenshot 2026.05.10 - 18.05.22.11.png",
				MatchKey:     origKey,
				Eliminations: 17, Assists: 16, Deaths: 11,
				Damage: 12843, Healing: 9021, Mitigation: 3310,
			},
			{
				Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.14.03.02.png",
				MatchKey:     dupNewKey,
				Eliminations: 17, Assists: 16, Deaths: 11,
				Damage: 12843, Healing: 9021, Mitigation: 3310,
			},
		},
	}
}

func TestFindDuplicateMatches_IdenticalStatLineHoursApart_Flags(t *testing.T) {
	origKey := "match-2026-05-10T18-05-22"
	cands := correlate.FindDuplicateMatches(dupNewKey, newSnap(origKey))
	if len(cands) != 1 {
		t.Fatalf("expected 1 duplicate candidate, got %d (%+v)", len(cands), cands)
	}
	if cands[0].MatchKey != origKey {
		t.Errorf("wrong candidate key: %q", cands[0].MatchKey)
	}
	if cands[0].DistanceSeconds != 11321 {
		t.Errorf("wrong distance: %d (want 11321)", cands[0].DistanceSeconds)
	}
}

func TestFindDuplicateMatches_BeyondSevenDays_NoFlag(t *testing.T) {
	snap := newSnap("match-2026-05-02T18-05-22")
	snap.Teams[0].Filename = "Overwatch 2 Screenshot 2026.05.02 - 18.05.22.11.png"
	if cands := correlate.FindDuplicateMatches(dupNewKey, snap); cands != nil {
		t.Errorf("expected no flag beyond 7 days, got %+v", cands)
	}
}

func TestFindDuplicateMatches_InsideEADWindow_NoFlag(t *testing.T) {
	// 20 min apart — that zone belongs to the EAD bridge; the sweep
	// must stay out so existing correlation behavior is untouched.
	snap := newSnap("match-2026-05-10T20-54-03")
	snap.Teams[0].Filename = "Overwatch 2 Screenshot 2026.05.10 - 20.54.03.11.png"
	if cands := correlate.FindDuplicateMatches(dupNewKey, snap); cands != nil {
		t.Errorf("expected no flag inside the 30-min EAD zone, got %+v", cands)
	}
}

func TestFindDuplicateMatches_JustPastEADWindow_Flags(t *testing.T) {
	// 31 min apart — the first minute the sweep owns.
	snap := newSnap("match-2026-05-10T20-43-03")
	snap.Teams[0].Filename = "Overwatch 2 Screenshot 2026.05.10 - 20.43.03.11.png"
	cands := correlate.FindDuplicateMatches(dupNewKey, snap)
	if len(cands) != 1 || cands[0].DistanceSeconds != 1860 {
		t.Errorf("expected 31-min duplicate flagged, got %+v", cands)
	}
}

func TestFindDuplicateMatches_MapConflict_NoFlag(t *testing.T) {
	// Same stat line but the two matches' SUMMARY rows disagree on map
	// — the RowsConflict guard blocks the coincidence.
	origKey := "match-2026-05-10T18-05-22"
	snap := newSnap(origKey)
	snap.Summaries = []db.SummaryRow{
		{
			Filename: "Overwatch 2 Screenshot 2026.05.10 - 18.05.24.11.png",
			MatchKey: origKey, Map: "rialto",
		},
		{
			Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.14.05.02.png",
			MatchKey: dupNewKey, Map: "kings row",
		},
	}
	if cands := correlate.FindDuplicateMatches(dupNewKey, snap); cands != nil {
		t.Errorf("expected map conflict to block the flag, got %+v", cands)
	}
}

func TestFindDuplicateMatches_MatchingSummaries_StillFlags(t *testing.T) {
	// Agreeing SUMMARY signatures must not trip the conflict guard.
	origKey := "match-2026-05-10T18-05-22"
	snap := newSnap(origKey)
	snap.Summaries = []db.SummaryRow{
		{
			Filename: "Overwatch 2 Screenshot 2026.05.10 - 18.05.24.11.png",
			MatchKey: origKey, Map: "rialto", Hero: "lucio", Date: "2026-05-10",
		},
		{
			Filename: "Overwatch 2 Screenshot 2026.05.10 - 21.14.05.02.png",
			MatchKey: dupNewKey, Map: "rialto", Hero: "lucio", Date: "2026-05-10",
		},
	}
	cands := correlate.FindDuplicateMatches(dupNewKey, snap)
	if len(cands) != 1 || cands[0].MatchKey != origKey {
		t.Errorf("expected agreeing summaries to still flag, got %+v", cands)
	}
}

func TestFindDuplicateMatches_ZeroDamage_NoFlag(t *testing.T) {
	// E/A/D-only equality is the EAD bridge's (windowed) business; at
	// hours apart it's coincidence-prone without damage entropy.
	snap := newSnap("match-2026-05-10T18-05-22")
	for i := range snap.Teams {
		snap.Teams[i].Damage, snap.Teams[i].Healing, snap.Teams[i].Mitigation = 0, 0, 0
	}
	if cands := correlate.FindDuplicateMatches(dupNewKey, snap); cands != nil {
		t.Errorf("expected zero-damage rows to never flag, got %+v", cands)
	}
}

func TestFindDuplicateMatches_AllZeroEAD_NoFlag(t *testing.T) {
	snap := newSnap("match-2026-05-10T18-05-22")
	for i := range snap.Teams {
		snap.Teams[i].Eliminations, snap.Teams[i].Assists, snap.Teams[i].Deaths = 0, 0, 0
	}
	if cands := correlate.FindDuplicateMatches(dupNewKey, snap); cands != nil {
		t.Errorf("expected all-zero E/A/D rows to never flag, got %+v", cands)
	}
}

func TestFindDuplicateMatches_ZeroButEqualHealingMitigation_Flags(t *testing.T) {
	// A DPS line legitimately has healing=0 and mitigation=0 — zero
	// must equal zero, not disqualify.
	snap := newSnap("match-2026-05-10T18-05-22")
	for i := range snap.Teams {
		snap.Teams[i].Healing, snap.Teams[i].Mitigation = 0, 0
	}
	cands := correlate.FindDuplicateMatches(dupNewKey, snap)
	if len(cands) != 1 {
		t.Errorf("expected zero-but-equal healing/mitigation to flag, got %+v", cands)
	}
}

func TestFindDuplicateMatches_OneFieldDiffers_NoFlag(t *testing.T) {
	snap := newSnap("match-2026-05-10T18-05-22")
	snap.Teams[0].Damage++
	if cands := correlate.FindDuplicateMatches(dupNewKey, snap); cands != nil {
		t.Errorf("expected a single differing field to block the flag, got %+v", cands)
	}
}

func TestFindDuplicateMatches_UntrackedCandidateKey_NoFlag(t *testing.T) {
	// Sentinel-keyed rows (ambiguous-/unmatched-) are pending triage
	// themselves and must never be offered as duplicate targets.
	snap := newSnap("ambiguous-c29tZWZpbGU")
	if cands := correlate.FindDuplicateMatches(dupNewKey, snap); cands != nil {
		t.Errorf("expected non-tracked candidate keys to be skipped, got %+v", cands)
	}
}

func TestFindDuplicateMatches_OwnRowsOnly_NoFlag(t *testing.T) {
	// Both equal rows belong to the new match itself (multi-capture of
	// one set) — nothing to flag against.
	snap := newSnap(dupNewKey)
	if cands := correlate.FindDuplicateMatches(dupNewKey, snap); cands != nil {
		t.Errorf("expected own-key rows to be excluded, got %+v", cands)
	}
}

func TestFindDuplicateMatches_DedupesPerKeyKeepingMinDistance(t *testing.T) {
	// The original match has TWO teams captures with the same line —
	// one candidate entry, closest capture's distance.
	origKey := "match-2026-05-10T18-05-22"
	snap := newSnap(origKey)
	snap.Teams = append(snap.Teams, db.TeamsRow{
		Filename:     "Overwatch 2 Screenshot 2026.05.10 - 18.06.22.12.png",
		MatchKey:     origKey,
		Eliminations: 17, Assists: 16, Deaths: 11,
		Damage: 12843, Healing: 9021, Mitigation: 3310,
	})
	cands := correlate.FindDuplicateMatches(dupNewKey, snap)
	if len(cands) != 1 {
		t.Fatalf("expected 1 deduped candidate, got %d (%+v)", len(cands), cands)
	}
	if cands[0].DistanceSeconds != 11261 {
		t.Errorf("expected min distance 11261, got %d", cands[0].DistanceSeconds)
	}
}

func TestFindDuplicateMatches_MultipleCandidates_SortedByDistanceThenKey(t *testing.T) {
	// Three tracked matches share the new match's stat line: two exactly
	// equidistant (3 h 8 m 41 s before and after) and one farther out.
	// The tied pair must sort by match_key; the farther one comes last.
	snap := newSnap("match-2026-05-10T18-05-22")
	line := db.TeamsRow{
		Eliminations: 17, Assists: 16, Deaths: 11,
		Damage: 12843, Healing: 9021, Mitigation: 3310,
	}
	tiedAfter := line
	tiedAfter.Filename = "Overwatch 2 Screenshot 2026.05.11 - 00.22.44.13.png"
	tiedAfter.MatchKey = "match-2026-05-11T00-22-44"
	farther := line
	farther.Filename = "Overwatch 2 Screenshot 2026.05.10 - 17.05.22.14.png"
	farther.MatchKey = "match-2026-05-10T17-05-22"
	snap.Teams = append(snap.Teams, tiedAfter, farther)

	cands := correlate.FindDuplicateMatches(dupNewKey, snap)
	if len(cands) != 3 {
		t.Fatalf("expected 3 candidates, got %d (%+v)", len(cands), cands)
	}
	wantKeys := []string{"match-2026-05-10T18-05-22", "match-2026-05-11T00-22-44", "match-2026-05-10T17-05-22"}
	wantDists := []int{11321, 11321, 14921}
	for i := range cands {
		if cands[i].MatchKey != wantKeys[i] || cands[i].DistanceSeconds != wantDists[i] {
			t.Errorf("cands[%d] = %+v, want key %q distance %d", i, cands[i], wantKeys[i], wantDists[i])
		}
	}
}

func TestCandidateReason_DerivedFromDistance(t *testing.T) {
	// Distances beyond the 30-min EAD cap can only come from the
	// duplicate sweep; at or below it they're window/EAD candidates.
	if got := correlate.CandidateReason(11321); got != correlate.ReasonDuplicateStats {
		t.Errorf("11321s: got %q, want %q", got, correlate.ReasonDuplicateStats)
	}
	if got := correlate.CandidateReason(1801); got != correlate.ReasonDuplicateStats {
		t.Errorf("1801s: got %q, want %q", got, correlate.ReasonDuplicateStats)
	}
	if got := correlate.CandidateReason(1800); got != "" {
		t.Errorf("1800s: got %q, want empty", got)
	}
	if got := correlate.CandidateReason(720); got != "" {
		t.Errorf("720s: got %q, want empty", got)
	}
}
