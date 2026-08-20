package db_test

import (
	"strings"
	"testing"

	"recall/pkg/db"
)

// played_at_utc is the canonical instant every viewer-clock reader PREFERS —
// fmtTime, rowDateInstant, formatFinishedAt and season bucketing all reach
// for it before the naive date/finished_at beside it.
//
// So a write that corrects the wall clock and leaves the instant alone
// produces a card that shows the OLD time behind a ✎ marker, with no way for
// any client to correct it: played_at_utc is not a field of the override
// input at all. One write path updated the inputs; none updated the output.
func TestStoreContract_CorrectingTheWallClockMovesTheInstant(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			str := func(v string) *string { return &v }

			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
				MatchKey: "k", Date: str("2026-08-18"), FinishedAt: str("20:10"),
			}))

			all, err := s.LoadAllUserMatchData()
			mustNoErr(t, err)
			got := all["k"].PlayedAtUTC
			if got == nil {
				t.Fatal("no instant was derived from the wall clock that was written")
			}
			if !strings.HasSuffix(*got, "Z") {
				t.Errorf("played_at_utc = %q, want an RFC3339 UTC instant", *got)
			}

			// Correct the day; the instant has to follow.
			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
				MatchKey: "k", Date: str("2026-08-19"), FinishedAt: str("20:10"),
			}))
			all, err = s.LoadAllUserMatchData()
			mustNoErr(t, err)
			moved := all["k"].PlayedAtUTC
			if moved == nil || *moved == *got {
				t.Errorf("played_at_utc = %v, want it to follow the corrected date (was %q)", moved, *got)
			}
		})
	}
}

// A manual entry carries an EXACT instant computed from the wire offset —
// information the wall clock alone cannot reproduce, because the offset is
// not stored. A caller that supplies one is telling the truth about a moment,
// and the store must not overwrite it with its own guess.
func TestStoreContract_ASuppliedInstantIsNotSecondGuessed(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			str := func(v string) *string { return &v }
			const exact = "2026-08-19T02:10:00Z"

			mustNoErr(t, s.UpsertUserMatchData(db.UserMatchData{
				MatchKey: "k", Date: str("2026-08-18"), FinishedAt: str("20:10"),
				PlayedAtUTC: str(exact),
			}))
			all, err := s.LoadAllUserMatchData()
			mustNoErr(t, err)
			if got := all["k"].PlayedAtUTC; got == nil || *got != exact {
				t.Errorf("played_at_utc = %v, want the instant the caller supplied", got)
			}
		})
	}
}
