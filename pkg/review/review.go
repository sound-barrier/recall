// Package review is the player's saved self-review session over their OWN
// matches: create a sitting from a set of keys, write per-match notes and
// timestamped moments in it, keep a set-level summary, finish it.
//
// Its own leaf rather than a corner of pkg/matchedit (per-MATCH edits by
// charter) or pkg/coach (the OPPOSITE role — someone else's review of your
// games, which never touches your own database). What it shares with them
// it imports rather than re-states: the note shape and rules are the coach's
// (coach.NoteInput / ValidateNoteInput — the room's editor is one component,
// and a note the player can write must be one a coach could have), the
// moment rules are the player's own (matchedit.ValidateMomentInput), and the
// unknown-key guard is matchedit's.
//
// The persistence rules live in db.SelfReviewStore; what lives here is the
// orchestration above it — validation, the reviewed_only-on-moment rule, and
// the coach-outranks rule on Finish.
package review

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/matchedit"
)

var (
	// ErrNotFound reports a review id no sitting carries. 404.
	ErrNotFound = errors.New("review: self review not found")
	// ErrMatchNotInReview reports a note or moment aimed at a match the
	// review does not hold. 404 — the resource named in the URL is not there.
	ErrMatchNotInReview = errors.New("review: match is not in this self review")
	// ErrNoMatches reports a create or a set-matches with no keys left after
	// normalization. 409 — the body parses; a sitting over nothing is not a
	// sitting.
	ErrNoMatches = errors.New("review: a self review needs at least one match")
	// ErrTitleInvalid reports a title past its bound. 400.
	ErrTitleInvalid = errors.New("review: invalid title")
	// ErrTooManyMatches reports a set past the ceiling. 400 — the body is
	// well-formed and the schema says so (maxItems), like a too-long title.
	ErrTooManyMatches = errors.New("review: too many matches for one self review")
)

const (
	// MaxTitleRunes bounds the sitting's name — a label on a shelf card, not
	// a paragraph.
	MaxTitleRunes = 120
	// MaxMatchesPerReview is a ceiling, not a target: a sitting is a handful
	// of games looked at closely.
	MaxMatchesPerReview = 200
)

// Store is the consumer-side seam: the self-review slice of the store, the
// unknown-key guard's read, and the reviewed flag Finish stamps.
type Store interface {
	db.SelfReviewStore
	// LoadMatchKeys is the registry the create/set-matches guard consults —
	// one read for the whole batch, refused whole on the first unknown key.
	LoadMatchKeys() (map[string]bool, error)
	// The reviewed-by flag Finish writes and reads.
	LoadReviews() (map[string]db.ReviewState, error)
	SetReview(matchKey, reviewedBy string) error
}

// CreateInput is the body of a create: a name (optional) and the set.
type CreateInput struct {
	Title     string   `json:"title"`
	MatchKeys []string `json:"match_keys"`
}

// UpdateInput is the body of a rename. What the sitting concluded lives in
// its focus items, not here.
type UpdateInput struct {
	Title string `json:"title"`
}

// Create opens a sitting over the given keys, in the given order. Refuses an
// empty set and any key this database has never seen — the membership table
// carries no FK, so an unguarded write would seed a review over a phantom.
func Create(s Store, in CreateInput) (Session, error) {
	title, err := normalizeTitle(in.Title)
	if err != nil {
		return Session{}, err
	}
	keys, err := normalizeMatchKeys(s, in.MatchKeys)
	if err != nil {
		return Session{}, err
	}
	created, err := s.CreateSelfReview(db.SelfReview{Title: title, MatchKeys: keys})
	if err != nil {
		return Session{}, fmt.Errorf("review: create: %w", err)
	}
	return sessionFromRow(created), nil
}

// List returns every sitting, newest first.
func List(s Store) ([]Session, error) {
	out, err := s.LoadSelfReviews()
	if err != nil {
		return nil, fmt.Errorf("review: list: %w", err)
	}
	return sessionsFromRows(out), nil
}

// Get returns one sitting whole. ErrNotFound when absent.
func Get(s Store, reviewID string) (Session, error) {
	r, err := getRow(s, reviewID)
	if err != nil {
		return Session{}, err
	}
	return sessionFromRow(r), nil
}

func getRow(s Store, reviewID string) (db.SelfReview, error) {
	r, ok, err := s.LoadSelfReview(reviewID)
	if err != nil {
		return db.SelfReview{}, fmt.Errorf("review: get: %w", err)
	}
	if !ok {
		return db.SelfReview{}, fmt.Errorf("%w: %s", ErrNotFound, reviewID)
	}
	return r, nil
}

// Update renames the sitting.
func Update(s Store, reviewID string, in UpdateInput) (Session, error) {
	title, err := normalizeTitle(in.Title)
	if err != nil {
		return Session{}, err
	}
	if err := s.UpdateSelfReview(reviewID, title); err != nil {
		return Session{}, mapStoreErr(err)
	}
	return Get(s, reviewID)
}

// SetMatches replaces the sitting's set. A note on a match that leaves the
// set goes with it (the store's rule); an empty set is refused rather than
// leaving a sitting over nothing.
func SetMatches(s Store, reviewID string, matchKeys []string) (Session, error) {
	keys, err := normalizeMatchKeys(s, matchKeys)
	if err != nil {
		return Session{}, err
	}
	if err := s.SetSelfReviewMatches(reviewID, keys); err != nil {
		return Session{}, mapStoreErr(err)
	}
	return Get(s, reviewID)
}

// Delete removes the sitting and every note in it. The reviewed-by flags it
// stamped on Finish STAY — finishing was a fact about the match; the delete
// is a fact about the notes. Absent is a no-op.
func Delete(s Store, reviewID string) error {
	return s.DeleteSelfReview(reviewID)
}

// Finish stamps the sitting done and marks every member match reviewed by
// self — where a coach has not already: the coach mark outranks in both
// directions (an accept overwrites self with coach; a finish never
// overwrites coach with self). Idempotent.
func Finish(s Store, reviewID string) (Session, error) {
	r, err := getRow(s, reviewID)
	if err != nil {
		return Session{}, err
	}
	if err := s.FinishSelfReview(reviewID); err != nil {
		return Session{}, mapStoreErr(err)
	}
	flags, err := s.LoadReviews()
	if err != nil {
		return Session{}, fmt.Errorf("review: finish: load reviewed flags: %w", err)
	}
	// The unknown-key guard, applied here too: a member can stop existing
	// while its membership row remains (a manual match whose data was reset
	// removes its only parent row and no sidecar), and a reviewed flag on a
	// key the registry does not hold is an orphan nothing reads back.
	known, err := s.LoadMatchKeys()
	if err != nil {
		return Session{}, fmt.Errorf("review: finish: load match keys: %w", err)
	}
	for _, k := range r.MatchKeys {
		if !known[k] || flags[k].ReviewedBy == matchedit.ReviewedByCoach {
			continue
		}
		if err := s.SetReview(k, matchedit.ReviewedBySelf); err != nil {
			return Session{}, fmt.Errorf("review: finish: mark %s reviewed: %w", k, err)
		}
	}
	return Get(s, reviewID)
}

func normalizeTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if utf8.RuneCountInString(title) > MaxTitleRunes {
		return "", fmt.Errorf("%w: title exceeds %d characters", ErrTitleInvalid, MaxTitleRunes)
	}
	return title, nil
}

// normalizeMatchKeys dedupes (first spelling's position kept), refuses an
// empty set, the ceiling, and any key not in the registry.
func normalizeMatchKeys(s Store, in []string) ([]string, error) {
	keys := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, k := range in {
		k = strings.TrimSpace(k)
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		keys = append(keys, k)
	}
	if len(keys) == 0 {
		return nil, ErrNoMatches
	}
	if len(keys) > MaxMatchesPerReview {
		return nil, fmt.Errorf("%w: a self review holds at most %d matches", ErrTooManyMatches, MaxMatchesPerReview)
	}
	known, err := s.LoadMatchKeys()
	if err != nil {
		return nil, fmt.Errorf("review: load match keys: %w", err)
	}
	for _, k := range keys {
		if !known[k] {
			return nil, fmt.Errorf("%w: %s", match.ErrMatchNotFound, k)
		}
	}
	return keys, nil
}

// mapStoreErr turns the store's sentinels into this package's, so a caller
// (and the HTTP ladder) speaks one vocabulary. Both are kept in the chain —
// errors.Is answers to either — but this package's comes first, which is the
// one the ladder maps.
func mapStoreErr(err error) error {
	switch {
	case errors.Is(err, db.ErrSelfReviewUnknown):
		return fmt.Errorf("%w: %w", ErrNotFound, err)
	case errors.Is(err, db.ErrSelfReviewMatchUnknown):
		return fmt.Errorf("%w: %w", ErrMatchNotInReview, err)
	}
	return err
}
