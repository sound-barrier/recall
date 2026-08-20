package db

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"slices"
)

// Coaching persistence — the seam behind pkg/coach. Two families that must
// never be confused, because one machine can be both a coach and a player
// (see the type docs in store_types.go): coach-AUTHORED rows are keyed by
// the player they describe and survive Clear(); coach-RECEIVED rows are
// keyed by local match_key and are treated as match history everywhere
// (HardDeleteMatch, Clear, profiles.Move).

// Sentinels for a reference that names a row that does not exist. Every
// coach method taking a foreign id reports it this way so the HTTP layer
// can map errors.Is(err, …) to a 404 without inspecting SQLite errors.
var (
	// ErrCoachPlayerUnknown reports a playerRef no coach_players row carries.
	ErrCoachPlayerUnknown = errors.New("coach player not found")
	// ErrCoachNoteUnknown reports a note_id this player has no note for —
	// a moment write naming a note that was deleted, or one from another
	// session's id space.
	ErrCoachNoteUnknown = errors.New("coach note not found")
	// ErrMomentMatchMismatch reports a moment_id that already exists on a
	// DIFFERENT match. The id is minted by the client, so it is not a
	// namespace the store may trust.
	ErrMomentMatchMismatch = errors.New("moment belongs to another match")
	// ErrCoachReturnUnknown reports a returnID no coach_returns row carries.
	ErrCoachReturnUnknown = errors.New("coach return not found")
	// ErrMatchCoachNoteUnknown reports a match_coach_notes id that does not
	// exist (already deleted, or never accepted).
	ErrMatchCoachNoteUnknown = errors.New("match coach note not found")
)

// CoachStore is the coaching slice of Store. Both families and the
// tracked-key registry live here so the coach package depends on ONE
// consumer-side seam (db.Store satisfies it; dbtest.Fake mirrors it).
type CoachStore interface {
	// EnsureCoachPlayer resolves the player a coaching session is about,
	// creating the row on first meeting. Identity is player_id when the
	// bundle carried one; otherwise the handle, matched case-insensitively.
	// A handle-only row later met with a player_id adopts it (backfill), so
	// a coach's earlier notes follow the player through an upgrade. A
	// second player_id sharing a handle is a different player.
	EnsureCoachPlayer(playerID, handle string) (CoachPlayer, error)
	// LoadCoachPlayers is the roster: every player this user has coached,
	// with note count, the newest note stamp, and the stored summary —
	// most recently touched first.
	LoadCoachPlayers() ([]CoachPlayerSummary, error)
	// RenameCoachPlayer changes the display handle only. ErrCoachPlayerUnknown
	// when id names no row.
	RenameCoachPlayer(id int64, handle string) error

	// UpsertCoachNote saves the one note per (player, match): a re-save
	// replaces kind / text / clock and both tag sets wholesale, refreshes
	// updated_at, and keeps the note_id minted on the first save (the
	// player's side dedupes on it). An empty NoteID is minted here. Returns
	// the stored row — including the NoteID and server timestamps.
	// ErrCoachPlayerUnknown when PlayerRef names no player.
	UpsertCoachNote(n CoachNote) (CoachNote, error)
	// DeleteCoachNote removes the (player, match) note; absent is a no-op.
	DeleteCoachNote(playerRef int64, matchKey string) error
	// LoadCoachNotes returns every note the coach wrote about one player,
	// keyed by match_key, tag lists sorted.
	LoadCoachNotes(playerRef int64) (map[string]CoachNote, error)
	// UpsertCoachNoteMoment saves one timestamped moment on a note, addressed
	// by the note's PUBLIC id — several moments share a match, so the match key
	// no longer identifies the write. A re-save replaces clock / text / tag and
	// keeps the moment_id minted on the first. Scoped to the player, so an id
	// from another session's space resolves to ErrCoachNoteUnknown rather than
	// reaching across.
	UpsertCoachNoteMoment(playerRef int64, m CoachNoteMoment) (CoachNoteMoment, error)
	// DeleteCoachNoteMoment removes one moment; absent is a no-op. Player-scoped
	// for the same reason the upsert is.
	DeleteCoachNoteMoment(playerRef int64, momentID string) error
	// LoadCoachNoteMoments returns every moment the coach wrote about one
	// player, keyed by the parent note's PUBLIC id.
	LoadCoachNoteMoments(playerRef int64) (map[string][]CoachNoteMoment, error)

	// UpsertMatchCoachNote accepts a received note onto a local match. Keyed
	// by note_id: a repeat import updates the block in place (children
	// replaced, accepted_at preserved) rather than adding a second one.
	// Returns the row id. Rejects an empty NoteID.
	UpsertMatchCoachNote(n MatchCoachNote) (int64, error)
	// DeleteMatchCoachNote removes one accepted block. ErrMatchCoachNoteUnknown
	// when id names no row.
	DeleteMatchCoachNote(id int64) error
	// LoadMatchCoachNotes returns every accepted block keyed by match_key,
	// each list ordered by accepted_at then id — the aggregator attaches it
	// to match.Record.CoachNotes at read time.
	LoadMatchCoachNotes() (map[string][]MatchCoachNote, error)

	// InsertCoachReturn stages an imported notes file. content_hash is
	// UNIQUE — look the hash up first; a duplicate insert errors.
	InsertCoachReturn(r CoachReturn) (int64, error)
	// LookupCoachReturnByHash returns (return, true) when the same file was
	// staged before, decisions attached.
	LookupCoachReturnByHash(hash string) (CoachReturn, bool, error)
	// LoadCoachReturns returns every staged return newest first, decisions
	// attached (Decisions is never nil).
	LoadCoachReturns() ([]CoachReturn, error)
	// LoadCoachReturn returns (return, true) for a known id, decisions
	// attached.
	LoadCoachReturn(id int64) (CoachReturn, bool, error)
	// SetCoachReturnDecision records the player's verdict on one staged
	// note ('accepted' | 'skipped'), overwriting a previous one.
	// ErrCoachReturnUnknown when returnID names no return.
	SetCoachReturnDecision(returnID int64, noteID, decision string) error
	// DeleteCoachReturn removes the staged return and its decisions.
	// ErrCoachReturnUnknown when id names no row.
	DeleteCoachReturn(id int64) error

	// LoadMatchKeys returns every DISTINCT match_key the profile tracks —
	// the five parent tables plus the user override layer. The coach side
	// validates notes against it; bundle import consults it for collisions.
	LoadMatchKeys() (map[string]bool, error)
}

// NewCoachNoteID mints a random RFC 4122 version-4 UUID — the note identity
// that stays stable across re-exports and that the player's side dedupes
// on. Exported so dbtest.Fake mints the same shape.
func NewCoachNoteID() string {
	var b [16]byte
	// crypto/rand.Read never returns an error (Go ≥ 1.24 aborts the process
	// instead), so the blank assign drops nothing real.
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// distinctSorted normalizes a tag list the way the child tables store it:
// empties dropped, duplicates collapsed, sorted (the loaders ORDER BY tag).
// nil when nothing remains so a tagless note reads back the same either way.
func distinctSorted(values []string) []string {
	var out []string
	for _, v := range values {
		if v != "" && !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	slices.Sort(out)
	return out
}

// replaceTagSetByID is the id-keyed sibling of replaceChildSet (which keys
// on match_key): rewrite one tag list of an integer-PK parent wholesale —
// delete then re-insert inside the caller's transaction — so a shrinking
// list actually shrinks. Duplicates are dropped here rather than by INSERT
// OR IGNORE, which would also swallow the vocabulary CHECK on the focus-tag
// tables. Every id-keyed child in the coaching schema is a `tag` column, so
// the value column is fixed.
func replaceTagSetByID(tx *sql.Tx, table, parentColumn string, parentID int64, tags []string) error {
	// #nosec G202 -- table/column names come from the constants in this
	// package, never from user input; SQL identifiers can't be bound.
	if _, err := tx.Exec("DELETE FROM "+table+" WHERE "+parentColumn+" = ?", parentID); err != nil {
		return fmt.Errorf("clear %s: %w", table, err)
	}
	for _, tag := range distinctSorted(tags) {
		// #nosec G202 -- same as above.
		stmt := "INSERT INTO " + table + " (" + parentColumn + ", tag) VALUES (?, ?)"
		if _, err := tx.Exec(stmt, parentID, tag); err != nil {
			return fmt.Errorf("insert %s: %w", table, err)
		}
	}
	return nil
}

// loadChildValuesByID runs a (parent_id, value) query and hands each pair to
// assign — the read-side twin of replaceTagSetByID shared by both tag
// families. Callers own the SQL so each can scope it (per player, or all).
func loadChildValuesByID(q querier, query string, args []any, assign func(parentID int64, value string)) error {
	rows, err := q.Query(query, args...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id int64
		var value string
		if err := rows.Scan(&id, &value); err != nil {
			return err
		}
		assign(id, value)
	}
	return rows.Err()
}

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
