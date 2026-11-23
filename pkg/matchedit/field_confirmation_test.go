package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/match"
	"recall/pkg/matchedit"
	"recall/pkg/parser"
)

// Confirming a flagged reading stores the value the match reads NOW, taken
// from the flag the read path built. The client says which value it showed
// the user only as a precondition: when a parse has changed the reading
// since, the confirmation is refused rather than bound to a number the user
// never looked at.

var elimsField = parser.ScalarPath("eliminations")

// flaggedMatch is m1 with its eliminations flagged, reading 74 now.
func flaggedMatch(state match.FlagState) match.Record {
	return match.Record{MatchKey: "m1", FieldFlags: []match.FieldFlag{{
		Field: elimsField, Value: "74", State: state, Checks: []match.CheckID{match.CheckPerfTotalVsRate},
	}}}
}

func TestConfirmFieldReading_StoresTheValueTheFlagHolds(t *testing.T) {
	fake := seeded("m1")

	mustNoErr(t, matchedit.ConfirmFieldReading(fake, flaggedMatch(match.FlagOpen), elimsField, "74"))

	confirmed, _ := fake.LoadFieldConfirmations()
	if got := confirmed["m1"][elimsField]; got != "74" {
		t.Errorf("confirmed value = %q, want 74; confirmations = %v", got, confirmed)
	}
}

// PUT is idempotent: confirming a confirmed reading again succeeds and keeps
// the value.
func TestConfirmFieldReading_AgainIsIdempotent(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.ConfirmFieldReading(fake, flaggedMatch(match.FlagOpen), elimsField, "74"))

	mustNoErr(t, matchedit.ConfirmFieldReading(fake, flaggedMatch(match.FlagConfirmed), elimsField, "74"))

	if confirmed, _ := fake.LoadFieldConfirmations(); confirmed["m1"][elimsField] != "74" {
		t.Errorf("confirmations = %v, want 74 kept", confirmed)
	}
}

func TestConfirmFieldReading_RefusesWhatIsNotAFlagToConfirm(t *testing.T) {
	for name, tc := range map[string]struct {
		rec   match.Record
		field parser.FieldPath
	}{
		"no flag on the match":       {match.Record{MatchKey: "m1"}, elimsField},
		"a flag on another field":    {flaggedMatch(match.FlagOpen), parser.ScalarPath("deaths")},
		"a flag the user's edit set": {flaggedMatch(match.FlagEdited), elimsField},
	} {
		t.Run(name, func(t *testing.T) {
			fake := seeded("m1")

			err := matchedit.ConfirmFieldReading(fake, tc.rec, tc.field, "74")

			if !errors.Is(err, matchedit.ErrNothingToConfirm) {
				t.Errorf("err = %v, want ErrNothingToConfirm", err)
			}
			if confirmed, _ := fake.LoadFieldConfirmations(); len(confirmed) != 0 {
				t.Errorf("a refused confirmation stored %v", confirmed)
			}
		})
	}
}

// The user was shown 47; a parse has since made the match read 74. Binding the
// confirmation to 74 would vouch for a number nobody looked at.
func TestConfirmFieldReading_RefusesAReadingThatChangedSinceItWasShown(t *testing.T) {
	fake := seeded("m1")

	err := matchedit.ConfirmFieldReading(fake, flaggedMatch(match.FlagOpen), elimsField, "47")

	if !errors.Is(err, matchedit.ErrReadingChanged) {
		t.Errorf("err = %v, want ErrReadingChanged", err)
	}
	if confirmed, _ := fake.LoadFieldConfirmations(); len(confirmed) != 0 {
		t.Errorf("a stale confirmation stored %v", confirmed)
	}
}

// Unconfirming is a removal: idempotent, and like the other removals it does
// not ask whether the match exists, so an undo never fails.
func TestUnconfirmFieldReading_IsIdempotent(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.ConfirmFieldReading(fake, flaggedMatch(match.FlagOpen), elimsField, "74"))

	mustNoErr(t, matchedit.UnconfirmFieldReading(fake, "m1", elimsField))
	mustNoErr(t, matchedit.UnconfirmFieldReading(fake, "m1", elimsField))
	mustNoErr(t, matchedit.UnconfirmFieldReading(fake, "never-seen", elimsField))

	if confirmed, _ := fake.LoadFieldConfirmations(); len(confirmed) != 0 {
		t.Errorf("confirmation survived removal: %v", confirmed)
	}
}

func TestUnconfirmFieldReading_EmptyKeyIsRefused(t *testing.T) {
	if err := matchedit.UnconfirmFieldReading(seeded(), "", elimsField); !errors.Is(err, matchedit.ErrMatchKeyRequired) {
		t.Errorf("err = %v, want ErrMatchKeyRequired", err)
	}
}
