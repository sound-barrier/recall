package coachreturn_test

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"testing"
	"time"

	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// The corpus these tests reason about.
//
// Deliberately NOT a copy of pkg/coach's seededStore, which builds five
// realistic screenshot rows across summary/teams/personal/rank/unknown. That
// package tests the archive a coach WRITES, so it needs matches that look like
// matches. This package tests what happens when one comes BACK, and the only
// fact it asks about a player's history is whether a key is in it — a note
// about a key that is not becomes an orphan, and that is the whole rule.
//
// So this seeds keys, not matches. `dbtest.Fake.LoadMatchKeys` unions
// UserMatchData with the five row tables, so populating the first alone puts
// the four keys in the history without inventing screenshots nothing reads.
const (
	keyManual  = "match-2026-07-30T12-00-00"
	keyIlios   = "match-2026-08-01T18-30-00"
	keyRank    = "match-2026-08-02T20-05-00"
	keyUnknown = "match-2026-08-03T21-00-00"

	noteIDOne      = "11111111-1111-4111-8111-111111111111"
	noteIDTwo      = "22222222-2222-4222-8222-222222222222"
	focusIDOne     = "33333333-3333-4333-8333-333333333333"
	receivedNoteID = "44444444-4444-4444-8444-444444444444"

	seedPlayerID = "55555555-5555-4555-8555-555555555555"

	seedVersion = "0.30.1"
)

// The instant every fixture stamps, so an assertion on a timestamp is an
// assertion about the code rather than about when the suite ran.
var fixedNow = time.Date(2026, 8, 15, 9, 12, 0, 0, time.UTC)

func seededStore(t *testing.T) *dbtest.Fake {
	t.Helper()
	f := dbtest.New()
	f.UserMatchData = map[string]db.UserMatchData{
		keyManual:  {MatchKey: keyManual, UpdatedAt: "2026-08-03T00:00:00Z"},
		keyIlios:   {MatchKey: keyIlios, UpdatedAt: "2026-08-02T00:00:00Z"},
		keyRank:    {MatchKey: keyRank, UpdatedAt: "2026-08-02T00:00:00Z"},
		keyUnknown: {MatchKey: keyUnknown, UpdatedAt: "2026-08-03T00:00:00Z"},
	}
	f.Reviews = map[string]db.ReviewState{
		keyIlios: {ReviewedBy: "self", ReviewedAt: "2026-08-02T00:00:00Z"},
	}
	// One block from an earlier coach, so the "a second coach writes about the
	// same match" cases have something to land beside.
	f.MatchCoachNotes = []db.MatchCoachNote{{
		ID: 1, NoteID: receivedNoteID, MatchKey: keyIlios, CoachName: "Prior",
		SessionDate: "2026-07-20", Text: "earlier coach",
		FocusTags: []string{"comms"}, ExtraTags: []string{},
		AcceptedAt: "2026-07-21T00:00:00Z",
	}}
	return f
}

// validNotesFile is the archive a coach hands back: one written note about a
// match in the history, one reviewed-only note about another, and one focus
// item. Between them they cover every branch the staging path forks on.
func validNotesFile() coach.NotesFile {
	return coach.NotesFile{
		Schema:        coach.NotesSchemaV1,
		ExportedAt:    "2026-08-15T09:12:00Z",
		RecallVersion: seedVersion,
		CoachName:     "Ordo",
		Player:        coach.Player{ID: seedPlayerID, Handle: "Sable"},
		SessionDate:   "2026-08-15",
		FocusItems:    []coach.FocusItem{{ItemID: focusIDOne, Text: "Work on ult timing."}},
		Notes: []coach.Note{
			{
				NoteID: noteIDOne, MatchKey: keyIlios, Kind: "note",
				Text: "hold high ground", FocusTags: []string{"positioning"},
				ExtraTags: []string{}, MatchClock: "06:40",
				UpdatedAt: "2026-08-15T09:00:00Z",
				Match: &coach.MatchContext{
					Map: "ilios", Hero: "ana", Result: "victory",
					Date: "2026-08-01", FinishedAt: "18:30",
				},
			},
			{
				NoteID: noteIDTwo, MatchKey: keyRank, Kind: "reviewed_only",
				FocusTags: []string{}, ExtraTags: []string{},
				UpdatedAt: "2026-08-15T09:01:00Z",
			},
		},
	}
}

// zipWithEntries builds a zip carrying exactly the entries given. Enough to
// make something that IS a zip but is NOT a notes archive, which is the only
// thing the refusal cases need — building a real share bundle through
// bundle.Export would exercise a machine this package never talks to.
func zipWithEntries(t *testing.T, entries map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range entries {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: time.Unix(0, 0)})
		if err != nil {
			t.Fatalf("zip create %q: %v", name, err)
		}
		if _, err := w.Write(body); err != nil {
			t.Fatalf("zip write %q: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

// noMatchMaker is the seam refused: a test that hands this in is asserting
// that nothing was supposed to be created.
func noMatchMaker(coach.Note) (string, error) {
	return "", errors.New("no match should have been created")
}

// replayNotesFile is what a coach hands back after reviewing a replay code
// and nothing else: a note whose key was minted from the code, carrying the
// context that is the only thing identifying the match on the far side.
func replayNotesFile() coach.NotesFile {
	const code = "A1B2C3"
	f := validNotesFile()
	f.Notes = []coach.Note{{
		NoteID: noteIDOne, MatchKey: "replay-" + code, Kind: "note",
		Text: "held the choke too long", FocusTags: []string{"positioning"},
		ExtraTags: []string{}, MatchClock: "04:12",
		UpdatedAt: "2026-08-15T09:00:00Z",
		Match: &coach.MatchContext{
			Map: "ilios", Hero: "ana", Result: "defeat", ReplayCode: code,
		},
	}}
	return f
}

// notesArchive packs a notes file the way a coach's export does.
func notesArchive(t *testing.T, f coach.NotesFile) []byte {
	t.Helper()
	payload, err := coach.WriteNotesArchive(f, testSheet, fixedNow)
	if err != nil {
		t.Fatalf("WriteNotesArchive: %v", err)
	}
	return payload
}

// replayCodeForIndex mints distinct six-character codes for bulk fixtures.
func replayCodeForIndex(i int) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	out := make([]byte, 6)
	for pos := range out {
		out[pos] = alphabet[(i/pow36(pos))%len(alphabet)]
	}
	return string(out)
}

func pow36(n int) int {
	out := 1
	for range n {
		out *= 36
	}
	return out
}

// noteIDForIndex mints distinct UUIDs for bulk fixtures.
func noteIDForIndex(i int) string {
	return fmt.Sprintf("%08d-1111-4111-8111-111111111111", i)
}
