package coach_test

import (
	"encoding/json"
	"testing"

	"recall/pkg/coach"
	"recall/pkg/db"
)

const (
	orphanKey    = "match-2030-01-01T00-00-00"
	orphanNoteID = "c1d2e3f4-0a1b-4c2d-9e3f-4a5b6c7d8e9f"
)

// returnedNotes is the file Ordo sends back: a note on Ilios, a
// reviewed-only mark on the rank match, and a note on a match the player
// no longer has.
func returnedNotes(t *testing.T) []byte {
	t.Helper()
	f := validNotesFile()
	f.Notes = append(f.Notes, coach.Note{
		NoteID: orphanNoteID, MatchKey: orphanKey, Kind: "note", Text: "gone", FocusTags: []string{"comms"}, ExtraTags: []string{},
		Match: &coach.MatchContext{Map: "busan", Hero: "ana", Result: "defeat", Date: "2030-01-01", FinishedAt: "00:00"},
	})
	payload, err := coach.WriteNotesArchive(f, fixedNow)
	if err != nil {
		t.Fatalf("WriteNotesArchive: %v", err)
	}
	return payload
}

// summaryOnlyNotes is the file a coach exports after a session they only
// summarized: the set-level verdict and not one per-match note.
func summaryOnlyNotes(t *testing.T) []byte {
	t.Helper()
	f := validNotesFile()
	f.Notes = nil
	return writeNotes(t, f)
}

// unmatchedNotes is a file whose every note is about a match the player does
// not have, with no summary to fall back on.
func unmatchedNotes(t *testing.T) []byte {
	t.Helper()
	f := validNotesFile()
	f.Summary = ""
	return writeNotes(t, f)
}

// emptyNotes carries neither notes nor a summary — nothing the player could
// be shown, which is the one file staging still refuses outright.
func emptyNotes(t *testing.T) []byte {
	t.Helper()
	f := validNotesFile()
	f.Notes, f.Summary = nil, ""
	return writeNotes(t, f)
}

func writeNotes(t *testing.T, f coach.NotesFile) []byte {
	t.Helper()
	payload, err := coach.WriteNotesArchive(f, fixedNow)
	if err != nil {
		t.Fatalf("WriteNotesArchive: %v", err)
	}
	return payload
}

func stageReturn(t *testing.T, st coach.ReturnStore, payload []byte, localHandle string) coach.ReturnSheet {
	t.Helper()
	sheet, already, err := coach.Stage(st, payload, localHandle)
	if err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if already {
		t.Fatal("Stage reported alreadyStaged on a first import")
	}
	return sheet
}

func statusesOf(sheet coach.ReturnSheet) map[string]string {
	out := map[string]string{}
	for _, item := range sheet.Notes {
		out[item.NoteID] = item.Status
	}
	return out
}

// decisionState is everything a decision changes on a sheet: each note's
// status, the decisions recorded so far, and the pending count. Comparing
// the whole shape at once keeps a decision test one assertion long.
type decisionState struct {
	Statuses  map[string]string
	Decisions map[string]string
	Pending   int
}

func stateOf(sheet coach.ReturnSheet) decisionState {
	return decisionState{Statuses: statusesOf(sheet), Decisions: sheet.Decisions, Pending: sheet.Pending}
}

// decide records decisions for the local player "Sable" — the handle every
// return test stages under — and fails the test if the store refuses them.
func decide(t *testing.T, st coach.ReturnStore, returnID int64, decisions ...coach.Decision) coach.ReturnSheet {
	t.Helper()
	sheet, err := coach.Decide(st, returnID, decisions, "Sable")
	if err != nil {
		t.Fatalf("Decide(%+v): %v", decisions, err)
	}
	return sheet
}

// blocksOn is the coach-received blocks stored on one match, in the order
// the store hands them back.
func blocksOn(t *testing.T, st coach.ReturnStore, matchKey string) []db.MatchCoachNote {
	t.Helper()
	blocks, err := st.LoadMatchCoachNotes()
	if err != nil {
		t.Fatalf("LoadMatchCoachNotes: %v", err)
	}
	return blocks[matchKey]
}

func noteIDsOf(blocks []db.MatchCoachNote) []string {
	ids := make([]string, 0, len(blocks))
	for _, b := range blocks {
		ids = append(ids, b.NoteID)
	}
	return ids
}

func coachNamesOf(blocks []db.MatchCoachNote) []string {
	names := make([]string, 0, len(blocks))
	for _, b := range blocks {
		names = append(names, b.CoachName)
	}
	return names
}

func blockWithNoteID(t *testing.T, st coach.ReturnStore, matchKey, noteID string) db.MatchCoachNote {
	t.Helper()
	for _, b := range blocksOn(t, st, matchKey) {
		if b.NoteID == noteID {
			return b
		}
	}
	t.Fatalf("no block with note_id %s on %s", noteID, matchKey)
	return db.MatchCoachNote{}
}

func asJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// wantStagedSheet is the sheet returnedNotes must stage: the header off the
// file, every note verbatim (a missing match snapshot normalized to an
// empty one), orphan for the match the player no longer has, pending for
// the rest, and no decisions yet. id and importedAt are the store's.
func wantStagedSheet(id int64, importedAt string) coach.ReturnSheet {
	return coach.ReturnSheet{
		ID: id, CoachName: "Ordo", PlayerHandle: "Sable", SessionDate: "2026-08-15",
		ImportedAt: importedAt, Summary: "Work on ult timing.",
		Notes: []coach.ReturnItem{
			{
				NoteID: noteIDOne, MatchKey: keyIlios, Kind: "note", Text: "hold high ground",
				FocusTags: []string{"positioning"}, ExtraTags: []string{}, MatchClock: "06:40", UpdatedAt: "2026-08-15T09:00:00Z",
				Match: &coach.MatchContext{Map: "ilios", Hero: "ana", Result: "victory", Date: "2026-08-01", FinishedAt: "18:30"}, Status: coach.StatusPending},
			{
				NoteID: noteIDTwo, MatchKey: keyRank, Kind: "reviewed_only",
				FocusTags: []string{}, ExtraTags: []string{}, UpdatedAt: "2026-08-15T09:01:00Z",
				Match: &coach.MatchContext{}, Status: coach.StatusPending},
			{
				NoteID: orphanNoteID, MatchKey: orphanKey, Kind: "note", Text: "gone",
				FocusTags: []string{"comms"}, ExtraTags: []string{},
				Match: &coach.MatchContext{Map: "busan", Hero: "ana", Result: "defeat", Date: "2030-01-01", FinishedAt: "00:00"}, Status: coach.StatusOrphan},
		},
		Decisions: map[string]string{},
		Pending:   2,
	}
}
