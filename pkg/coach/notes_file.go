package coach

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"recall/pkg/db"
	"recall/pkg/match"
)

// NotesSchemaV1 is the wire-schema identifier notes.json carries — the
// sibling of BundleSchemaV1, and the only schema there has ever been.
//
// It includes timestamped moments. An earlier draft of this feature wrote a
// v2 when a note carried moments and kept a v1 reader beside it, so a coach
// on a new build could hand a file to a player on an old one. There is no
// such player: coaching has never shipped in a release, so no v1 file exists
// anywhere to be compatible with. That machinery was a backwards-compat shim
// for undeployed code, which is the one kind this project does not write.
//
// The version stays in the string so a real v2 — after a release, for a
// player who could actually be holding v1 — has somewhere to go.
const NotesSchemaV1 = "recall-coach-notes/v1"

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
	// FocusItems is what the coach wants the player to work on, in order —
	// the set-level conclusion of the session, as separate items so the
	// player can acknowledge and retire each one. (It replaces a single
	// free-text `summary`, which nothing on either side could act on.)
	FocusItems []FocusItem `json:"focus_items"`
	Notes      []Note      `json:"notes"`
}

const (
	maxNameRunes    = 64
	maxItemRunes    = 2000
	maxFocusItems   = 50
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

// validateNotesSchema checks the file says it is what this build reads.
func validateNotesSchema(f NotesFile) error {
	switch {
	case f.Schema == "":
		return fmt.Errorf("%w: missing schema", ErrNotesMalformed)
	case f.Schema != NotesSchemaV1:
		return fmt.Errorf("%w: %q (this build reads %q)",
			ErrNotesUnsupportedSchema, f.Schema, NotesSchemaV1)
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
	if err := ValidateFocusItems(f.FocusItems); err != nil {
		return fmt.Errorf("%w: focus_items: %w", ErrNotesMalformed, err)
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
	return validateFileMoments(n.Moments)
}

// validateFileMoments holds the moments to the same rules a live write
// answers to.
//
// This is the file the threat model is about: a hostile or hand-edited
// notes.json is the reason this validator exists, and moments arrived here
// unchecked — a clock that is not a clock, a tag outside the vocabulary, a
// hundred-thousand-rune text, five hundred rows sharing one id, all of it
// landing verbatim in the player's database and then out again through
// GET /matches, in violation of the schema that endpoint publishes. The
// received table has no CHECK of its own precisely because it trusts this.
func validateFileMoments(moments []Moment) error {
	if len(moments) > MaxMomentsPerNote {
		return fmt.Errorf("%w: more than %d moments on one note", ErrNotesMalformed, MaxMomentsPerNote)
	}
	seen := make(map[string]bool, len(moments))
	for i, m := range moments {
		if m.MomentID == "" {
			return fmt.Errorf("%w: moments[%d]: missing moment_id", ErrNotesMalformed, i)
		}
		if seen[m.MomentID] {
			return fmt.Errorf("%w: moments[%d]: duplicate moment_id %q", ErrNotesMalformed, i, m.MomentID)
		}
		seen[m.MomentID] = true
		if _, err := ValidateMomentInput(MomentInput{
			MatchClock: m.MatchClock, Text: m.Text, FocusTag: m.FocusTag,
		}); err != nil {
			return fmt.Errorf("%w: moments[%d]: %w", ErrNotesMalformed, i, err)
		}
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

// FocusItem is one line of "what to work on" as it travels. ItemID is the
// coach's UUID, stable across re-exports — the player's side upserts on it,
// so opening the same file twice updates rather than duplicates, and never
// resets a status the player has already moved.
type FocusItem struct {
	ItemID string `json:"item_id"`
	Text   string `json:"text"`
}

// ValidateFocusItems holds a focus list to its rules. Delegates to the
// store's, which owns them — a list this build writes has to be one it
// will read back, and that only holds with one rule set.
func ValidateFocusItems(items []FocusItem) error {
	rows := make([]db.FocusItem, 0, len(items))
	for _, it := range items {
		rows = append(rows, db.FocusItem{ItemID: it.ItemID, Text: it.Text})
	}
	return db.ValidateFocusItems(rows)
}
