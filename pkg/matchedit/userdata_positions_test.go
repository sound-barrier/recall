package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/db/dbtest"
	"recall/pkg/match"
	"recall/pkg/matchedit"
)

// position 0 is the PRIMARY hero — it drives the card header, the derived role,
// and which hero the match reports as played. Two heroes claiming it is not a
// roster the app can render: the reader sorts on position alone, so the SQL
// tiebreak decides, alphabetically and stably. "ana" would lead "reinhardt"
// every time, which reads as data rather than as the corruption it is.
//
// The UI never sends one — it assigns position from the list index — so this
// arrives from a non-UI client or a hand-edited bundle, and it must bounce.
func TestSetUserData_RejectsTwoHeroesAtOnePosition(t *testing.T) {
	err := matchedit.SetUserData(&dbtest.Fake{}, "m1", match.UserMatchDataInput{
		Heroes: []match.UserHeroInput{
			{Hero: "ana", Position: 0},
			{Hero: "reinhardt", Position: 0},
		},
	})
	if !errors.Is(err, matchedit.ErrDuplicateHeroPosition) {
		t.Fatalf("err = %v, want ErrDuplicateHeroPosition", err)
	}
}

// An ordered roster passes the new check and fails no earlier than it used to
// — the "match not found" below is the store speaking, which means validation
// let it through.
func TestSetUserData_AnOrderedRosterClearsTheCheck(t *testing.T) {
	err := matchedit.SetUserData(&dbtest.Fake{}, "m1", match.UserMatchDataInput{
		Heroes: []match.UserHeroInput{
			{Hero: "ana", Position: 0},
			{Hero: "reinhardt", Position: 1},
		},
	})
	if errors.Is(err, matchedit.ErrDuplicateHeroPosition) {
		t.Fatalf("SetUserData = %v, want an ordered roster to clear the position check", err)
	}
}
