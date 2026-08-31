package app_test

import (
	"testing"
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// End-of-run duplicate-sweep tests: a match created during a parse run
// whose full TEAMS stat line equals an existing match's (30 min – 7 days
// apart) is demoted to the ambiguous queue with the existing match as a
// duplicate candidate — regardless of the file order the second capture
// set arrived in. Pre-existing matches are never demoted (ReParseAll is
// a no-op by construction).

const (
	origTeamsFile   = "Overwatch 2 Screenshot 2026.05.10 - 18.05.22.11.png"
	origSummaryFile = "Overwatch 2 Screenshot 2026.05.10 - 18.05.24.11.png"
	origKey         = "match-2026-05-10T18-05-22"

	dupTeamsFile   = "Overwatch 2 Screenshot 2026.05.10 - 21.14.03.02.png"
	dupSummaryFile = "Overwatch 2 Screenshot 2026.05.10 - 21.14.05.02.png"
)

// The sentinel anchors on the demoted match's earliest source file.
var dupSentinel = match.NewAmbiguousMatchKey(dupTeamsFile).String()

func dupTeamsResult() *parser.MatchResult {
	return &parser.MatchResult{
		Eliminations: 17, Assists: 16, Deaths: 11,
		Damage: 12843, Healing: 9021, Mitigation: 3310,
	}
}

func dupSummaryResult() *parser.MatchResult {
	return &parser.MatchResult{Result: "victory", Map: "rialto", Hero: "lucio", Date: "2026-05-10"}
}

func seedOriginalMatch(fake *fakeStore) {
	fake.Teams = append(fake.Teams, db.TeamsRow{
		Filename: origTeamsFile, MatchKey: origKey,
		Eliminations: 17, Assists: 16, Deaths: 11,
		Damage: 12843, Healing: 9021, Mitigation: 3310,
	})
	fake.Summaries = append(fake.Summaries, db.SummaryRow{
		Filename: origSummaryFile, MatchKey: origKey, Map: "rialto", Hero: "lucio",
	})
}

// assertDemoted verifies the second capture set was pulled into the
// ambiguous queue with the original as its duplicate candidate.
func assertDemoted(t *testing.T, fake *fakeStore) {
	t.Helper()
	assertRowsDemoted(t, fake)
	cands := fake.Ambiguous[dupTeamsFile]
	if len(cands) != 1 || cands[0].MatchKey != origKey {
		t.Fatalf("expected the original as the sole duplicate candidate, got %+v", fake.Ambiguous)
	}
	if cands[0].DistanceSeconds != 11321 {
		t.Errorf("wrong candidate distance: %d (want 11321)", cands[0].DistanceSeconds)
	}
}

// assertRowsDemoted verifies the dup capture's rows moved onto the sentinel
// while the original's rows stayed untouched.
func assertRowsDemoted(t *testing.T, fake *fakeStore) {
	t.Helper()
	for _, r := range fake.Teams {
		if r.Filename == dupTeamsFile && r.MatchKey != dupSentinel {
			t.Errorf("dup teams row not demoted: %q", r.MatchKey)
		}
		if r.Filename == origTeamsFile && r.MatchKey != origKey {
			t.Errorf("original teams row must be untouched: %q", r.MatchKey)
		}
	}
	for _, r := range fake.Summaries {
		if r.Filename == dupSummaryFile && r.MatchKey != dupSentinel {
			t.Errorf("dup summary row not demoted: %q", r.MatchKey)
		}
	}
}

func TestDuplicateSweep_SecondCaptureSet_TeamsFirst_Demoted(t *testing.T) {
	a, fake := newParseReadyApp(t)
	seedOriginalMatch(fake)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 2, dupTeamsFile, dupTeamsResult(), nil)
		progress(2, 2, dupSummaryFile, dupSummaryResult(), nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	assertDemoted(t, fake)
}

func TestDuplicateSweep_SecondCaptureSet_SummaryFirst_Demoted(t *testing.T) {
	// The order that defeats any per-file check: the SUMMARY (no
	// damage, can't fingerprint) mints the set's fresh key and the
	// TEAMS then joins it via the timestamp window — only an
	// end-of-run sweep over the completed set can catch this.
	a, fake := newParseReadyApp(t)
	seedOriginalMatch(fake)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 2, dupSummaryFile, dupSummaryResult(), nil)
		progress(2, 2, dupTeamsFile, dupTeamsResult(), nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	assertDemoted(t, fake)
}

func TestDuplicateSweep_ReParseAll_NeverDemotesExistingMatches(t *testing.T) {
	// A force re-parse re-delivers files whose match already exists:
	// every key pre-exists the run, so the sweep must not touch them —
	// even though the store holds an identical stat line under the
	// re-adopted key for the duration of the run.
	a, fake := newParseReadyApp(t)
	seedOriginalMatch(fake)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 2, origTeamsFile, dupTeamsResult(), nil)
		progress(2, 2, origSummaryFile, dupSummaryResult(), nil)
		return nil
	})
	if err := a.ReParseAll(); err != nil {
		t.Fatalf("ReParseAll: %v", err)
	}
	for _, r := range fake.Teams {
		if r.MatchKey != origKey {
			t.Errorf("re-parsed row demoted: %+v", r)
		}
	}
	if len(fake.Ambiguous) != 0 {
		t.Errorf("expected no ambiguity from a re-parse, got %+v", fake.Ambiguous)
	}
}

func TestDuplicateSweep_NoStatLineTwin_StaysTracked(t *testing.T) {
	a, fake := newParseReadyApp(t)
	seedOriginalMatch(fake)
	stubParse(t, func(progress parser.ProgressFunc) error {
		res := dupTeamsResult()
		res.Damage = 9999 // different line — a genuinely new match
		progress(1, 1, dupTeamsFile, res, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	for _, r := range fake.Teams {
		if r.Filename == dupTeamsFile && r.MatchKey != "match-2026-05-10T21-14-03" {
			t.Errorf("non-duplicate match must keep its tracked key, got %q", r.MatchKey)
		}
	}
	if len(fake.Ambiguous) != 0 {
		t.Errorf("expected no ambiguity, got %+v", fake.Ambiguous)
	}
}

func TestDuplicateSweep_BothSetsInOneRun_EarlierSurvives(t *testing.T) {
	// Fresh store, both capture sets in a single run: the earlier match
	// survives tracked; the later is demoted with the earlier as its
	// candidate. Pins the survivors-so-far filter — without it the
	// earlier match would flag the later as ITS duplicate first.
	a, fake := newParseReadyApp(t)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 4, origTeamsFile, dupTeamsResult(), nil)
		progress(2, 4, origSummaryFile, dupSummaryResult(), nil)
		progress(3, 4, dupTeamsFile, dupTeamsResult(), nil)
		progress(4, 4, dupSummaryFile, dupSummaryResult(), nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	assertDemoted(t, fake)
}

// The re-capture sweep — the same match screenshotted twice with no TEAMS
// shot on either side. The stat-line fingerprint lives on the TEAMS
// scoreboard, so it has nothing to compare here and the two copies would
// both stay tracked; what the SUMMARY rows agree on instead is the match's
// own identity: the instant it ended, the map, the result, the score.
const (
	recapOrigFile = "Overwatch 2 Screenshot 2026.05.10 - 18.05.24.11.png"
	recapOrigKey  = "match-2026-05-10T18-05-24"
	recapDupFile  = "Overwatch 2 Screenshot 2026.05.10 - 21.14.05.02.png"
)

var recapSentinel = match.NewAmbiguousMatchKey(recapDupFile).String()

func recapSummaryResult() *parser.MatchResult {
	return &parser.MatchResult{
		Map: "rialto", Hero: "lucio", Result: "victory", FinalScore: "3-1",
		Date: "2026-05-10", FinishedAt: "18:04",
	}
}

// seedRecapturedOriginal seeds a SUMMARY-only original — deliberately no
// TEAMS row, which is what makes the stat-line sweep blind to it.
//
// The instant is DERIVED, not written down. The re-capture's instant is
// recomputed by the real parse path from time.Local, so a hard-coded Z
// string agrees with it in exactly one timezone — and this test passed on a
// UTC-6 laptop while failing on CI, which runs UTC.
func seedRecapturedOriginal(t *testing.T, fake *fakeStore) {
	t.Helper()
	at, ok := match.LocalWallClockToUTC("2026-05-10", "18:04", time.Local)
	if !ok {
		t.Skip("host cannot convert the wall clock")
	}
	instant := at.Format(time.RFC3339)
	fake.Summaries = append(fake.Summaries, db.SummaryRow{
		Filename: recapOrigFile, MatchKey: recapOrigKey,
		Map: "rialto", Hero: "lucio", Result: "victory", FinalScore: "3-1",
		Date: "2026-05-10", FinishedAt: "18:04", PlayedAtUTC: &instant,
	})
}

func TestDuplicateSweep_SummaryOnlyRecapture_Demoted(t *testing.T) {
	a, fake := newParseReadyApp(t)
	seedRecapturedOriginal(t, fake)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, recapDupFile, recapSummaryResult(), nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	for _, r := range fake.Summaries {
		if r.Filename == recapDupFile && r.MatchKey != recapSentinel {
			t.Errorf("re-capture not demoted: %q", r.MatchKey)
		}
		if r.Filename == recapOrigFile && r.MatchKey != recapOrigKey {
			t.Errorf("original must be untouched: %q", r.MatchKey)
		}
	}
	cands := fake.Ambiguous[recapDupFile]
	if len(cands) != 1 || cands[0].MatchKey != recapOrigKey {
		t.Fatalf("expected the original as the sole candidate, got %+v", fake.Ambiguous)
	}
	if cands[0].Reason != "same_instant" {
		t.Errorf("candidate reason = %q, want %q", cands[0].Reason, "same_instant")
	}
}

// A different match that merely happens to be captured nearby: same map and
// hero, one minute later on the scoreboard. Nothing about it is the same
// game, and demoting it would cost the user a real match.
func TestDuplicateSweep_DifferentInstant_StaysTracked(t *testing.T) {
	a, fake := newParseReadyApp(t)
	seedRecapturedOriginal(t, fake)
	stubParse(t, func(progress parser.ProgressFunc) error {
		res := recapSummaryResult()
		res.FinishedAt = "18:05"
		progress(1, 1, recapDupFile, res, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if len(fake.Ambiguous) != 0 {
		t.Errorf("a match one minute later is a different match, got %+v", fake.Ambiguous)
	}
}
