package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/match"
	"recall/pkg/matchedit"
)

func replayInput(code string) match.ReplayMatchInput {
	return match.ReplayMatchInput{Code: code, Map: "ilios", Hero: "ana", Result: "victory", Date: "2026-08-15"}
}

// The match a coach's review creates when the player does not have it. Its
// key is minted from the code, which is the only identity the two sides can
// both arrive at.
func TestCreateFromReplay_MintsTheKeyFromTheCode(t *testing.T) {
	fake := seeded()

	key, err := matchedit.CreateFromReplay(fake, replayInput("a1b2c3"))
	if err != nil {
		t.Fatalf("CreateFromReplay: %v", err)
	}
	if key != "replay-A1B2C3" {
		t.Fatalf("key = %q, want replay-A1B2C3", key)
	}
	row, ok := fake.UserMatchData[key]
	if !ok {
		t.Fatal("no user-match row was written")
	}
	if row.Map == nil || *row.Map != "ilios" {
		t.Errorf("Map = %v, want ilios", row.Map)
	}
	// The code goes on the annotation, which is where every other path
	// keeps it — and is what lets a later import find this match again.
	if got := fake.Annotations[key].ReplayCode; got != "A1B2C3" {
		t.Errorf("annotation replay code = %q, want A1B2C3", got)
	}
}

// Importing the same archive twice must not 409 the way CreateManual does.
// A player who re-opens a file they already accepted is not making a
// mistake, and the second import has to be a quiet no-op.
func TestCreateFromReplay_IsIdempotent(t *testing.T) {
	fake := seeded()

	first, err := matchedit.CreateFromReplay(fake, replayInput("A1B2C3"))
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := matchedit.CreateFromReplay(fake, replayInput("A1B2C3"))
	if err != nil {
		t.Fatalf("second create must be a no-op, got: %v", err)
	}
	if first != second {
		t.Errorf("keys differ: %q vs %q", first, second)
	}
	if len(fake.UserMatchData) != 1 {
		t.Errorf("wrote %d rows, want 1", len(fake.UserMatchData))
	}
}

// A coach may have observed only the map — inventing a hero to satisfy a
// form would be fabricating data. Only omission is free; a value that IS
// supplied still has to be one the roster knows.
func TestCreateFromReplay_OnlyOmissionIsFree(t *testing.T) {
	fake := seeded()
	if _, err := matchedit.CreateFromReplay(fake, match.ReplayMatchInput{Code: "A1B2C3"}); err != nil {
		t.Fatalf("a match with nothing but a code is legal: %v", err)
	}

	for name, in := range map[string]match.ReplayMatchInput{
		"unknown map":    {Code: "D4E5F6", Map: "not-a-map"},
		"unknown hero":   {Code: "D4E5F6", Hero: "not-a-hero"},
		"invalid result": {Code: "D4E5F6", Result: "sideways"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := matchedit.CreateFromReplay(fake, in); err == nil {
				t.Fatalf("CreateFromReplay(%+v) = nil, want a refusal", in)
			}
		})
	}
}

func TestCreateFromReplay_RefusesAMalformedCode(t *testing.T) {
	fake := seeded()
	for _, code := range []string{"", "ABC", "TOOLONG7"} {
		if _, err := matchedit.CreateFromReplay(fake, replayInput(code)); !errors.Is(err, match.ErrInvalidReplayCode) {
			t.Errorf("CreateFromReplay(%q) error = %v, want ErrInvalidReplayCode", code, err)
		}
	}
}

// A match the player already has is theirs. If a code somehow names one,
// the create must not overwrite what they recorded with what a coach typed.
func TestCreateFromReplay_LeavesAnExistingMatchAlone(t *testing.T) {
	fake := seeded()
	first, err := matchedit.CreateFromReplay(fake, replayInput("A1B2C3"))
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := matchedit.CreateFromReplay(fake, match.ReplayMatchInput{Code: "A1B2C3", Map: "numbani"}); err != nil {
		t.Fatalf("second: %v", err)
	}
	if got := fake.UserMatchData[first].Map; got == nil || *got != "ilios" {
		t.Errorf("Map = %v, want the first write to stand", got)
	}
}
