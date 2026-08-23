package review_test

import (
	"errors"
	"testing"

	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
	"recall/pkg/matchedit"
	"recall/pkg/review"
)

const (
	keyA = "match-2026-08-01T20-00-00"
	keyB = "match-2026-08-02T20-00-00"
	keyC = "match-2026-08-03T20-00-00"
)

// A store holding three real matches — the unknown-key guard reads the
// registry, so the keys must exist as parent rows.
func storeWithMatches(t *testing.T) *dbtest.Fake {
	t.Helper()
	s := &dbtest.Fake{}
	for i, k := range []string{keyA, keyB, keyC} {
		if err := s.UpsertSummary(db.SummaryRow{Filename: string(rune('a'+i)) + ".png", MatchKey: k, Map: "rialto"}); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func mustCreate(t *testing.T, s review.Store, keys ...string) review.Session {
	t.Helper()
	r, err := review.Create(s, review.CreateInput{Title: "  Tuesday Ana  ", MatchKeys: keys})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	return r
}

func mustNoErr(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func mustGet(t *testing.T, s review.Store, reviewID string) review.Session {
	t.Helper()
	got, err := review.Get(s, reviewID)
	mustNoErr(t, err)
	return got
}

func mustPutMoment(t *testing.T, s review.Store, reviewID, momentID string, in matchedit.MomentInput) review.Moment {
	t.Helper()
	m, err := review.PutMoment(s, review.MomentRef{ReviewID: reviewID, MatchKey: keyA, MomentID: momentID}, in)
	mustNoErr(t, err)
	return m
}

// refusal is one call the package must turn away with a specific sentinel.
type refusal struct {
	name string
	call func() error
	want error
}

func assertRefused(t *testing.T, refusals []refusal) {
	t.Helper()
	for _, r := range refusals {
		if err := r.call(); !errors.Is(err, r.want) {
			t.Errorf("%s = %v, want %v", r.name, err, r.want)
		}
	}
}

func TestCreate_NormalizesAndGuards(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyB, " ", keyA, keyB)
	if r.Title != "Tuesday Ana" {
		t.Errorf("title = %q, want trimmed", r.Title)
	}
	if len(r.MatchKeys) != 2 || r.MatchKeys[0] != keyB || r.MatchKeys[1] != keyA {
		t.Errorf("keys = %v, want deduped in the player's order", r.MatchKeys)
	}
	if _, err := review.Create(s, review.CreateInput{MatchKeys: []string{" ", ""}}); !errors.Is(err, review.ErrNoMatches) {
		t.Errorf("empty set = %v, want ErrNoMatches", err)
	}
	if _, err := review.Create(s, review.CreateInput{MatchKeys: []string{keyA, "match-1999-01-01T00-00-00"}}); !errors.Is(err, match.ErrMatchNotFound) {
		t.Errorf("unknown key = %v, want match.ErrMatchNotFound", err)
	}
	if list, _ := review.List(s); len(list) != 1 {
		t.Errorf("a refused create left something behind: %d reviews", len(list))
	}
	long := make([]byte, review.MaxTitleRunes+1)
	for i := range long {
		long[i] = 'x'
	}
	if _, err := review.Create(s, review.CreateInput{Title: string(long), MatchKeys: []string{keyA}}); !errors.Is(err, review.ErrTitleInvalid) {
		t.Errorf("long title = %v, want ErrTitleInvalid", err)
	}
}

func TestGetUpdateSetMatches(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA, keyB)
	assertRefused(t, []refusal{
		{"Get ghost", func() error { _, err := review.Get(s, "ghost"); return err }, review.ErrNotFound},
		{"Update ghost", func() error { _, err := review.Update(s, "ghost", review.UpdateInput{}); return err }, review.ErrNotFound},
		{"SetMatches empty", func() error { _, err := review.SetMatches(s, r.ReviewID, nil); return err }, review.ErrNoMatches},
	})
	updated, err := review.Update(s, r.ReviewID, review.UpdateInput{Title: " Ilios control "})
	if err != nil || updated.Title != "Ilios control" {
		t.Errorf("Update = %+v, %v", updated, err)
	}
	_, err = review.PutNote(s, r.ReviewID, keyA, coach.NoteInput{Kind: "note", Text: "kept"})
	mustNoErr(t, err)
	set, err := review.SetMatches(s, r.ReviewID, []string{keyC, keyA})
	mustNoErr(t, err)
	if len(set.MatchKeys) != 2 || set.MatchKeys[0] != keyC || len(set.Notes) != 1 {
		t.Errorf("SetMatches = %+v, want [C A] with A's note kept", set)
	}
}

func TestDelete_IsANoOpWhenAbsentAndUnfindsTheSitting(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA, keyB)
	mustNoErr(t, review.Delete(s, r.ReviewID))
	if err := review.Delete(s, r.ReviewID); err != nil {
		t.Errorf("second delete = %v, want no-op", err)
	}
	if _, err := review.Get(s, r.ReviewID); !errors.Is(err, review.ErrNotFound) {
		t.Errorf("after delete = %v", err)
	}
}

func TestPutNote_ObeysTheCoachNoteRules(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA)
	n, err := review.PutNote(s, r.ReviewID, keyA, coach.NoteInput{
		Kind: "note", Text: " held the choke ", FocusTags: []string{"positioning", "positioning"}, ExtraTags: []string{"Tempo", "tempo"},
	})
	mustNoErr(t, err)
	if n.Text != "held the choke" || len(n.FocusTags) != 1 || len(n.ExtraTags) != 1 {
		t.Errorf("note = %+v, want normalized like a coach note", n)
	}
	putNote := func(reviewID, key string, in coach.NoteInput) func() error {
		return func() error { _, err := review.PutNote(s, reviewID, key, in); return err }
	}
	assertRefused(t, []refusal{
		{"empty note", putNote(r.ReviewID, keyA, coach.NoteInput{Kind: "note"}), coach.ErrNoteInvalid},
		{"bad tag", putNote(r.ReviewID, keyA, coach.NoteInput{Kind: "note", FocusTags: []string{"vibes"}}), coach.ErrNoteInvalid},
		{"non-member", putNote(r.ReviewID, keyB, coach.NoteInput{Kind: "note", Text: "x"}), review.ErrMatchNotInReview},
		{"ghost review", putNote("ghost", keyA, coach.NoteInput{Kind: "note", Text: "x"}), review.ErrNotFound},
	})
	mustNoErr(t, review.DeleteNote(s, db.SelfReviewNoteRef{ReviewID: r.ReviewID, MatchKey: keyA}))
	if got := mustGet(t, s, r.ReviewID); len(got.Notes) != 0 {
		t.Errorf("note survived delete: %+v", got.Notes)
	}
}

// A moment on a match with no note opens a reviewed_only note first — the
// same rule the coach's room applies — and a moment on a match outside the
// sitting is refused before anything is written.
func TestPutMoment_OpensAReviewedOnlyNoteAndKeepsReadingOrder(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA)
	m2 := mustPutMoment(t, s, r.ReviewID, "m-2", matchedit.MomentInput{MatchClock: "9:10", Text: "second"})
	if m2.MatchClock != "09:10" || m2.SortOrder != 0 {
		t.Errorf("first moment = %+v, want zero-padded clock at order 0", m2)
	}
	m1 := mustPutMoment(t, s, r.ReviewID, "m-1", matchedit.MomentInput{MatchClock: "04:45", Text: "first", FocusTag: "cooldowns"})
	if m1.SortOrder != 1 {
		t.Errorf("second write's order = %d, want after every place taken", m1.SortOrder)
	}
	note := mustGet(t, s, r.ReviewID).Notes[keyA]
	if note.Kind != coach.KindReviewedOnly {
		t.Errorf("note kind = %q, want reviewed_only opened for the moment", note.Kind)
	}
	if len(note.Moments) != 2 || note.Moments[0].MomentID != "m-1" {
		t.Errorf("moments = %+v, want clock order", note.Moments)
	}
	// An edit keeps its place.
	if edited := mustPutMoment(t, s, r.ReviewID, "m-2", matchedit.MomentInput{MatchClock: "09:10", Text: "second, reworded"}); edited.SortOrder != 0 {
		t.Errorf("edit = %+v; want order 0 kept", edited)
	}
	putMoment := func(key, momentID string, in matchedit.MomentInput) func() error {
		return func() error {
			_, err := review.PutMoment(s, review.MomentRef{ReviewID: r.ReviewID, MatchKey: key, MomentID: momentID}, in)
			return err
		}
	}
	assertRefused(t, []refusal{
		{"non-member", putMoment(keyB, "m-9", matchedit.MomentInput{MatchClock: "01:00", Text: "x"}), review.ErrMatchNotInReview},
		{"no id", putMoment(keyA, "", matchedit.MomentInput{MatchClock: "01:00", Text: "x"}), matchedit.ErrInvalidMoment},
		{"empty text", putMoment(keyA, "m-3", matchedit.MomentInput{MatchClock: "1:00", Text: " "}), matchedit.ErrMomentEmpty},
	})
	mustNoErr(t, review.DeleteMoment(s, review.MomentRef{ReviewID: r.ReviewID, MatchKey: keyA, MomentID: "m-1"}))
	if got := mustGet(t, s, r.ReviewID); len(got.Notes[keyA].Moments) != 1 {
		t.Errorf("moment survived delete: %+v", got.Notes[keyA].Moments)
	}
}

func TestPutMoment_Ceiling(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA)
	for i := range matchedit.MaxMomentsPerMatch {
		mustPutMoment(t, s, r.ReviewID, "m-"+string(rune('a'+i%26))+string(rune('a'+i/26)), matchedit.MomentInput{MatchClock: "01:00", Text: "x"})
	}
	if _, err := review.PutMoment(s, review.MomentRef{ReviewID: r.ReviewID, MatchKey: keyA, MomentID: "one-too-many"}, matchedit.MomentInput{MatchClock: "01:00", Text: "x"}); !errors.Is(err, matchedit.ErrInvalidMoment) {
		t.Errorf("past the ceiling = %v, want ErrInvalidMoment", err)
	}
}

// Finish stamps every member reviewed by self — except where a coach already
// has (the coach mark outranks in both directions) — and is idempotent.
// Deleting the sitting afterwards leaves the flags: finishing was a fact about
// the match, the delete is a fact about the notes.
func TestFinish_StampsSelfWhereACoachHasNot(t *testing.T) {
	s := storeWithMatches(t)
	mustNoErr(t, s.SetReview(keyB, matchedit.ReviewedByCoach))
	r := mustCreate(t, s, keyA, keyB)
	done, err := review.Finish(s, r.ReviewID)
	mustNoErr(t, err)
	if done.FinishedAt == "" {
		t.Error("finish left no stamp")
	}
	flags, _ := s.LoadReviews()
	if flags[keyA].ReviewedBy != matchedit.ReviewedBySelf {
		t.Errorf("%s reviewed_by = %q, want self", keyA, flags[keyA].ReviewedBy)
	}
	if flags[keyB].ReviewedBy != matchedit.ReviewedByCoach {
		t.Errorf("%s reviewed_by = %q, want the coach mark kept", keyB, flags[keyB].ReviewedBy)
	}
	if _, has := flags[keyC]; has {
		t.Errorf("%s was not in the sitting and got a flag", keyC)
	}
	assertFinishKeepsTheFirstStamp(t, s)
	if _, err := review.Finish(s, "ghost"); !errors.Is(err, review.ErrNotFound) {
		t.Errorf("finish ghost = %v", err)
	}
	mustNoErr(t, review.Delete(s, r.ReviewID))
	flags, _ = s.LoadReviews()
	if flags[keyA].ReviewedBy != matchedit.ReviewedBySelf {
		t.Errorf("deleting the sitting cleared %s's reviewed flag", keyA)
	}
}

// assertFinishKeepsTheFirstStamp finishes a sitting already finished at a
// supplied instant, so "the first stamp is kept" is checked against a value
// the clock cannot coincide with — two finishes inside one second would
// otherwise agree vacuously.
func assertFinishKeepsTheFirstStamp(t *testing.T, s *dbtest.Fake) {
	t.Helper()
	const firstStamp = "2026-01-01T10:00:00Z"
	seeded, err := s.CreateSelfReview(db.SelfReview{FinishedAt: firstStamp, MatchKeys: []string{keyA}})
	mustNoErr(t, err)
	again, err := review.Finish(s, seeded.ReviewID)
	mustNoErr(t, err)
	if again.FinishedAt != firstStamp {
		t.Errorf("finish of an already-finished sitting = %q, want the first stamp %q kept", again.FinishedAt, firstStamp)
	}
}
