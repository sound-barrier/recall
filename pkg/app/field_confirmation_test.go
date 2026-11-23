package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// Confirming a flagged reading, through the shell: the server finds the open
// flag on the aggregated record and stores the value the match reads now,
// provided it is still the value the client showed.

const misreadKey = "match-2026-06-07T23-00-04"

var misreadElims = parser.ScalarPath("eliminations")

// seedMisread stores the documented JPG over-read: 74 eliminations where the
// card's own rate over the minutes played says 9.
func seedMisread(fs *fakeStore) {
	fs.Summaries = append(fs.Summaries, db.SummaryRow{
		Filename: "ScreenShot_26-06-07_23-00-04-000.jpg", MatchKey: misreadKey,
		Hero: "lucio", Result: "victory", GameLength: "15:45",
		Eliminations: 74, Assists: 10, Deaths: 5,
		PerfElimAvgPer10Min: 12.97, PerfAssistsAvgPer10Min: 14.41, PerfDeathsAvgPer10Min: 7.21,
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100, PlayTime: "06:56"}},
	})
}

func elimsFlag(t *testing.T, a *app.App) match.FieldFlag {
	t.Helper()
	rec, err := a.GetMatchByKey(misreadKey)
	if err != nil {
		t.Fatalf("GetMatchByKey: %v", err)
	}
	for _, f := range rec.FieldFlags {
		if f.Field == misreadElims {
			return f
		}
	}
	t.Fatalf("no eliminations flag; field_flags = %+v", rec.FieldFlags)
	return match.FieldFlag{}
}

func TestConfirmFieldReading_ConfirmsTheValueOnScreenAndUnconfirmReopens(t *testing.T) {
	fs := &fakeStore{}
	seedMisread(fs)
	a := app.NewWithStore(fs)

	if err := a.ConfirmFieldReading(misreadKey, misreadElims, "74"); err != nil {
		t.Fatalf("ConfirmFieldReading: %v", err)
	}
	if got := elimsFlag(t, a); got.State != match.FlagConfirmed || got.Value != "74" {
		t.Errorf("after confirm: flag = %+v, want confirmed at 74", got)
	}

	if err := a.UnconfirmFieldReading(misreadKey, misreadElims); err != nil {
		t.Fatalf("UnconfirmFieldReading: %v", err)
	}
	if got := elimsFlag(t, a); got.State != match.FlagOpen {
		t.Errorf("after unconfirm: state = %q, want open", got.State)
	}
}

// A re-parse that reads another value leaves the confirmation stale, and the
// flag re-opens.
func TestConfirmFieldReading_ReparsedValueReopensTheFlag(t *testing.T) {
	fs := &fakeStore{}
	seedMisread(fs)
	a := app.NewWithStore(fs)
	if err := a.ConfirmFieldReading(misreadKey, misreadElims, "74"); err != nil {
		t.Fatalf("ConfirmFieldReading: %v", err)
	}

	fs.Summaries[0].Eliminations = 75

	if got := elimsFlag(t, a); got.State != match.FlagOpen || got.Value != "75" {
		t.Errorf("flag = %+v, want open at the new reading, 75", got)
	}
}

func TestConfirmFieldReading_Refusals(t *testing.T) {
	fs := &fakeStore{}
	seedMisread(fs)
	seedMatchKeys(fs, "match-2026-06-08T10-00-00")
	a := app.NewWithStore(fs)

	for name, tc := range map[string]struct {
		key   string
		field parser.FieldPath
		shown string
		want  error
	}{
		"unknown match":          {"match-2030-01-01T00-00-00", misreadElims, "74", match.ErrMatchNotFound},
		"a match without flags":  {"match-2026-06-08T10-00-00", misreadElims, "74", app.ErrNothingToConfirm},
		"a field without a flag": {misreadKey, parser.ScalarPath("deaths"), "74", app.ErrNothingToConfirm},
		"an empty match key":     {"", misreadElims, "74", app.ErrMatchKeyRequired},
		"a value since re-read":  {misreadKey, misreadElims, "47", app.ErrReadingChanged},
	} {
		t.Run(name, func(t *testing.T) {
			if err := a.ConfirmFieldReading(tc.key, tc.field, tc.shown); !errors.Is(err, tc.want) {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
		})
	}
	if confirmed, _ := fs.LoadFieldConfirmations(); len(confirmed) != 0 {
		t.Errorf("a refused confirmation stored %v", confirmed)
	}
}

func TestUnconfirmFieldReading_EmptyKeyIsRefused(t *testing.T) {
	a := app.NewWithStore(&fakeStore{})
	if err := a.UnconfirmFieldReading("", misreadElims); !errors.Is(err, app.ErrMatchKeyRequired) {
		t.Errorf("err = %v, want ErrMatchKeyRequired", err)
	}
}
