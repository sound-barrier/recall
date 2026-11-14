package db_test

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"recall/pkg/db"
)

// A session lives only in the process that claimed it. A sitting still open
// when the next process opens the store was left by one that died without
// ending it, and the start names it abandoned rather than leaving it to read
// as in progress forever.
func TestSQLStore_OpeningNamesALeftOpenSittingAbandoned(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recall.db")
	first, err := db.NewSQLStore(path)
	mustNoErr(t, err)
	p, err := first.EnsureCoachPlayer("pid-1", "Kestrel", db.CoachKindPlayer)
	mustNoErr(t, err)
	for _, id := range []string{"left-open", "quit"} {
		mustNoErr(t, first.StartCoachSession(db.CoachSessionRow{
			SessionID: id, PlayerRef: p.ID, Handle: "Kestrel", Kind: db.CoachKindPlayer, Source: "bundle",
		}))
	}
	mustNoErr(t, first.EndCoachSession("quit", db.SittingInterrupted, nil))
	mustNoErr(t, first.Close())

	second, err := db.NewSQLStore(path)
	mustNoErr(t, err)
	t.Cleanup(func() { _ = second.Close() })
	got, err := second.ListCoachSessions(p.ID)
	mustNoErr(t, err)
	statuses := map[string]db.SittingStatus{}
	for _, row := range got {
		statuses[row.SessionID] = row.Status
	}
	want := map[string]db.SittingStatus{"left-open": db.SittingAbandoned, "quit": db.SittingInterrupted}
	if statuses["left-open"] != want["left-open"] || statuses["quit"] != want["quit"] {
		t.Errorf("statuses = %v, want %v", statuses, want)
	}
}

// Abandoned is not an end a live process may claim, and neither is open.
func TestStoreContract_ASittingEndsOnlyAsEndedOrInterrupted(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.StartCoachSession(db.CoachSessionRow{SessionID: "s", Source: "bundle"}))
			for _, bad := range []db.SittingStatus{db.SittingOpen, db.SittingAbandoned, "gone"} {
				if err := s.EndCoachSession("s", bad, nil); !errors.Is(err, db.ErrSittingOutcomeInvalid) {
					t.Errorf("EndCoachSession(%q) = %v, want ErrSittingOutcomeInvalid", bad, err)
				}
			}
		})
	}
}

// The schema holds the vocabularies itself, so a writer that bypasses the
// Go checks still cannot store a status outside them.
func TestSQLStore_SittingAndFrozenFocusStatusesAreChecked(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recall.db")
	s, err := db.NewSQLStore(path)
	mustNoErr(t, err)
	mustNoErr(t, s.StartCoachSession(db.CoachSessionRow{SessionID: "s", Source: "bundle"}))
	mustNoErr(t, s.Close())
	raw, err := sql.Open("sqlite", path)
	mustNoErr(t, err)
	t.Cleanup(func() { _ = raw.Close() })
	for _, stmt := range []string{
		`UPDATE coach_sessions SET status = 'gone' WHERE session_id = 's'`,
		`INSERT INTO coach_session_focus_items (session_id, sort_order, text, status) VALUES ('s', 0, 'x', '')`,
		`INSERT INTO coach_focus_items (item_id, player_ref, text, status) VALUES ('i', 1, 'x', 'denied')`,
	} {
		if _, err := raw.Exec(stmt); err == nil {
			t.Errorf("%s was accepted, want the CHECK to refuse it", stmt)
		}
	}
}

// Every later write to a sitting's history names its row; a row that is not
// there is reported rather than updated into nothing.
func TestStoreContract_ASittingWriteToAMissingRowIsReported(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			for name, err := range map[string]error{
				"point": s.PointCoachSessionAt("ghost", 0, "Kestrel", db.CoachKindPlayer),
				"end":   s.EndCoachSession("ghost", db.SittingEnded, nil),
				"cover": s.CoverCoachSessionMatches("ghost", []string{"replay-ABC123"}),
			} {
				if !errors.Is(err, db.ErrCoachSessionUnknown) {
					t.Errorf("%s on a missing sitting = %v, want ErrCoachSessionUnknown", name, err)
				}
			}
		})
	}
}

// Cover records the whole reel, in order, each time: a code added later
// lands after the ones before it, and a repeat changes nothing.
func TestStoreContract_CoverRecordsTheWholeReelInOrder(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			p, err := s.EnsureCoachPlayer("pid-1", "Kestrel", db.CoachKindPlayer)
			mustNoErr(t, err)
			mustNoErr(t, s.StartCoachSession(db.CoachSessionRow{
				SessionID: "s", PlayerRef: p.ID, Source: db.CoachSessionFromReplay, MatchKeys: []string{"replay-AAA111"},
			}))
			mustNoErr(t, s.CoverCoachSessionMatches("s", []string{"replay-AAA111", "replay-BBB222"}))
			mustNoErr(t, s.CoverCoachSessionMatches("s", []string{"replay-AAA111", "replay-BBB222"}))

			got, err := s.ListCoachSessions(p.ID)
			mustNoErr(t, err)
			if len(got) != 1 || len(got[0].MatchKeys) != 2 || got[0].MatchKeys[1] != "replay-BBB222" {
				t.Errorf("sessions = %+v, want the two codes in reel order", got)
			}
		})
	}
}
