package coach

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"recall/pkg/match"
)

// The wire-schema identifiers notes.json carries.
//
// v2 adds timestamped moments inside a note. The writer picks the LOWEST
// schema that describes the file it is writing — a review with no moments is
// still v1 — so a coach on a new build can hand a file to a player on an old
// one and it keeps working, which is the common case and the one worth
// protecting.
//
// When there ARE moments the file says v2, and an older build refuses it by
// name ("this build expects v1") rather than decoding it and silently dropping
// them. That refusal is the point: Go's decoder ignores unknown fields, so a
// v1-labeled file carrying moments would import as a note whose specifics
// vanished, with nothing anywhere saying so. A player who is told to update
// has lost nothing; a player who is not has lost the half of the review that
// pointed at something.
const (
	NotesSchemaV1 = "recall-coach-notes/v1"
	NotesSchemaV2 = "recall-coach-notes/v2"
)

// notesSchemaFor is the lowest schema that describes this file.
func notesSchemaFor(notes []Note) string {
	for _, n := range notes {
		if len(n.Moments) > 0 {
			return NotesSchemaV2
		}
	}
	return NotesSchemaV1
}

// NotesFile is the machine copy of a coach's notes — notes.json inside the
// archive the coach hands the player. Player carries the identity the
// coach confirmed; every note carries its match snapshot so an orphan still
// renders on the return sheet.
type NotesFile struct {
	Schema        string `json:"schema"`
	ExportedAt    string `json:"exported_at"`
	RecallVersion string `json:"recall_version"`
	CoachName     string `json:"coach_name"`
	Player        Player `json:"player"`
	SessionDate   string `json:"session_date"`
	Summary       string `json:"summary"`
	Notes         []Note `json:"notes"`
}

const (
	maxNameRunes    = 64
	maxSummaryRunes = 20000
	maxNotesPerFile = 5000
)

// ValidateNotesFile checks a decoded notes file against the v1 rules —
// schema, header fields, note count, note identity uniqueness, tracked
// match keys, and the per-note rules — so a hostile or hand-edited file
// never reaches the store. A different schema is ErrNotesUnsupportedSchema;
// every other rejection wraps ErrNotesMalformed and names the field.
func ValidateNotesFile(f NotesFile) error {
	if err := validateNotesHeader(f); err != nil {
		return err
	}
	if len(f.Notes) > maxNotesPerFile {
		return fmt.Errorf("%w: more than %d notes", ErrNotesMalformed, maxNotesPerFile)
	}
	seenIDs := make(map[string]bool, len(f.Notes))
	seenKeys := make(map[string]bool, len(f.Notes))
	for i, n := range f.Notes {
		if err := validateFileNote(n); err != nil {
			return fmt.Errorf("notes[%d]: %w", i, err)
		}
		if seenIDs[n.NoteID] {
			return fmt.Errorf("%w: notes[%d]: duplicate note_id %q", ErrNotesMalformed, i, n.NoteID)
		}
		if seenKeys[n.MatchKey] {
			return fmt.Errorf("%w: notes[%d]: duplicate match_key %q", ErrNotesMalformed, i, n.MatchKey)
		}
		seenIDs[n.NoteID], seenKeys[n.MatchKey] = true, true
	}
	return nil
}

// validateNotesSchema checks the label and that it matches the contents.
func validateNotesSchema(f NotesFile) error {
	switch {
	case f.Schema == "":
		return fmt.Errorf("%w: missing schema", ErrNotesMalformed)
	case f.Schema != NotesSchemaV1 && f.Schema != NotesSchemaV2:
		return fmt.Errorf("%w: %q (this build reads %q and %q)",
			ErrNotesUnsupportedSchema, f.Schema, NotesSchemaV1, NotesSchemaV2)
	// A v1 file may not carry moments: the schema is what tells an older build
	// whether it can read the whole file, so a v1 label over v2 content is the
	// one shape that would make that promise false.
	case f.Schema == NotesSchemaV1 && notesSchemaFor(f.Notes) == NotesSchemaV2:
		return fmt.Errorf("%w: notes carry moments but the file says %q — moments need %q",
			ErrNotesMalformed, NotesSchemaV1, NotesSchemaV2)
	}
	return nil
}

func validateNotesHeader(f NotesFile) error {
	if err := validateNotesSchema(f); err != nil {
		return err
	}
	if err := validateName(f.CoachName, "coach_name"); err != nil {
		return err
	}
	if err := validateName(f.Player.Handle, "player.handle"); err != nil {
		return err
	}
	if f.Player.ID != "" && !IsUUID(f.Player.ID) {
		return fmt.Errorf("%w: player.id %q is not a UUID", ErrNotesMalformed, f.Player.ID)
	}
	if _, err := time.Parse(time.DateOnly, f.SessionDate); err != nil {
		return fmt.Errorf("%w: session_date %q is not YYYY-MM-DD", ErrNotesMalformed, f.SessionDate)
	}
	if utf8.RuneCountInString(f.Summary) > maxSummaryRunes {
		return fmt.Errorf("%w: summary exceeds %d characters", ErrNotesMalformed, maxSummaryRunes)
	}
	return nil
}

// validateName is the shared rule for the coach name and the player
// handle: non-blank, at most 64 runes.
func validateName(name, field string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("%w: %s is required", ErrNotesMalformed, field)
	}
	if utf8.RuneCountInString(name) > maxNameRunes {
		return fmt.Errorf("%w: %s exceeds %d characters", ErrNotesMalformed, field, maxNameRunes)
	}
	return nil
}

// validateFileNote holds one note in a file to the same rules a live note
// write passes, plus the identity rules a write gets from its URL and
// store: a UUID note_id and a tracked match key.
func validateFileNote(n Note) error {
	if !IsUUID(n.NoteID) {
		return fmt.Errorf("%w: note_id %q is not a UUID", ErrNotesMalformed, n.NoteID)
	}
	if !IsTrackedMatchKey(n.MatchKey) {
		return fmt.Errorf("%w: match_key %q is not a tracked match", ErrNotesMalformed, n.MatchKey)
	}
	in := NoteInput{Kind: n.Kind, Text: n.Text, FocusTags: n.FocusTags, ExtraTags: n.ExtraTags, MatchClock: n.MatchClock}
	if _, err := ValidateNoteInput(in); err != nil {
		return fmt.Errorf("%w: %w", ErrNotesMalformed, err)
	}
	return nil
}

// IsTrackedMatchKey reports whether key is a real match's key (match-…),
// never an ambiguous-/unmatched- sentinel — the only keys a note may
// target.
func IsTrackedMatchKey(key string) bool {
	k, err := match.ParseKey(key)
	return err == nil && k.IsTracked()
}
