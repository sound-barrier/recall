package app_test

import (
	"errors"
	"recall/pkg/db"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
	"recall/pkg/matchedit"
	"recall/pkg/review"
	"recall/pkg/sse"
)

// The self-review loop end to end at the orchestrator, over the player's
// own corpus (playerCorpus: a Rialto match already reviewed by SELF, an
// Ilios match, and a manual Dorado match): open a sitting over three keys,
// write two notes, three moments and a summary, finish, and read the matches
// back the way the UI does — then delete the sitting and check what stays.

func selfReviewApp(t *testing.T) (*app.App, *dbtest.Fake) {
	t.Helper()
	a, store := playerApp(t)
	// playerCorpus carries a finished-shape sitting for the fidelity gate;
	// these tests want an empty shelf to write on.
	mustNoErr(t, store.DeleteSelfReview("self-review-1"))
	// A coach has already reviewed Ilios; the finish must not overwrite that.
	mustNoErr(t, store.SetReview(playerMatchIlios, matchedit.ReviewedByCoach))
	return a, store
}

func recordByKey(t *testing.T, a *app.App, key string) match.Record {
	t.Helper()
	rec, err := a.GetMatchByKey(key)
	mustNoErr(t, err)
	return rec
}

func TestSelfReview_RoundTripThroughTheOrchestrator(t *testing.T) {
	a, _ := selfReviewApp(t)
	r := writeSitting(t, a)
	assertLiveBlocks(t, a, r.ReviewID)

	done, err := a.FinishSelfReview(r.ReviewID)
	mustNoErr(t, err)
	if done.FinishedAt == "" || len(done.FocusItems) != 1 || done.FocusItems[0].Text != "Stop chasing flanks." {
		t.Errorf("finished = %+v", done)
	}
	assertFinishFlags(t, a)

	// List and get agree with what was written.
	list, err := a.ListSelfReviews()
	mustNoErr(t, err)
	if len(list) != 1 || len(list[0].MatchKeys) != 3 || len(list[0].Notes) != 2 {
		t.Errorf("list = %+v, want one sitting over 3 keys with 2 notes", list)
	}

	// Delete: the blocks go, the reviewed flags stay.
	mustNoErr(t, a.DeleteSelfReview(r.ReviewID))
	mustNoErr(t, a.DeleteSelfReview(r.ReviewID)) // absent is a no-op
	if got := recordByKey(t, a, playerMatchRialto); len(got.SelfReviewNotes) != 0 || got.ReviewedBy != matchedit.ReviewedBySelf {
		t.Errorf("after delete: blocks = %+v, reviewed_by = %q; want no blocks, flag kept", got.SelfReviewNotes, got.ReviewedBy)
	}
	if _, err := a.GetSelfReview(r.ReviewID); !errors.Is(err, review.ErrNotFound) {
		t.Errorf("Get after delete = %v", err)
	}
}

// writeSitting opens a sitting over all three corpus keys and writes the
// notes, moments and summary the round trip reads back: a note with two
// moments on Rialto (written out of clock order), a moment alone on Ilios,
// nothing on the manual match.
func writeSitting(t *testing.T, a *app.App) review.Session {
	t.Helper()
	keys := []string{playerMatchRialto, playerMatchIlios, playerMatchManual}
	r, err := a.CreateSelfReview(review.CreateInput{Title: "Sunday set", MatchKeys: keys})
	mustNoErr(t, err)
	_, err = a.PutSelfReviewNote(r.ReviewID, playerMatchRialto, coach.NoteInput{Kind: "note", Text: "held the choke", FocusTags: []string{"positioning"}})
	mustNoErr(t, err)
	_, err = a.PutSelfReviewMoment(r.ReviewID, playerMatchRialto, "m-b", matchedit.MomentInput{MatchClock: "9:10", Text: "late"})
	mustNoErr(t, err)
	_, err = a.PutSelfReviewMoment(r.ReviewID, playerMatchRialto, "m-a", matchedit.MomentInput{MatchClock: "4:45", Text: "early", FocusTag: "cooldowns"})
	mustNoErr(t, err)
	// A moment on a match with no note opens the note.
	_, err = a.PutSelfReviewMoment(r.ReviewID, playerMatchIlios, "m-c", matchedit.MomentInput{MatchClock: "1:00", Text: "opened by a moment"})
	mustNoErr(t, err)
	_, err = a.UpdateSelfReview(r.ReviewID, review.UpdateInput{Title: "Sunday set"})
	mustNoErr(t, err)
	_, err = a.SetSelfReviewFocusItems(r.ReviewID, []db.FocusItem{{ItemID: "b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e", Text: "Stop chasing flanks."}})
	mustNoErr(t, err)
	return r
}

// assertLiveBlocks reads the three members back the way the UI does, before
// finish: the block is on the match already, marked in progress.
func assertLiveBlocks(t *testing.T, a *app.App, reviewID string) {
	t.Helper()
	rialto := recordByKey(t, a, playerMatchRialto)
	if len(rialto.SelfReviewNotes) != 1 {
		t.Fatalf("Rialto self blocks before finish = %+v, want the one in progress", rialto.SelfReviewNotes)
	}
	assertBlockInProgress(t, rialto.SelfReviewNotes[0], reviewID)
	ilios := recordByKey(t, a, playerMatchIlios)
	if len(ilios.SelfReviewNotes) != 1 || ilios.SelfReviewNotes[0].Kind != coach.KindReviewedOnly || len(ilios.SelfReviewNotes[0].Moments) != 1 {
		t.Errorf("Ilios block = %+v, want a reviewed_only note carrying its moment", ilios.SelfReviewNotes)
	}
	if manual := recordByKey(t, a, playerMatchManual); len(manual.SelfReviewNotes) != 0 {
		t.Errorf("the untouched member has a block: %+v", manual.SelfReviewNotes)
	}
}

func assertBlockInProgress(t *testing.T, block match.SelfReviewNote, reviewID string) {
	t.Helper()
	if block.ReviewID != reviewID || block.ReviewTitle != "Sunday set" || block.ReviewFinishedAt != "" || block.Text != "held the choke" {
		t.Errorf("block = %+v", block)
	}
	if len(block.Moments) != 2 || block.Moments[0].MomentID != "m-a" || block.Moments[1].MomentID != "m-b" {
		t.Errorf("moments = %+v, want clock order", block.Moments)
	}
}

// assertFinishFlags checks what a finish stamps: self on the members a coach
// has not marked, the coach mark kept on Ilios, and the block reading as
// finished.
func assertFinishFlags(t *testing.T, a *app.App) {
	t.Helper()
	for _, k := range []string{playerMatchRialto, playerMatchManual} {
		if got := recordByKey(t, a, k).ReviewedBy; got != matchedit.ReviewedBySelf {
			t.Errorf("%s reviewed_by after finish = %q, want self", k, got)
		}
	}
	if got := recordByKey(t, a, playerMatchIlios).ReviewedBy; got != matchedit.ReviewedByCoach {
		t.Errorf("Ilios reviewed_by after finish = %q, want the coach mark kept", got)
	}
	if got := recordByKey(t, a, playerMatchRialto).SelfReviewNotes[0].ReviewFinishedAt; got == "" {
		t.Error("the block does not read as finished after finish")
	}
}

// Design rule 2 for the sitting: a create or a set-matches naming a key this
// database has never seen is refused whole, and writes nothing.
func TestSelfReview_RefusesAnUnknownKey(t *testing.T) {
	a, store := selfReviewApp(t)
	if _, err := a.CreateSelfReview(review.CreateInput{MatchKeys: []string{playerMatchRialto, strayKey}}); !errors.Is(err, match.ErrMatchNotFound) {
		t.Errorf("create with a stray key = %v, want match.ErrMatchNotFound", err)
	}
	if reviews, _ := store.LoadSelfReviews(); len(reviews) != 0 {
		t.Errorf("a refused create wrote a sitting: %+v", reviews)
	}
	r, err := a.CreateSelfReview(review.CreateInput{MatchKeys: []string{playerMatchRialto}})
	mustNoErr(t, err)
	if _, err := a.SetSelfReviewMatches(r.ReviewID, []string{strayKey}); !errors.Is(err, match.ErrMatchNotFound) {
		t.Errorf("set-matches with a stray key = %v", err)
	}
	got, err := a.GetSelfReview(r.ReviewID)
	mustNoErr(t, err)
	if len(got.MatchKeys) != 1 || got.MatchKeys[0] != playerMatchRialto {
		t.Errorf("a refused set-matches changed the set: %v", got.MatchKeys)
	}
	// A note on a match outside the sitting is a 404-shaped refusal.
	if _, err := a.PutSelfReviewNote(r.ReviewID, playerMatchIlios, coach.NoteInput{Kind: "note", Text: "x"}); !errors.Is(err, review.ErrMatchNotInReview) {
		t.Errorf("note outside the sitting = %v", err)
	}
	if _, err := a.PutSelfReviewNote("ghost", playerMatchRialto, coach.NoteInput{Kind: "note", Text: "x"}); !errors.Is(err, review.ErrNotFound) {
		t.Errorf("note on a ghost sitting = %v", err)
	}
}

// Removing a match from the sitting takes its note off that match; the
// review keeps the others. Hard-deleting a member match does the same from
// the other direction, and the sitting survives.
func TestSelfReview_MembershipChangesFollowThrough(t *testing.T) {
	a, _ := selfReviewApp(t)
	r, err := a.CreateSelfReview(review.CreateInput{MatchKeys: []string{playerMatchRialto, playerMatchIlios}})
	mustNoErr(t, err)
	for _, k := range []string{playerMatchRialto, playerMatchIlios} {
		_, err = a.PutSelfReviewNote(r.ReviewID, k, coach.NoteInput{Kind: "note", Text: k})
		mustNoErr(t, err)
	}
	if _, err := a.SetSelfReviewMatches(r.ReviewID, []string{playerMatchIlios}); err != nil {
		t.Fatal(err)
	}
	if got := recordByKey(t, a, playerMatchRialto); len(got.SelfReviewNotes) != 0 {
		t.Errorf("Rialto left the sitting but keeps a block: %+v", got.SelfReviewNotes)
	}
	if got := recordByKey(t, a, playerMatchIlios); len(got.SelfReviewNotes) != 1 {
		t.Errorf("Ilios stayed and lost its block")
	}
	mustNoErr(t, a.HardDeleteMatch(playerMatchIlios))
	got, err := a.GetSelfReview(r.ReviewID)
	mustNoErr(t, err)
	if len(got.MatchKeys) != 0 || len(got.Notes) != 0 {
		t.Errorf("after hard-deleting the last member the sitting = %+v, want kept with no members", got)
	}
}

// The shell's second job after the gate: a write that changes what a match
// shows re-broadcasts that match, so an open detail panel repaints the block
// without a reload. Read off the SSE hub the way the re-parse test does.
func TestSelfReview_WritesBroadcastTheMatchesTheyTouch(t *testing.T) {
	a, _ := selfReviewApp(t)
	a.SSEHub = app.NewSSEHub()
	events := a.SSEHub.Subscribe()
	r, err := a.CreateSelfReview(review.CreateInput{MatchKeys: []string{playerMatchRialto, playerMatchIlios}})
	mustNoErr(t, err)

	_, err = a.PutSelfReviewNote(r.ReviewID, playerMatchRialto, coach.NoteInput{Kind: "note", Text: "held the choke"})
	mustNoErr(t, err)
	assertMatchUpdated(t, events, playerMatchRialto, "held the choke")

	_, err = a.FinishSelfReview(r.ReviewID)
	mustNoErr(t, err)
	// Rialto flips to self; Ilios keeps its coach mark and is re-broadcast too.
	assertMatchUpdated(t, events, playerMatchRialto, `"reviewed_by":"self"`)
	assertMatchUpdated(t, events, playerMatchIlios, `"reviewed_by":"coach"`)

	mustNoErr(t, a.DeleteSelfReview(r.ReviewID))
	assertMatchUpdated(t, events, playerMatchRialto, "")
}

// assertMatchUpdated drains the hub until a match-updated event for key
// arrives, and checks its payload carries want (when non-empty).
func assertMatchUpdated(t *testing.T, events <-chan sse.Msg, key, want string) {
	t.Helper()
	for {
		select {
		case msg := <-events:
			if msg.Event != "match-updated" || !strings.Contains(msg.Data, key) {
				continue
			}
			if want != "" && !strings.Contains(msg.Data, want) {
				t.Fatalf("match-updated for %s lacks %q: %s", key, want, msg.Data)
			}
			return
		default:
			t.Fatalf("no match-updated event observed for %s", key)
		}
	}
}
