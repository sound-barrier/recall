package correlate_test

import (
	"testing"

	"recall/pkg/correlate"
	"recall/pkg/db"
)

// The duplicate sweep's second producer: a match re-captured with no TEAMS
// shot on either side. The stat-line fingerprint has nothing to compare —
// TEAMS is where E/A/D/damage/healing/mitigation live — so a player who only
// ever screenshots the SUMMARY screen never gets a duplicate flagged, no
// matter how obviously the two are the same game.
//
// What those two rows DO agree on is the match's own identity: played_at_utc
// is derived from the OW scoreboard's date + finished_at, so it says when the
// MATCH ended, not when the screenshot was taken. Two captures of one match
// carry the same instant; two different matches cannot, because one player
// cannot finish two games in the same minute. Map + result + final score ride
// along as corroboration.
//
// Deliberately unwindowed on capture distance, unlike the stat-line sweep:
// that one needs a 7-day cap because stat lines can coincide by chance, and
// this one cannot. A folder re-imported a month later is still the same match.

const recapNewKey = "match-2026-05-10T21-14-03"

// recapSnap builds two SUMMARY rows — an original and a re-capture 3h08m41s
// later (distance 11321 s) — agreeing on the four identity fields.
func recapSnap(origKey string) db.Screenshots {
	return db.Screenshots{
		Summaries: []db.SummaryRow{
			{
				Filename:    "Overwatch 2 Screenshot 2026.05.10 - 18.05.22.11.png",
				MatchKey:    origKey,
				Map:         "rialto",
				Result:      "victory",
				FinalScore:  "3-1",
				Hero:        "ana",
				Date:        "2026-05-10",
				FinishedAt:  "18:04",
				PlayedAtUTC: new("2026-05-11T00:04:00Z"),
			},
			{
				Filename:    "Overwatch 2 Screenshot 2026.05.10 - 21.14.03.02.png",
				MatchKey:    recapNewKey,
				Map:         "rialto",
				Result:      "victory",
				FinalScore:  "3-1",
				Hero:        "ana",
				Date:        "2026-05-10",
				FinishedAt:  "18:04",
				PlayedAtUTC: new("2026-05-11T00:04:00Z"),
			},
		},
	}
}

func TestFindRecapturedMatches_SameInstantAndResult_Flags(t *testing.T) {
	origKey := "match-2026-05-10T18-05-22"
	cands := correlate.NewDuplicateScan(recapSnap(origKey)).CandidatesFor(recapNewKey)
	if len(cands) != 1 {
		t.Fatalf("expected 1 re-capture candidate, got %d (%+v)", len(cands), cands)
	}
	if cands[0].MatchKey != origKey {
		t.Errorf("wrong candidate key: %q", cands[0].MatchKey)
	}
	if cands[0].DistanceSeconds != 11321 {
		t.Errorf("wrong distance: %d (want 11321)", cands[0].DistanceSeconds)
	}
	if cands[0].Reason != correlate.ReasonSameInstant {
		t.Errorf("wrong reason: %q (want %q)", cands[0].Reason, correlate.ReasonSameInstant)
	}
}

// A month apart is still the same match — the instant is the match's, not
// the capture's, so there is no window to age out of.
func TestFindRecapturedMatches_MonthApart_StillFlags(t *testing.T) {
	snap := recapSnap("match-2026-04-10T18-05-22")
	snap.Summaries[0].Filename = "Overwatch 2 Screenshot 2026.04.10 - 18.05.22.11.png"
	if cands := correlate.NewDuplicateScan(snap).CandidatesFor(recapNewKey); len(cands) != 1 {
		t.Fatalf("expected the flag to survive a month, got %d (%+v)", len(cands), cands)
	}
}

func TestFindRecapturedMatches_DifferentInstant_NoFlag(t *testing.T) {
	snap := recapSnap("match-2026-05-10T18-05-22")
	snap.Summaries[0].PlayedAtUTC = new("2026-05-11T00:05:00Z")
	if cands := correlate.NewDuplicateScan(snap).CandidatesFor(recapNewKey); cands != nil {
		t.Errorf("one minute apart is two matches, got %+v", cands)
	}
}

// Same instant, different outcome: something is wrong with one of the two
// readings, and guessing which would corrupt a real match.
func TestFindRecapturedMatches_SameInstantDifferentResult_NoFlag(t *testing.T) {
	snap := recapSnap("match-2026-05-10T18-05-22")
	snap.Summaries[0].Result = "defeat"
	if cands := correlate.NewDuplicateScan(snap).CandidatesFor(recapNewKey); cands != nil {
		t.Errorf("expected no flag on a conflicting result, got %+v", cands)
	}
}

func TestFindRecapturedMatches_SameInstantDifferentMap_NoFlag(t *testing.T) {
	snap := recapSnap("match-2026-05-10T18-05-22")
	snap.Summaries[0].Map = "hanaoka"
	if cands := correlate.NewDuplicateScan(snap).CandidatesFor(recapNewKey); cands != nil {
		t.Errorf("expected no flag on a conflicting map, got %+v", cands)
	}
}

// NULL played_at_utc is the honest "we could not place this match" — the
// date or finished_at cell did not OCR. Two unplaceable matches are not
// thereby the same match.
func TestFindRecapturedMatches_NoInstant_NoFlag(t *testing.T) {
	snap := recapSnap("match-2026-05-10T18-05-22")
	snap.Summaries[0].PlayedAtUTC = nil
	snap.Summaries[1].PlayedAtUTC = nil
	if cands := correlate.NewDuplicateScan(snap).CandidatesFor(recapNewKey); cands != nil {
		t.Errorf("expected no flag without an instant, got %+v", cands)
	}
}

// An untracked key (an ambiguous sentinel, an unmatched row) is not a match
// the user can be sent to.
func TestFindRecapturedMatches_UntrackedCandidate_NoFlag(t *testing.T) {
	snap := recapSnap("ambiguous-2026-05-10T18-05-22")
	if cands := correlate.NewDuplicateScan(snap).CandidatesFor(recapNewKey); cands != nil {
		t.Errorf("expected no flag toward an untracked key, got %+v", cands)
	}
}

// Both producers see the same pair when a re-captured match happens to
// carry a TEAMS shot too. The user must be offered ONE candidate, not the
// same match twice under two labels.
func TestFindDuplicateCandidates_BothProducersOneKey_Deduped(t *testing.T) {
	origKey := "match-2026-05-10T18-05-22"
	snap := recapSnap(origKey)
	snap.Teams = []db.TeamsRow{
		{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 18.05.22.11.png",
			MatchKey:     origKey,
			Eliminations: 17, Assists: 16, Deaths: 11,
			Damage: 12843, Healing: 9021, Mitigation: 3310,
		},
		{
			Filename:     "Overwatch 2 Screenshot 2026.05.10 - 21.14.03.02.png",
			MatchKey:     recapNewKey,
			Eliminations: 17, Assists: 16, Deaths: 11,
			Damage: 12843, Healing: 9021, Mitigation: 3310,
		},
	}

	cands := correlate.NewDuplicateScan(snap).CandidatesFor(recapNewKey)
	if len(cands) != 1 {
		t.Fatalf("expected the pair offered once, got %d (%+v)", len(cands), cands)
	}
	if cands[0].Reason != correlate.ReasonDuplicateStats {
		t.Errorf("reason = %q, want the stat-line producer's %q",
			cands[0].Reason, correlate.ReasonDuplicateStats)
	}
}

// Neither producer subsumes the other: with no TEAMS rows at all, only the
// re-capture sweep can speak, and the merged entry point must still report.
func TestFindDuplicateCandidates_SummaryOnly_StillReports(t *testing.T) {
	cands := correlate.NewDuplicateScan(recapSnap("match-2026-05-10T18-05-22")).CandidatesFor(recapNewKey)
	if len(cands) != 1 || cands[0].Reason != correlate.ReasonSameInstant {
		t.Fatalf("expected one same_instant candidate, got %+v", cands)
	}
}

// The one repeated hour of a DST fall-back resolves two different matches
// to the same UTC instant. Identity alone cannot separate them, which is
// why the fingerprint is six fields wide: the corroborating fields are what
// stop a real match being demoted out of the user's history.
//
// The hero case is belt-and-braces — RowsConflict already vetoes a hero
// mismatch, and this passes with hero out of the fingerprint entirely. It
// is here so the veto's coverage of this path is pinned where the reader
// is thinking about it. The length case below is the one that fails
// without its field.
func TestFindRecapturedMatches_SameInstantDifferentHero_NoFlag(t *testing.T) {
	snap := recapSnap("match-2026-05-10T18-05-22")
	snap.Summaries[0].Hero = "juno"
	if cands := correlate.NewDuplicateScan(snap).CandidatesFor(recapNewKey); cands != nil {
		t.Errorf("expected no flag on a conflicting hero, got %+v", cands)
	}
}

func TestFindRecapturedMatches_SameInstantDifferentLength_NoFlag(t *testing.T) {
	snap := recapSnap("match-2026-05-10T18-05-22")
	snap.Summaries[0].GameLength = "07:12"
	snap.Summaries[1].GameLength = "14:38"
	if cands := correlate.NewDuplicateScan(snap).CandidatesFor(recapNewKey); cands != nil {
		t.Errorf("expected no flag on a conflicting game length, got %+v", cands)
	}
}
