package db_test

import (
	"errors"
	"slices"
	"testing"

	"recall/pkg/db"
)

// The player's own timestamped moments, against every Store implementation.
//
// Both halves matter. The *scoping* rules are what stop a client-minted id
// from reaching across matches — the coach side paid for that lesson when a
// collision rewrote another player's observation, and this table repeats the
// design, so it repeats the guard. The *vocabulary* is the CHECK: this is the
// one moment table written straight from the API rather than from an
// already-validated notes file, so the constraint is the last thing between a
// client and a tag nothing can render.

func moment(momentID, matchKey, clock, text string) db.MatchMoment {
	return db.MatchMoment{MomentID: momentID, MatchKey: matchKey, MatchClock: clock, Text: text}
}

func momentTexts(t *testing.T, s db.Store, matchKey string) []string {
	t.Helper()
	all, err := s.LoadMatchMoments()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	out := make([]string, 0, len(all[matchKey]))
	for _, m := range all[matchKey] {
		out = append(out, m.Text)
	}
	return out
}

func TestMatchMoments_RoundTripInReadingOrder(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			for _, m := range []db.MatchMoment{
				moment("c", "m1", "09:00", "late"),
				moment("a", "m1", "03:23", "early"),
				moment("b", "m1", "10:00", "latest"),
			} {
				if _, err := s.UpsertMatchMoment(m); err != nil {
					t.Fatalf("upsert %s: %v", m.MomentID, err)
				}
			}

			// Clocks are normalized to MM:SS before they reach the store, so
			// string order IS clock order — "09:00" before "10:00". An
			// un-padded clock would put 10 before 9 and read backwards.
			if got := momentTexts(t, s, "m1"); !slices.Equal(got, []string{"early", "late", "latest"}) {
				t.Errorf("m1 reads back %v, want [early late latest]", got)
			}
		})
	}
}

func TestMatchMoments_AnEditKeepsItsIDAndItsMatch(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			saved, err := s.UpsertMatchMoment(moment("", "m1", "03:23", "first words"))
			if err != nil {
				t.Fatalf("upsert: %v", err)
			}
			if saved.MomentID == "" {
				t.Fatal("an empty id must be minted by the store")
			}

			edited, err := s.UpsertMatchMoment(moment(saved.MomentID, "m1", "03:24", "corrected"))
			if err != nil {
				t.Fatalf("edit: %v", err)
			}
			if edited.MomentID != saved.MomentID {
				t.Errorf("an edit minted a new id: %q → %q", saved.MomentID, edited.MomentID)
			}

			if got := momentTexts(t, s, "m1"); !slices.Equal(got, []string{"corrected"}) {
				t.Errorf("m1 reads back %v, want [corrected]", got)
			}
		})
	}
}

// The id comes from the client, so it is not a namespace to trust: the same
// id arriving on a different match must be refused, never silently move an
// observation from one match to another.
func TestMatchMoments_AnIDCannotReachAcrossMatches(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			saved, err := s.UpsertMatchMoment(moment("", "m1", "03:23", "mine"))
			if err != nil {
				t.Fatalf("upsert: %v", err)
			}

			if _, err := s.UpsertMatchMoment(moment(saved.MomentID, "m2", "03:23", "stolen")); !errors.Is(err, db.ErrMomentMatchMismatch) {
				t.Fatalf("want ErrMomentMatchMismatch, got %v", err)
			}
			if err := s.DeleteMatchMoment("m2", saved.MomentID); err != nil {
				t.Fatalf("delete on the wrong match should be a no-op, got %v", err)
			}

			if got := momentTexts(t, s, "m1"); !slices.Equal(got, []string{"mine"}) {
				t.Errorf("m1 reads back %v, want the original moment untouched", got)
			}
			if got := momentTexts(t, s, "m2"); len(got) != 0 {
				t.Errorf("m2 reads back %v, want nothing — the id belongs to m1", got)
			}
		})
	}
}

func TestMatchMoments_DeleteScopedToItsMatch(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			if _, err := s.UpsertMatchMoment(moment("a", "m1", "03:23", "keep")); err != nil {
				t.Fatalf("upsert: %v", err)
			}
			if err := s.DeleteMatchMoment("m1", "a"); err != nil {
				t.Fatalf("delete: %v", err)
			}
			if got := momentTexts(t, s, "m1"); len(got) != 0 {
				t.Errorf("m1 reads back %v, want the moment gone", got)
			}
		})
	}
}

// The literal list here is the fourth copy of the focus vocabulary — beside
// the CHECK, coach.FocusTags and matchedit.FocusTags. Spelled out rather than
// read from one of them so that this test FAILS when they drift, which is the
// whole point: a comment saying "keep the two CHECK lists in sync" kept
// nothing in sync.
var focusVocabulary = []string{
	"", "positioning", "ult_economy", "target_priority", "cooldowns",
	"hero_pick", "comms", "mechanics", "mental",
}

func TestMatchMoments_AcceptEveryVocabularyTagAndNothingElse(t *testing.T) {
	// SQLStore only: the CHECK is the behavior under test, and the Fake has
	// no constraint engine to answer for. Its own agreement with the
	// vocabulary is the validator's job, pinned in pkg/matchedit.
	s := openMemory(t)

	for i, tag := range focusVocabulary {
		m := moment("", "m1", "03:23", "x")
		m.FocusTag = tag
		if _, err := s.UpsertMatchMoment(m); err != nil {
			t.Errorf("vocabulary tag %d (%q) refused by the CHECK: %v", i, tag, err)
		}
	}

	m := moment("", "m1", "03:23", "x")
	m.FocusTag = "vibes"
	if _, err := s.UpsertMatchMoment(m); err == nil {
		t.Error("a tag outside the vocabulary was stored — the CHECK is missing or too wide")
	}
}
