// Package coach is the pure domain of a coaching session: a coach opens a
// player's exported bundle in memory, writes structured notes against its
// matches, exports them as a small archive, and the player stages that
// archive and accepts each note into their own history. Nothing here
// touches a store directly — persistence goes through the consumer-side
// NoteStore / ReturnStore seams, and the loaned records never reach one.
package coach

import (
	"errors"
	"slices"

	"recall/pkg/db"
)

// Note kinds. A "note" carries text and/or tags; "reviewed_only" is the
// "I looked at this, nothing to add" mark and carries neither.
const (
	KindNote         = "note"
	KindReviewedOnly = "reviewed_only"
)

// FocusTags is the fixed focus vocabulary, in display order. It mirrors
// the CHECK constraint on the focus-tag tables and the frontend's chip
// row; a tag outside it is rejected by ValidateNoteInput.
var FocusTags = []string{
	"positioning", "ult_economy", "target_priority", "cooldowns",
	"hero_pick", "comms", "mechanics", "mental",
}

// IsFocusTag reports whether tag is in the fixed vocabulary (exact match).
func IsFocusTag(tag string) bool { return slices.Contains(FocusTags, tag) }

// Sentinels the app layer maps to HTTP statuses. Each is distinct so an
// errors.Is ladder can never conflate two outcomes.
var (
	// ErrNoSession — no coaching session is open (404).
	ErrNoSession = errors.New("coach: no session is open")
	// ErrSessionActive — a session is already open, or a write was
	// attempted while one is (409).
	ErrSessionActive = errors.New("coach: a coaching session is active")
	// ErrNotABundle — a coach notes archive was given where a player's
	// bundle was expected (409).
	ErrNotABundle = errors.New("coach: expected a player's bundle, got a coach notes archive")
	// ErrNoteInvalid — a note (or a decision naming one) failed validation;
	// the wrapped message names the field (400).
	ErrNoteInvalid = errors.New("coach: invalid note")
	// ErrMomentEmpty — a moment write whose body is spec-valid but says
	// nothing. Separate from ErrNoteInvalid because it maps to 409 rather
	// than 400: the request parsed fine and the refusal is semantic, the
	// same distinction ErrEmptyAnnotation already draws on the player side
	// (and the one schemathesis's positive_data_acceptance check enforces).
	ErrMomentEmpty = errors.New("coach: a moment needs text")
	// ErrNotesSchemaMismatch — the file is readable and its contents are
	// fine, but its label promises less than it carries: a v1 header over
	// notes with moments. 409 rather than 400 for the same reason the schema
	// mismatch beside it is: nothing about the payload is malformed.
	ErrNotesSchemaMismatch = errors.New("coach: notes file label does not match its contents")
	// ErrHandleInvalid — the player handle is blank or too long (400).
	ErrHandleInvalid = errors.New("coach: invalid player handle")
	// ErrHandleRequired — the session has no confirmed player handle yet
	// (409).
	ErrHandleRequired = errors.New("coach: the player's handle must be confirmed first")
	// ErrMatchNotInSession — the match key is not in the open session's
	// corpus (404).
	ErrMatchNotInSession = errors.New("coach: match is not in this session")
	// ErrNotesMalformed — the notes archive cannot be read as one (400).
	ErrNotesMalformed = errors.New("coach: malformed notes archive")
	// ErrNotesUnsupportedSchema — the notes file declares a schema this
	// build does not speak (409).
	ErrNotesUnsupportedSchema = errors.New("coach: unsupported notes schema")
	// ErrReturnOrphan — a decision targets a note whose match is not in the
	// player's history (409).
	ErrReturnOrphan = errors.New("coach: note is not about a match in your history")
	// ErrReturnNoMatches — the archive has nothing to show: no summary, and
	// no note about a match in this history (409). The wrapped message says
	// which of the two cases it is.
	ErrReturnNoMatches = errors.New("coach: nothing in this notes file applies to your history")
	// ErrCoachNameRequired — export needs the coach's name set (409).
	ErrCoachNameRequired = errors.New("coach: coach name is required")
	// ErrNothingToExport — no notes and no summary to export (409).
	ErrNothingToExport = errors.New("coach: nothing to export")
)

// NewID mints a random RFC 4122 version-4 UUID in the lowercase 8-4-4-4-12
// form — the identity of a note (stable across re-exports) and of a player.
// One implementation serves both packages: db mints the same shape when a
// note is first saved.
func NewID() string { return db.NewCoachNoteID() }

// IsUUID reports whether s is the canonical 8-4-4-4-12 hex form
// (case-insensitive). Shape only — version and variant bits are not
// checked, because ids from other builds are opaque keys here.
func IsUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !isHexRune(r) {
				return false
			}
		}
	}
	return true
}

func isHexRune(r rune) bool {
	return ('0' <= r && r <= '9') || ('a' <= r && r <= 'f') || ('A' <= r && r <= 'F')
}
