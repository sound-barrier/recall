package db_test

import (
	"errors"
	"testing"

	"recall/pkg/db"
)

// Contract suite for the self-review family, run against BOTH stores. The
// rules that matter here are the ones a constraint carries in SQL and a
// line of code carries in the Fake: a note lives and dies with its
// membership row, a review must exist and hold the match before a note
// lands on it, and first-save instants survive a re-save.

const (
	reviewKeyA = "match-2026-08-01T20-00-00"
	reviewKeyB = "match-2026-08-02T20-00-00"
	reviewKeyC = "match-2026-08-03T20-00-00"
)

func TestSelfReviewContract_RoundTrip(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			roundTripSelfReview(t, impl.open(t))
		})
	}
}

func roundTripSelfReview(t *testing.T, s db.Store) {
	t.Helper()
	reviewID := writeSitting(t, s)
	got, ok, err := s.LoadSelfReview(reviewID)
	mustNoErr(t, err)
	if !ok {
		t.Fatal("review not found after create")
	}
	if got.Title != "Tuesday's Ana games" {
		t.Errorf("title = %q", got.Title)
	}
	// Member order is the player's, not sorted.
	if len(got.MatchKeys) != 2 || got.MatchKeys[0] != reviewKeyB || got.MatchKeys[1] != reviewKeyA {
		t.Errorf("match keys = %v, want [%s %s]", got.MatchKeys, reviewKeyB, reviewKeyA)
	}
	assertNoteShape(t, got.Notes[reviewKeyA])
	assertMomentOrder(t, got.Notes[reviewKeyA].Moments)
	if _, has := got.Notes[reviewKeyB]; has {
		t.Error("a match with no note reads back a note")
	}
}

// writeSitting creates a sitting over B then A, retitles it, and puts a
// note on A with two moments written out of clock order.
func writeSitting(t *testing.T, s db.Store) string {
	t.Helper()
	created, err := s.CreateSelfReview(db.SelfReview{Title: "Tuesday Ana", MatchKeys: []string{reviewKeyB, reviewKeyA}})
	mustNoErr(t, err)
	if created.ReviewID == "" || created.CreatedAt == "" || created.UpdatedAt == "" || created.FinishedAt != "" {
		t.Fatalf("created = %+v, want a minted id, stamps, and no finish", created)
	}
	mustNoErr(t, s.UpdateSelfReview(created.ReviewID, "Tuesday's Ana games"))
	_, err = s.UpsertSelfReviewNote(db.SelfReviewNote{
		ReviewID: created.ReviewID, MatchKey: reviewKeyA, Kind: "note", Text: "held high ground",
		FocusTags: []string{"positioning", "positioning", ""}, ExtraTags: []string{"tempo"},
	})
	mustNoErr(t, err)
	_, err = s.UpsertSelfReviewMoment(created.ReviewID, reviewKeyA, db.SelfReviewMoment{MomentID: "m-2", MatchClock: "09:10", Text: "second", SortOrder: 1})
	mustNoErr(t, err)
	_, err = s.UpsertSelfReviewMoment(created.ReviewID, reviewKeyA, db.SelfReviewMoment{MomentID: "m-1", MatchClock: "04:45", Text: "first", FocusTag: "cooldowns"})
	mustNoErr(t, err)
	return created.ReviewID
}

func assertNoteShape(t *testing.T, note db.SelfReviewNote) {
	t.Helper()
	if note.Kind != "note" || note.Text != "held high ground" {
		t.Errorf("note = %+v", note)
	}
	if len(note.FocusTags) != 1 || note.FocusTags[0] != "positioning" || len(note.ExtraTags) != 1 {
		t.Errorf("tags = %v / %v, want deduped + empties dropped", note.FocusTags, note.ExtraTags)
	}
}

// Moments read back in clock order regardless of write order.
func assertMomentOrder(t *testing.T, moments []db.SelfReviewMoment) {
	t.Helper()
	if len(moments) != 2 || moments[0].MomentID != "m-1" || moments[1].MomentID != "m-2" {
		t.Errorf("moments = %+v, want m-1 then m-2", moments)
	}
	if moments[0].FocusTag != "cooldowns" {
		t.Errorf("moment tag = %q", moments[0].FocusTag)
	}
}

func TestSelfReviewContract_ListIsNewestFirstAndDeleteIsWhole(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			old, err := s.CreateSelfReview(db.SelfReview{ReviewID: "r-old", CreatedAt: "2026-08-01T10:00:00Z", MatchKeys: []string{reviewKeyA}})
			mustNoErr(t, err)
			recent, err := s.CreateSelfReview(db.SelfReview{ReviewID: "r-new", CreatedAt: "2026-08-10T10:00:00Z", MatchKeys: []string{reviewKeyA}})
			mustNoErr(t, err)
			_, err = s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: old.ReviewID, MatchKey: reviewKeyA, Kind: "note", Text: "old"})
			mustNoErr(t, err)

			all, err := s.LoadSelfReviews()
			mustNoErr(t, err)
			if len(all) != 2 || all[0].ReviewID != recent.ReviewID || all[1].ReviewID != old.ReviewID {
				t.Fatalf("list = %v, want newest first", all)
			}

			mustNoErr(t, s.DeleteSelfReview(old.ReviewID))
			mustNoErr(t, s.DeleteSelfReview(old.ReviewID)) // absent is a no-op
			all, err = s.LoadSelfReviews()
			mustNoErr(t, err)
			if len(all) != 1 {
				t.Fatalf("after delete, list = %v", all)
			}
			byMatch, err := s.LoadSelfReviewNotes()
			mustNoErr(t, err)
			if len(byMatch[reviewKeyA]) != 0 {
				t.Errorf("deleting the review left its note on the match: %+v", byMatch[reviewKeyA])
			}
		})
	}
}

// Membership carries the note: replacing the set drops the note of a match
// that leaves and keeps the note of one that stays.
func TestSelfReviewContract_MembershipReplaceCascadesNotes(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			r, err := s.CreateSelfReview(db.SelfReview{MatchKeys: []string{reviewKeyA, reviewKeyB}})
			mustNoErr(t, err)
			for _, k := range []string{reviewKeyA, reviewKeyB} {
				_, err = s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: r.ReviewID, MatchKey: k, Kind: "note", Text: k})
				mustNoErr(t, err)
			}
			mustNoErr(t, s.SetSelfReviewMatches(r.ReviewID, []string{reviewKeyC, reviewKeyB}))

			got, _, err := s.LoadSelfReview(r.ReviewID)
			mustNoErr(t, err)
			if len(got.MatchKeys) != 2 || got.MatchKeys[0] != reviewKeyC || got.MatchKeys[1] != reviewKeyB {
				t.Errorf("match keys = %v", got.MatchKeys)
			}
			if _, kept := got.Notes[reviewKeyB]; !kept {
				t.Error("the note on a match that stayed was lost")
			}
			if _, gone := got.Notes[reviewKeyA]; gone {
				t.Error("the note on a match that left survived")
			}
			if err := s.SetSelfReviewMatches("no-such-review", []string{reviewKeyA}); !errors.Is(err, db.ErrSelfReviewUnknown) {
				t.Errorf("SetSelfReviewMatches on a missing review = %v, want ErrSelfReviewUnknown", err)
			}
		})
	}
}

func TestSelfReviewContract_NoteAndMomentRefuseWhatIsNotThere(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			r, err := s.CreateSelfReview(db.SelfReview{MatchKeys: []string{reviewKeyA}})
			mustNoErr(t, err)
			assertRefusesWhatIsNotThere(t, s, r.ReviewID)
			// A tag outside the vocabulary is refused by the SQL CHECK; the Fake
			// has no CHECK, and the vocabulary is enforced above the store (pkg/review),
			// so only the SQL half is asserted here.
			if impl.name == "SQLStore" {
				if _, err := s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: r.ReviewID, MatchKey: reviewKeyA, Kind: "note", FocusTags: []string{"vibes"}}); err == nil {
					t.Error("a focus tag outside the vocabulary was accepted")
				}
			}
		})
	}
}

// assertRefusesWhatIsNotThere checks every write against a missing review,
// a non-member match, or a note that does not exist comes back with the
// sentinel that names the gap.
func assertRefusesWhatIsNotThere(t *testing.T, s db.Store, reviewID string) {
	t.Helper()
	refusals := []struct {
		name string
		call func() error
		want error
	}{
		{"note on a non-member", func() error {
			_, err := s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: reviewID, MatchKey: reviewKeyB, Kind: "note"})
			return err
		}, db.ErrSelfReviewMatchUnknown},
		{"note on a missing review", func() error {
			_, err := s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: "ghost", MatchKey: reviewKeyA, Kind: "note"})
			return err
		}, db.ErrSelfReviewUnknown},
		{"moment on a non-member", func() error {
			_, err := s.UpsertSelfReviewMoment(reviewID, reviewKeyB, db.SelfReviewMoment{MomentID: "m", MatchClock: "01:00", Text: "x"})
			return err
		}, db.ErrSelfReviewMatchUnknown},
		{"update missing", func() error { return s.UpdateSelfReview("ghost", "t") }, db.ErrSelfReviewUnknown},
		{"finish missing", func() error { return s.FinishSelfReview("ghost") }, db.ErrSelfReviewUnknown},
	}
	for _, tc := range refusals {
		if err := tc.call(); !errors.Is(err, tc.want) {
			t.Errorf("%s = %v, want %v", tc.name, err, tc.want)
		}
	}
}

// A re-save keeps created_at and the moments; a finish is idempotent.
func TestSelfReviewContract_ResaveKeepsFirstInstantAndMoments(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			r, err := s.CreateSelfReview(db.SelfReview{MatchKeys: []string{reviewKeyA}})
			mustNoErr(t, err)
			first, err := s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: r.ReviewID, MatchKey: reviewKeyA, Kind: "reviewed_only", CreatedAt: "2026-08-01T10:00:00Z"})
			mustNoErr(t, err)
			_, err = s.UpsertSelfReviewMoment(r.ReviewID, reviewKeyA, db.SelfReviewMoment{MomentID: "m-1", MatchClock: "04:45", Text: "x"})
			mustNoErr(t, err)
			second, err := s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: r.ReviewID, MatchKey: reviewKeyA, Kind: "note", Text: "now with words"})
			mustNoErr(t, err)
			if second.CreatedAt != first.CreatedAt || second.CreatedAt != "2026-08-01T10:00:00Z" {
				t.Errorf("created_at = %q then %q, want the supplied first instant kept", first.CreatedAt, second.CreatedAt)
			}
			if len(second.Moments) != 1 {
				t.Errorf("a re-save dropped the moments: %+v", second.Moments)
			}
			assertFinishKeepsTheFirstStamp(t, s)
		})
	}
}

// assertFinishKeepsTheFirstStamp seeds a sitting already finished at a
// supplied instant, so a second finish's "keep the first stamp" is checked
// against a value the clock cannot coincide with — two finishes inside one
// second would otherwise pass vacuously.
func assertFinishKeepsTheFirstStamp(t *testing.T, s db.Store) {
	t.Helper()
	const firstStamp = "2026-01-01T10:00:00Z"
	done, err := s.CreateSelfReview(db.SelfReview{FinishedAt: firstStamp, MatchKeys: []string{reviewKeyA}})
	mustNoErr(t, err)
	if done.FinishedAt != firstStamp {
		t.Fatalf("created finished_at = %q, want the supplied %q", done.FinishedAt, firstStamp)
	}
	mustNoErr(t, s.FinishSelfReview(done.ReviewID))
	again, _, err := s.LoadSelfReview(done.ReviewID)
	mustNoErr(t, err)
	if again.FinishedAt != firstStamp {
		t.Errorf("finished_at after a second finish = %q, want the first stamp %q kept", again.FinishedAt, firstStamp)
	}
}

// The aggregator's read: every note keyed by match, oldest sitting first,
// carrying the review's identity.
func TestSelfReviewContract_NotesByMatchCarryTheirReview(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			notesByMatchCarryTheirReview(t, impl.open(t))
		})
	}
}

func notesByMatchCarryTheirReview(t *testing.T, s db.Store) {
	t.Helper()
	later := seedTwoSittingsOnA(t, s)
	byMatch, err := s.LoadSelfReviewNotes()
	mustNoErr(t, err)
	blocks := byMatch[reviewKeyA]
	if len(blocks) != 2 || blocks[0].ReviewID != "r-a" || blocks[1].ReviewID != "r-b" {
		t.Fatalf("blocks = %+v, want the earlier sitting first", blocks)
	}
	if blocks[0].ReviewTitle != "Earlier" || blocks[0].ReviewFinishedAt == "" || blocks[1].ReviewFinishedAt != "" {
		t.Errorf("review identity on the block = %+v / %+v", blocks[0], blocks[1])
	}
	// The delete of one note is scoped to its review.
	mustNoErr(t, s.DeleteSelfReviewNote(later, reviewKeyA))
	byMatch, err = s.LoadSelfReviewNotes()
	mustNoErr(t, err)
	if len(byMatch[reviewKeyA]) != 1 || byMatch[reviewKeyA][0].ReviewID != "r-a" {
		t.Errorf("after deleting r-b's note, blocks = %+v", byMatch[reviewKeyA])
	}
	mustNoErr(t, s.DeleteSelfReviewMoment(later, reviewKeyA, "nope")) // absent, no-op
}

// seedTwoSittingsOnA puts a later and an earlier sitting on match A, each
// with a note, and finishes only the earlier one; it returns the later
// sitting's id, the one the caller deletes from.
func seedTwoSittingsOnA(t *testing.T, s db.Store) string {
	t.Helper()
	later, err := s.CreateSelfReview(db.SelfReview{ReviewID: "r-b", Title: "Later", CreatedAt: "2026-08-10T10:00:00Z", MatchKeys: []string{reviewKeyA}})
	mustNoErr(t, err)
	earlier, err := s.CreateSelfReview(db.SelfReview{ReviewID: "r-a", Title: "Earlier", CreatedAt: "2026-08-01T10:00:00Z", MatchKeys: []string{reviewKeyA}})
	mustNoErr(t, err)
	for _, id := range []string{later.ReviewID, earlier.ReviewID} {
		_, err = s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: id, MatchKey: reviewKeyA, Kind: "note", Text: id})
		mustNoErr(t, err)
	}
	mustNoErr(t, s.FinishSelfReview(earlier.ReviewID))
	return later.ReviewID
}
