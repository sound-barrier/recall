package db_test

import (
	"maps"
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// A confirmation is the user saying a flagged reading is right as read. It is
// bound to the value they looked at, so the store keeps that value beside the
// field: a later parse that reads something else re-opens the flag.

const confirmedKey = "match-2026-01-01T12-00-00"

var elimsPath = parser.ScalarPath("eliminations")

func confirmationsOf(t *testing.T, s db.Store, key string) db.ConfirmedReadings {
	t.Helper()
	all, err := s.LoadFieldConfirmations()
	mustNoErr(t, err)
	return all[key]
}

func TestStoreContract_FieldConfirmationRoundTripsItsValue(t *testing.T) {
	percent := parser.HeroPercentPath("soldier 76")
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.ConfirmFieldReading(confirmedKey, elimsPath, "74"))
			mustNoErr(t, s.ConfirmFieldReading(confirmedKey, percent, "60"))

			want := db.ConfirmedReadings{elimsPath: "74", percent: "60"}
			if got := confirmationsOf(t, s, confirmedKey); !maps.Equal(got, want) {
				t.Errorf("confirmations = %v, want %v", got, want)
			}
		})
	}
}

// Confirming again replaces the value: the latest one the user looked at is
// the one the confirmation holds.
func TestStoreContract_ReconfirmingReplacesTheValue(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.ConfirmFieldReading(confirmedKey, elimsPath, "74"))
			mustNoErr(t, s.ConfirmFieldReading(confirmedKey, elimsPath, "9"))

			if got := confirmationsOf(t, s, confirmedKey)[elimsPath]; got != "9" {
				t.Errorf("confirmed value = %q, want the latest, 9", got)
			}
		})
	}
}

func TestStoreContract_UnconfirmingIsIdempotent(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.ConfirmFieldReading(confirmedKey, elimsPath, "74"))
			mustNoErr(t, s.UnconfirmFieldReading(confirmedKey, elimsPath))
			mustNoErr(t, s.UnconfirmFieldReading(confirmedKey, elimsPath))

			all, err := s.LoadFieldConfirmations()
			mustNoErr(t, err)
			if len(all) != 0 {
				t.Errorf("a confirmation survived its removal: %v", all)
			}
		})
	}
}

// The field is a path in the data vocabulary; anything else names nothing a
// flag could be raised on, and the schema refuses it. The prefix is matched
// as spelled, in both stores: paths are lower case.
func TestStoreContract_FieldConfirmationRefusesANonDataPath(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			for _, field := range []parser.FieldPath{"", "eliminations", "DATA.eliminations", "Data.eliminations"} {
				if err := s.ConfirmFieldReading(confirmedKey, field, "74"); err == nil {
					t.Errorf("confirming %q stored a row", field)
				}
			}
		})
	}
}
