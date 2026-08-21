package app_test

import (
	"slices"
	"testing"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/coachreturn"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// The whole loop, on real bytes, in one test.
//
// Player exports a share bundle -> a DIFFERENT install opens it as a session
// -> the coach marks three moments on one match, out of clock order ->
// exports the notes archive -> the player imports it -> accepts -> the
// moments are on the match, in clock order, beside the player's own words.
//
// Every leg of this has its own test, and that is exactly why this one is
// worth having: both bugs the reviews found in this feature lived BETWEEN
// legs, where each end was individually correct. A moments-only review
// carried nothing home because "a reviewed_only mark has nothing to keep" was
// true of notes and not of moments; the moments reached the aggregate on one
// read path and not the other. Neither leg's own test could see it.
//
// The archive is the real thing: ExportCoachNotes' bytes, fed to
// ImportMatches, which sniffs it as a notes file rather than a bundle.

// markMoments is the coach's half — several observations on one loaned match,
// written in the order they occurred to the coach rather than clock order.
func markMoments(t *testing.T, a *app.App, matchKey string, ins []coach.MomentInput) {
	t.Helper()
	for i, in := range ins {
		if _, err := a.PutCoachMoment(matchKey, "", in); err != nil {
			t.Fatalf("PutCoachMoment %d: %v", i, err)
		}
	}
}

// acceptWholeArchive is the player's half: import the coach's bytes, check the
// staged sheet still holds every moment, and accept the lot.
func acceptWholeArchive(t *testing.T, player *app.App, store *dbtest.Fake, archive []byte, wantMoments int) {
	t.Helper()
	outcome, err := player.ImportMatches(archive)
	mustNoErr(t, err)
	if outcome.Kind != app.ImportKindCoachNotes || outcome.Return == nil {
		t.Fatalf("import outcome = %+v, want a staged coach_notes return", outcome)
	}
	sheet := *outcome.Return
	if len(sheet.Notes) != 1 {
		t.Fatalf("staged notes = %d, want the one match that was marked", len(sheet.Notes))
	}
	if got := len(sheet.Notes[0].Moments); got != wantMoments {
		t.Fatalf("the staged sheet shows %d moments, want %d - lost between the "+
			"archive and the sheet", got, wantMoments)
	}
	decided, err := player.DecideCoachReturn(store.CoachReturns[0].ID,
		[]coachreturn.Verdict{{NoteID: sheet.Notes[0].NoteID, Decision: coachreturn.DecisionAccepted}})
	mustNoErr(t, err)
	if decided.Pending != 0 {
		t.Errorf("pending after accept = %d, want 0", decided.Pending)
	}
}

func momentClocks(block db.MatchCoachNote) []string {
	out := make([]string, 0, len(block.Moments))
	for _, m := range block.Moments {
		out = append(out, m.MatchClock)
	}
	return out
}

func TestCoachingLoop_MomentsSurviveTheWholeRoundTrip(t *testing.T) {
	coachApp, _ := openSession(t)

	// Deliberately out of order, and no overall note - a review that is
	// nothing BUT timestamps is the case that used to arrive empty.
	markMoments(t, coachApp, playerMatchRialto, []coach.MomentInput{
		{MatchClock: "4:45", Text: "flanking Cassidy behind you", FocusTag: "positioning"},
		{MatchClock: "3:23", Text: "no off-angle, the tank ate it alone", FocusTag: "positioning"},
		{MatchClock: "4:13", Text: "no ult tracking", FocusTag: "ult_economy"},
	})
	_, archive, err := coachApp.ExportCoachNotes()
	mustNoErr(t, err)

	player, store := playerApp(t)
	acceptWholeArchive(t, player, store, archive, 3)

	blocks, err := app.Store(player).LoadMatchCoachNotes()
	mustNoErr(t, err)
	onMatch := blocks[playerMatchRialto]
	if len(onMatch) != 1 {
		t.Fatalf("accepted blocks on the match = %d, want 1", len(onMatch))
	}

	// Clock order, not authored order: the coach wrote 4:45 first, and a
	// review reads down the match.
	if got := momentClocks(onMatch[0]); !slices.Equal(got, []string{"03:23", "04:13", "04:45"}) {
		t.Fatalf("moments read back %v, want [03:23 04:13 04:45] - the strip reads down the match", got)
	}
	if onMatch[0].Moments[0].Text != "no off-angle, the tank ate it alone" {
		t.Errorf("earliest moment = %q, want the 3:23 one", onMatch[0].Moments[0].Text)
	}
	if onMatch[0].Moments[1].FocusTag != "ult_economy" {
		t.Errorf("the tag did not survive: %q", onMatch[0].Moments[1].FocusTag)
	}

	// The coach layer is a layer, not a replacement: the player's own note on
	// this match reads back untouched beside it.
	annos, err := app.Store(player).LoadAnnotations()
	mustNoErr(t, err)
	if annos[playerMatchRialto].Note != "held the point" {
		t.Errorf("the player's own note = %q, want it untouched", annos[playerMatchRialto].Note)
	}

	// And the match reads as reviewed by a coach - the reviewed_only note the
	// server opened on the first moment is what carries that home.
	reviews, err := app.Store(player).LoadReviews()
	mustNoErr(t, err)
	if reviews[playerMatchRialto].ReviewedBy != "coach" {
		t.Errorf("reviewed_by = %q, want coach", reviews[playerMatchRialto].ReviewedBy)
	}
}
