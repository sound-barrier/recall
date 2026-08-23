package db_test

import (
	"slices"
	"testing"

	"recall/pkg/db"
)

// The write-side contract of the self-review family, run against BOTH
// stores: what a re-save replaces, what a delete removes, which writes
// count as work on the sitting (and bump its updated_at) and which are a
// replay (and leave it), how repeats in a member list collapse, and the
// reviewed_only note a first moment opens.

const seededInstant = "2026-01-01T10:00:00Z"

// seedSittingAt creates a sitting over A and B whose instants are all the
// seeded one, so any later change to updated_at is observable.
func seedSittingAt(t *testing.T, s db.Store) string {
	t.Helper()
	r, err := s.CreateSelfReview(db.SelfReview{
		CreatedAt: seededInstant, UpdatedAt: seededInstant, MatchKeys: []string{reviewKeyA, reviewKeyB},
	})
	mustNoErr(t, err)
	return r.ReviewID
}

func loadSitting(t *testing.T, s db.Store, reviewID string) db.SelfReview {
	t.Helper()
	got, ok, err := s.LoadSelfReview(reviewID)
	mustNoErr(t, err)
	if !ok {
		t.Fatalf("review %q not found", reviewID)
	}
	return got
}

func TestSelfReviewContract_DeleteMomentRemovesOnlyThatMoment(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			reviewID := seedSittingAt(t, s)
			for _, m := range []db.SelfReviewMoment{
				{MomentID: "m-1", MatchClock: "04:45", Text: "first"},
				{MomentID: "m-2", MatchClock: "09:10", Text: "second"},
			} {
				_, err := s.UpsertSelfReviewMoment(db.SelfReviewNoteRef{ReviewID: reviewID, MatchKey: reviewKeyA}, m)
				mustNoErr(t, err)
			}
			mustNoErr(t, s.DeleteSelfReviewMoment(db.SelfReviewMomentRef{ReviewID: reviewID, MatchKey: reviewKeyA, MomentID: "m-1"}))
			moments := loadSitting(t, s, reviewID).Notes[reviewKeyA].Moments
			if len(moments) != 1 || moments[0].MomentID != "m-2" || moments[0].Text != "second" {
				t.Errorf("moments after deleting m-1 = %+v, want m-2 alone", moments)
			}
		})
	}
}

// A note re-save replaces kind, text, clock and the tag sets wholesale.
func TestSelfReviewContract_NoteResaveReplacesEveryField(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			reviewID := seedSittingAt(t, s)
			_, err := s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: reviewID, MatchKey: reviewKeyA, Kind: "reviewed_only"})
			mustNoErr(t, err)
			_, err = s.UpsertSelfReviewNote(db.SelfReviewNote{
				ReviewID: reviewID, MatchKey: reviewKeyA, Kind: "note", Text: "now with words", MatchClock: "06:40",
				FocusTags: []string{"mental"}, ExtraTags: []string{"tempo"},
			})
			mustNoErr(t, err)
			note := loadSitting(t, s, reviewID).Notes[reviewKeyA]
			if note.Kind != "note" || note.Text != "now with words" || note.MatchClock != "06:40" {
				t.Errorf("note after re-save = %+v, want kind/text/clock replaced", note)
			}
			if !slices.Equal(note.FocusTags, []string{"mental"}) || !slices.Equal(note.ExtraTags, []string{"tempo"}) {
				t.Errorf("tags after re-save = %v / %v, want [mental] / [tempo]", note.FocusTags, note.ExtraTags)
			}
		})
	}
}

// A moment re-save under the same id replaces text, clock, tag and order.
func TestSelfReviewContract_MomentResaveReplacesEveryField(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			reviewID := seedSittingAt(t, s)
			_, err := s.UpsertSelfReviewMoment(db.SelfReviewNoteRef{ReviewID: reviewID, MatchKey: reviewKeyA}, db.SelfReviewMoment{MomentID: "m-1", MatchClock: "04:45", Text: "first"})
			mustNoErr(t, err)
			_, err = s.UpsertSelfReviewMoment(db.SelfReviewNoteRef{ReviewID: reviewID, MatchKey: reviewKeyA}, db.SelfReviewMoment{
				MomentID: "m-1", MatchClock: "07:30", Text: "first, reworded", FocusTag: "cooldowns", SortOrder: 3,
			})
			mustNoErr(t, err)
			moments := loadSitting(t, s, reviewID).Notes[reviewKeyA].Moments
			if len(moments) != 1 {
				t.Fatalf("moments after re-save = %+v, want the one moment", moments)
			}
			m := moments[0]
			if m.MatchClock != "07:30" || m.Text != "first, reworded" || m.FocusTag != "cooldowns" || m.SortOrder != 3 {
				t.Errorf("moment after re-save = %+v, want clock/text/tag/order replaced", m)
			}
		})
	}
}

// touchCase is one write against a seeded sitting and whether it is live
// work (bumps updated_at) or a replay (leaves it).
type touchCase struct {
	name  string
	write func(t *testing.T, s db.Store, reviewID string)
	live  bool
}

func touchCases() []touchCase {
	replayNote := db.SelfReviewNote{MatchKey: reviewKeyA, Kind: "note", Text: "replayed", CreatedAt: seededInstant, UpdatedAt: seededInstant}
	replayMoment := db.SelfReviewMoment{MomentID: "m-1", MatchClock: "04:45", Text: "replayed", CreatedAt: seededInstant, UpdatedAt: seededInstant}
	return []touchCase{
		{"live note", func(t *testing.T, s db.Store, id string) {
			t.Helper()
			_, err := s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: id, MatchKey: reviewKeyA, Kind: "note", Text: "live"})
			mustNoErr(t, err)
		}, true},
		{"live moment", func(t *testing.T, s db.Store, id string) {
			t.Helper()
			_, err := s.UpsertSelfReviewMoment(db.SelfReviewNoteRef{ReviewID: id, MatchKey: reviewKeyA}, db.SelfReviewMoment{MomentID: "m-1", MatchClock: "04:45", Text: "live"})
			mustNoErr(t, err)
		}, true},
		{"delete note", func(t *testing.T, s db.Store, id string) {
			t.Helper()
			n := replayNote
			n.ReviewID = id
			_, err := s.UpsertSelfReviewNote(n)
			mustNoErr(t, err)
			mustNoErr(t, s.DeleteSelfReviewNote(db.SelfReviewNoteRef{ReviewID: id, MatchKey: reviewKeyA}))
		}, true},
		{"delete moment", func(t *testing.T, s db.Store, id string) {
			t.Helper()
			_, err := s.UpsertSelfReviewMoment(db.SelfReviewNoteRef{ReviewID: id, MatchKey: reviewKeyA}, replayMoment)
			mustNoErr(t, err)
			mustNoErr(t, s.DeleteSelfReviewMoment(db.SelfReviewMomentRef{ReviewID: id, MatchKey: reviewKeyA, MomentID: "m-1"}))
		}, true},
		{"replay note", func(t *testing.T, s db.Store, id string) {
			t.Helper()
			n := replayNote
			n.ReviewID = id
			_, err := s.UpsertSelfReviewNote(n)
			mustNoErr(t, err)
		}, false},
		{"replay moment", func(t *testing.T, s db.Store, id string) {
			t.Helper()
			_, err := s.UpsertSelfReviewMoment(db.SelfReviewNoteRef{ReviewID: id, MatchKey: reviewKeyA}, replayMoment)
			mustNoErr(t, err)
		}, false},
	}
}

// A live note or moment write, and any delete, is work on the sitting and
// bumps its updated_at; a write carrying its own instant is a replay (a
// restore, a move) and leaves the sitting's stamp alone.
func TestSelfReviewContract_LiveWritesTouchTheSittingAndReplaysDoNot(t *testing.T) {
	for _, impl := range storeImpls {
		for _, tc := range touchCases() {
			t.Run(impl.name+"/"+tc.name, func(t *testing.T) {
				s := impl.open(t)
				reviewID := seedSittingAt(t, s)
				tc.write(t, s, reviewID)
				got := loadSitting(t, s, reviewID)
				if bumped := got.UpdatedAt != seededInstant; bumped != tc.live {
					t.Errorf("updated_at = %q after %s (seeded %q); live=%v", got.UpdatedAt, tc.name, seededInstant, tc.live)
				}
			})
		}
	}
}

// A repeated key in a member list is a caller's slip, not a second
// membership: it collapses to its first position on create and on replace.
func TestSelfReviewContract_RepeatedMemberKeysCollapse(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			created, err := s.CreateSelfReview(db.SelfReview{MatchKeys: []string{reviewKeyA, reviewKeyA, reviewKeyB}})
			mustNoErr(t, err)
			want := []string{reviewKeyA, reviewKeyB}
			if !slices.Equal(created.MatchKeys, want) {
				t.Errorf("created members = %v, want %v", created.MatchKeys, want)
			}
			if got := loadSitting(t, s, created.ReviewID).MatchKeys; !slices.Equal(got, want) {
				t.Errorf("stored members after create = %v, want %v", got, want)
			}
			mustNoErr(t, s.SetSelfReviewMatches(created.ReviewID, []string{reviewKeyA, reviewKeyB, reviewKeyA}))
			if got := loadSitting(t, s, created.ReviewID).MatchKeys; !slices.Equal(got, want) {
				t.Errorf("stored members after replace = %v, want %v", got, want)
			}
		})
	}
}

// A moment on a member with no note yet opens a reviewed_only note in the
// same call — the moment IS a review of the match.
func TestSelfReviewContract_FirstMomentOpensAReviewedOnlyNote(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			reviewID := seedSittingAt(t, s)
			_, err := s.UpsertSelfReviewMoment(db.SelfReviewNoteRef{ReviewID: reviewID, MatchKey: reviewKeyB}, db.SelfReviewMoment{MomentID: "m-1", MatchClock: "01:00", Text: "opened by a moment"})
			mustNoErr(t, err)
			note, has := loadSitting(t, s, reviewID).Notes[reviewKeyB]
			if !has || note.Kind != "reviewed_only" {
				t.Fatalf("note on the moment's match = %+v (present=%v), want a reviewed_only one", note, has)
			}
			if len(note.Moments) != 1 || note.Moments[0].MomentID != "m-1" {
				t.Errorf("the opened note does not carry the moment: %+v", note.Moments)
			}
		})
	}
}
