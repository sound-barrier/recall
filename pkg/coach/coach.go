// Package coach is the pure domain of a coaching session: a coach opens a
// player's exported bundle in memory, writes structured notes against its
// matches, exports them as a small archive, and the player stages that
// archive and accepts each note into their own history. Nothing here
// touches a store directly — persistence goes through the consumer-side
// NoteStore / ReturnStore seams, and the loaned records never reach one.
package coach

import (
	"errors"
	"fmt"
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
	// ErrFocusItemInvalid reports a focus list that breaks its own rules —
	// a non-UUID or repeated item_id, blank or over-long text, too many
	// rows. An ALIAS of the store's, because the rule set moved there when
	// pkg/bundle needed it too: two sentinels for one rule would mean the
	// HTTP ladder answering 400 for one caller and 500 for another.
	ErrFocusItemInvalid = db.ErrFocusItemInvalid
	// ErrMomentEmpty — a moment write whose body is spec-valid but says
	// nothing. Separate from ErrNoteInvalid because it maps to 409 rather
	// than 400: the request parsed fine and the refusal is semantic, the
	// same distinction ErrEmptyAnnotation already draws on the player side
	// (and the one schemathesis's positive_data_acceptance check enforces).
	ErrMomentEmpty = errors.New("coach: a moment needs text")
	// ErrNoteShape — the kind and the content disagree: a `note` with
	// neither text nor a tag, or a `reviewed_only` mark carrying text, tags
	// or a clock. Spec-valid and semantically refused, the same case as
	// ErrMomentEmpty, so the same 409. It wraps ErrNoteInvalid, so a caller
	// asking "did the note fail validation" still hears yes; the HTTP ladder
	// maps it FIRST.
	ErrNoteShape = fmt.Errorf("%w: kind and content disagree", ErrNoteInvalid)
	// ErrHandleInvalid — the player handle is blank or too long (400).
	ErrHandleInvalid = errors.New("coach: invalid player handle")
	// ErrHandleRequired — the session has no confirmed player handle yet
	// (409).
	ErrHandleRequired = errors.New("coach: the player's handle must be confirmed first")
	// ErrBundleNamesPlayer — a team identity was offered to a bundle session
	// (409). The manifest IS the identity; a team review starts from codes.
	ErrBundleNamesPlayer = errors.New("coach: a bundle names its player — a team review starts from replay codes")
	// Import attributes purely by handle, so a team's shared review would
	// land as a per-player return on anyone whose handle matches the team
	// name. A team review travels as the page.
	// ErrMatchNotInSession — the match key is not in the open session's
	// corpus (404).
	ErrMatchNotInSession = errors.New("coach: match is not in this session")
	// ErrNotesMalformed — the notes archive cannot be read as one (400).
	ErrNotesMalformed = errors.New("coach: malformed notes archive")
	// ErrNotesUnsupportedSchema — the notes file declares a schema this
	// build does not speak (409).
	ErrNotesUnsupportedSchema = errors.New("coach: unsupported notes schema")
	// ErrCoachNameRequired — export needs the coach's name set (409).
	ErrCoachNameRequired = errors.New("coach: coach name is required")
	// ErrNothingToExport — no notes and no focus items to export (409).
	ErrNothingToExport = errors.New("coach: nothing to export")
)

// NewID mints a random RFC 4122 version-4 UUID in the lowercase 8-4-4-4-12
// form — the identity of a note (stable across re-exports) and of a player.
// One implementation serves both packages: db mints the same shape when a
// note is first saved.
func NewID() string { return db.NewCoachNoteID() }

// IsUUID reports whether s is the canonical 8-4-4-4-12 hex form. Delegates
// to the store's, which is where the minter lives — one shape check for one
// identity rule.
func IsUUID(s string) bool { return db.IsUUID(s) }
