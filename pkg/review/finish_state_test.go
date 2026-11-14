package review_test

import (
	"errors"
	"testing"

	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/matchedit"
	"recall/pkg/review"
)

// flakyMarks fails the reviewed-flag write for one key, standing in for a
// crash or a full disk between the finish stamp and the last mark.
type flakyMarks struct {
	*dbtest.Fake
	failOn string
}

func (f flakyMarks) SetReview(matchKey, reviewedBy string) error {
	if matchKey == f.failOn {
		return errors.New("disk full")
	}
	return f.Fake.SetReview(matchKey, reviewedBy)
}

// Finish is one transition: the stamp and every reviewed mark land together
// or not at all. It used to stamp the sitting first and mark each match after,
// so a failure part-way left a finished sitting over unmarked matches.
func TestFinish_IsAllOrNothing(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA, keyB)

	_, _ = review.Finish(flakyMarks{Fake: s, failOn: keyB}, r.ReviewID)

	got := mustGet(t, s, r.ReviewID)
	flags, _ := s.LoadReviews()
	finished := got.FinishedAt != ""
	marked := flags[keyA].ReviewedBy == matchedit.ReviewedBySelf && flags[keyB].ReviewedBy == matchedit.ReviewedBySelf
	if finished != marked {
		t.Errorf("finished=%v but marked=%v, want the stamp and the marks together", finished, marked)
	}
}

// A finished sitting is on the record: every edit is refused, and the
// refusal is the 409 sentinel rather than a silent write.
func TestFinish_AFinishedSittingRefusesEdits(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA, keyB)
	_, err := review.PutNote(s, r.ReviewID, keyA, coach.NoteInput{Kind: "note", Text: "before"})
	mustNoErr(t, err)
	done, err := review.Finish(s, r.ReviewID)
	mustNoErr(t, err)
	if done.Status != review.StatusFinished {
		t.Errorf("status = %q, want %q", done.Status, review.StatusFinished)
	}

	ref := review.MomentRef{ReviewID: r.ReviewID, MatchKey: keyA, MomentID: "m-1"}
	assertRefused(t, []refusal{
		{"rename", func() error { _, err := review.Update(s, r.ReviewID, review.UpdateInput{Title: "x"}); return err }, review.ErrFinished},
		{"set matches", func() error { _, err := review.SetMatches(s, r.ReviewID, []string{keyA}); return err }, review.ErrFinished},
		{"put note", func() error {
			_, err := review.PutNote(s, r.ReviewID, keyA, coach.NoteInput{Kind: "note", Text: "after"})
			return err
		}, review.ErrFinished},
		{"delete note", func() error {
			return review.DeleteNote(s, db.SelfReviewNoteRef{ReviewID: r.ReviewID, MatchKey: keyA})
		}, review.ErrFinished},
		{"put moment", func() error {
			_, err := review.PutMoment(s, ref, matchedit.MomentInput{MatchClock: "01:00", Text: "x"})
			return err
		}, review.ErrFinished},
		{"delete moment", func() error { return review.DeleteMoment(s, ref) }, review.ErrFinished},
		{"focus items", func() error {
			return review.MapStoreErr(s.SetSelfReviewFocusItems(r.ReviewID, nil))
		}, review.ErrFinished},
	})
	// Finishing again is not an edit: it re-marks, and keeps the first stamp.
	again, err := review.Finish(s, r.ReviewID)
	mustNoErr(t, err)
	if again.FinishedAt != done.FinishedAt {
		t.Errorf("re-finish moved the stamp from %q to %q", done.FinishedAt, again.FinishedAt)
	}
}

// A sitting over nothing is not a sitting. Its members can all go (deleting
// a match drops the membership row), and finishing it would mark nothing
// and claim a review that never happened.
func TestFinish_RefusesASittingWithNoMembers(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA)
	mustNoErr(t, s.HardDeleteMatch(keyA))

	if _, err := review.Finish(s, r.ReviewID); !errors.Is(err, review.ErrNoMatches) {
		t.Errorf("Finish of an empty sitting = %v, want ErrNoMatches", err)
	}
}
