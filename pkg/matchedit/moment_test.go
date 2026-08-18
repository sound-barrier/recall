package matchedit_test

import (
	"errors"
	"strings"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
	"recall/pkg/matchedit"
)

// The player's own timestamped moments. Every rule below was mutable without
// a single test noticing when this shipped — the review gutted the validator,
// the ordering and the cap all at once and the suite stayed green.

const momentKey = "match-2026-08-10T20-00-00"

func momentStore(t *testing.T) *dbtest.Fake {
	t.Helper()
	s := dbtest.New()
	if err := s.UpsertSummary(db.SummaryRow{
		Filename: "s.png", MatchKey: momentKey, Map: "rialto", Hero: "juno", Result: "victory",
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return s
}

func stamp(clock, text string) matchedit.MomentInput {
	return matchedit.MomentInput{MatchClock: clock, Text: text}
}

func TestSetMoment_KeepsAWellFormedMoment(t *testing.T) {
	s := momentStore(t)

	got, err := matchedit.SetMoment(s, momentKey, "", matchedit.MomentInput{
		MatchClock: " 4:45 ", Text: "  off-angle  ", FocusTag: "positioning",
	})
	if err != nil {
		t.Fatalf("SetMoment: %v", err)
	}
	if got.MatchClock != "04:45" {
		t.Errorf("clock should normalize to MM:SS, got %q", got.MatchClock)
	}
	if got.Text != "off-angle" {
		t.Errorf("text should be trimmed, got %q", got.Text)
	}
	if got.MomentID == "" {
		t.Error("a saved moment must carry a minted id")
	}
}

func TestSetMoment_RefusesWhatItCannotRead(t *testing.T) {
	s := momentStore(t)

	for _, tc := range []struct {
		name, clock, text, tag string
		want                   error
	}{
		// The message matters, not just the sentinel: without the explicit
		// empty case the pattern check still refuses it, with the far worse
		// `match clock "" is not MM:SS`.
		{"no clock", "", "says when?", "", matchedit.ErrInvalidMoment},
		{"three-digit minutes", "100:00", "x", "", matchedit.ErrInvalidMoment},
		{"seconds past 59", "4:75", "x", "", matchedit.ErrInvalidMoment},
		{"a tag outside the vocabulary", "4:45", "x", "vibes", matchedit.ErrInvalidMoment},
		{"no text", "4:45", "   ", "", matchedit.ErrMomentEmpty},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := matchedit.SetMoment(s, momentKey, "", matchedit.MomentInput{
				MatchClock: tc.clock, Text: tc.text, FocusTag: tc.tag,
			})
			if !errors.Is(err, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, err)
			}
			if tc.name == "no clock" && !strings.Contains(err.Error(), "needs a match clock") {
				t.Errorf("a clockless moment deserves the plain reason, got %q", err.Error())
			}
		})
	}
}

func TestSetMoment_CapsTheText(t *testing.T) {
	s := momentStore(t)

	_, err := matchedit.SetMoment(s, momentKey, "",
		stamp("4:45", strings.Repeat("x", matchedit.MaxMomentTextRunes+1)))
	if !errors.Is(err, matchedit.ErrInvalidMoment) {
		t.Fatalf("want ErrInvalidMoment, got %v", err)
	}
}

// Design rule 2: a write that CREATES a row must refuse a key this database
// has never seen. Every sidecar table is keyed on match_key with no foreign
// key behind it, so the row would be an orphan nothing reads back — and it
// would then travel through every export and profile move after.
func TestSetMoment_RefusesAKeyThisDatabaseDoesNotHave(t *testing.T) {
	s := momentStore(t)

	if _, err := matchedit.SetMoment(s, "match-ghost", "", stamp("4:45", "x")); !errors.Is(err, match.ErrMatchNotFound) {
		t.Fatalf("want ErrMatchNotFound, got %v", err)
	}
	if _, err := matchedit.SetMoment(s, "", "", stamp("4:45", "x")); !errors.Is(err, matchedit.ErrMatchKeyRequired) {
		t.Fatalf("want ErrMatchKeyRequired, got %v", err)
	}
}

// An edit keeps its place; a new moment goes after every order already taken.
// len(existing) collides with a survivor after any delete, and leaves the tie
// to whatever order rows come back in.
func TestSetMoment_OrderSurvivesAnEditAndADelete(t *testing.T) {
	s := momentStore(t)
	ids := make([]string, 0, 3)
	for _, text := range []string{"first", "second", "third"} {
		saved, err := matchedit.SetMoment(s, momentKey, "", stamp("4:45", text))
		if err != nil {
			t.Fatalf("seed %q: %v", text, err)
		}
		ids = append(ids, saved.MomentID)
	}

	edited, err := matchedit.SetMoment(s, momentKey, ids[0], stamp("4:45", "first, corrected"))
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	if edited.SortOrder != 0 {
		t.Errorf("an edit moved the moment from 0 to %d", edited.SortOrder)
	}

	if err := s.DeleteMatchMoment(momentKey, ids[1]); err != nil {
		t.Fatalf("delete: %v", err)
	}
	added, err := matchedit.SetMoment(s, momentKey, "", stamp("5:00", "after a delete"))
	if err != nil {
		t.Fatalf("add after delete: %v", err)
	}
	if added.SortOrder != 3 {
		t.Errorf("a new moment took a taken position: sort_order = %d, want past every survivor", added.SortOrder)
	}
}

// The ceiling stops a runaway client making a match unrenderable; an edit to
// one already stored always fits.
func TestSetMoment_CapsThemPerMatch(t *testing.T) {
	s := momentStore(t)
	var lastID string
	for i := range matchedit.MaxMomentsPerMatch {
		saved, err := matchedit.SetMoment(s, momentKey, "", stamp("4:45", "moment"))
		if err != nil {
			t.Fatalf("moment %d rejected early: %v", i, err)
		}
		lastID = saved.MomentID
	}

	if _, err := matchedit.SetMoment(s, momentKey, "", stamp("4:45", "one too many")); !errors.Is(err, matchedit.ErrInvalidMoment) {
		t.Fatalf("want ErrInvalidMoment past the cap, got %v", err)
	}
	if _, err := matchedit.SetMoment(s, momentKey, lastID, stamp("4:46", "edited at the cap")); err != nil {
		t.Errorf("an edit at the cap must still fit, got %v", err)
	}
}

// The vocabulary is a literal in this package AND in pkg/coach. Pinned here
// the way coach pins its own, so a silent edit fails a test rather than
// traveling through — the two lists exist so a player and their coach
// describe the same game in the same words.
func TestFocusTags_AreTheVocabularyTheCoachUses(t *testing.T) {
	want := []string{
		"positioning", "ult_economy", "target_priority", "cooldowns",
		"hero_pick", "comms", "mechanics", "mental",
	}
	if len(matchedit.FocusTags) != len(want) {
		t.Fatalf("FocusTags = %v, want %v", matchedit.FocusTags, want)
	}
	for i, tag := range want {
		if matchedit.FocusTags[i] != tag {
			t.Errorf("FocusTags[%d] = %q, want %q", i, matchedit.FocusTags[i], tag)
		}
	}
}
