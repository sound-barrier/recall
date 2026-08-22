package matchedit

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"recall/pkg/db"
	"recall/pkg/match"
)

// The player's own timestamped moments — a self-review that can point at
// seconds the way a coach's can.
//
// Deliberately its own thing rather than a reuse of pkg/coach's: that package
// is about someone ELSE's review of your matches, and it never touches the
// player's own database (a property with tests behind it). Sharing the type
// would put a coach-session import in the player's annotation path for the
// sake of one struct.
//
// The RULES are the same, and stated once here so the two agree by
// construction where it matters: MM:SS, a clock is required, text is bounded.

// ErrInvalidMoment reports a moment write the rules refuse. Named like its
// siblings in this package so the HTTP layer maps it to a 400 the same way.
var ErrInvalidMoment = errors.New("invalid moment")

// ErrMomentEmpty is a moment write that parses fine and says nothing. 409
// rather than 400, the same distinction ErrEmptyAnnotation draws.
var ErrMomentEmpty = errors.New("a moment needs text")

// MaxMomentTextRunes bounds one moment. Same as the coach's, and for the same
// reason: a moment names a single thing, and the journal note beside it is
// where a longer read belongs.
const MaxMomentTextRunes = 600

// MaxMomentsPerMatch is a ceiling, not a target.
const MaxMomentsPerMatch = 50

// matchClockPattern is the in-match clock: minutes (one or two digits) and
// seconds. Two minute digits, never three — the longest match in the corpus
// is under 24 minutes.
var matchClockPattern = regexp.MustCompile(`^\d{1,2}:[0-5]\d$`)

// MomentInput is the body of a moment write — the moment minus its identity.
type MomentInput struct {
	MatchClock string `json:"match_clock"`
	Text       string `json:"text"`
	FocusTag   string `json:"focus_tag"`
}

// FocusTags is the vocabulary a moment may be filed under, mirroring the
// coach's. One list, so a player and their coach describe the same game in the
// same words — which is most of what makes a review legible.
var FocusTags = []string{
	"positioning", "ult_economy", "target_priority", "cooldowns",
	"hero_pick", "comms", "mechanics", "mental",
}

// ValidateMomentInput normalizes a write and enforces the rules, returning the
// copy to store. Every rejection wraps ErrInvalidMoment and names the field.
func ValidateMomentInput(in MomentInput) (MomentInput, error) {
	out := MomentInput{
		MatchClock: normalizeMatchClock(strings.TrimSpace(in.MatchClock)),
		Text:       strings.TrimSpace(in.Text),
		FocusTag:   strings.TrimSpace(in.FocusTag),
	}
	switch {
	case out.MatchClock == "":
		return MomentInput{}, fmt.Errorf("%w: a moment needs a match clock — MM:SS", ErrInvalidMoment)
	case !matchClockPattern.MatchString(out.MatchClock):
		return MomentInput{}, fmt.Errorf("%w: match clock %q is not MM:SS", ErrInvalidMoment, in.MatchClock)
	case out.Text == "":
		return MomentInput{}, fmt.Errorf("%w — say what happened", ErrMomentEmpty)
	case utf8.RuneCountInString(out.Text) > MaxMomentTextRunes:
		return MomentInput{}, fmt.Errorf("%w: moment text exceeds %d characters", ErrInvalidMoment, MaxMomentTextRunes)
	case out.FocusTag != "" && !slices.Contains(FocusTags, out.FocusTag):
		return MomentInput{}, fmt.Errorf("%w: focus tag %q is not in the vocabulary", ErrInvalidMoment, out.FocusTag)
	}
	return out, nil
}

// normalizeMatchClock zero-pads a single-digit minute so "4:45" and "04:45"
// are one value.
func normalizeMatchClock(clock string) string {
	m, s, ok := strings.Cut(clock, ":")
	if !ok || len(m) != 1 {
		return clock
	}
	return "0" + m + ":" + s
}

// MomentStore is the consumer-side seam the moment writes need — three
// methods, declared here rather than reaching for db.Store, so a caller can
// see exactly what a moment write touches.
type MomentStore interface {
	// The unknown-key guard's dependency (design rule 2). SetMoment CREATES a
	// row, and every sidecar table is keyed on match_key with no foreign key
	// behind it — so an unguarded write on a key this database has never seen
	// inserts an orphan nothing reads back, which then travels through every
	// export and profile move after it.
	MatchKeyExists(matchKey string) (bool, error)
	UpsertMatchMoment(m db.MatchMoment) (db.MatchMoment, error)
	DeleteMatchMoment(matchKey, momentID string) error
	LoadMatchMoments() (map[string][]db.MatchMoment, error)
}

// SetMoment validates and saves one of the player's moments, creating it when
// momentID is empty. An edit keeps the moment's place; a new one goes after
// every position already taken — never at len(existing), which collides with
// a survivor after any delete and leaves the tie to row order.
func SetMoment(s MomentStore, matchKey, momentID string, in MomentInput) (db.MatchMoment, error) {
	if matchKey == "" {
		return db.MatchMoment{}, ErrMatchKeyRequired
	}
	exists, err := s.MatchKeyExists(matchKey)
	if err != nil {
		return db.MatchMoment{}, err
	}
	if !exists {
		return db.MatchMoment{}, match.ErrMatchNotFound
	}
	normalized, err := ValidateMomentInput(in)
	if err != nil {
		return db.MatchMoment{}, err
	}
	byMatch, err := s.LoadMatchMoments()
	if err != nil {
		return db.MatchMoment{}, fmt.Errorf("load match moments: %w", err)
	}
	existing := byMatch[matchKey]
	if err := checkMomentRoom(existing, momentID); err != nil {
		return db.MatchMoment{}, err
	}
	return s.UpsertMatchMoment(db.MatchMoment{
		MomentID:   momentID,
		MatchKey:   matchKey,
		MatchClock: normalized.MatchClock,
		Text:       normalized.Text,
		FocusTag:   normalized.FocusTag,
		SortOrder:  SortOrderFor(existing, momentID),
	})
}

// MomentRow is a stored moment: which one it is, and where it sits in the
// reading order. Three tables carry that pair — a match's own moments, a
// coach's, and a self-review sitting's — and the rules for placing a moment
// among its siblings do not vary between them. db's three moment types
// satisfy this.
type MomentRow interface {
	MomentSlot() (id string, order int)
}

// SortOrderFor keeps an existing moment's place and puts a new one after every
// order already taken — NOT at len(existing), which collides with a survivor
// after any delete and leaves the tie to whatever order the rows come back in.
func SortOrderFor[T MomentRow](existing []T, momentID string) int {
	next := 0
	for _, m := range existing {
		id, order := m.MomentSlot()
		if id == momentID {
			return order
		}
		if order >= next {
			next = order + 1
		}
	}
	return next
}

// IsStoredMoment reports whether momentID names a moment already in existing,
// which is what lets an edit through a ceiling a new moment would hit.
//
// The empty id is never a match. A blank id means a NEW moment, and matching
// it against a row that also happens to hold "" would wave any new moment past
// a full note. One of the three copies of this rule was missing that guard and
// survived only because its caller refuses an empty id first.
func IsStoredMoment[T MomentRow](existing []T, momentID string) bool {
	if momentID == "" {
		return false
	}
	return slices.ContainsFunc(existing, func(m T) bool {
		id, _ := m.MomentSlot()
		return id == momentID
	})
}

// checkMomentRoom refuses a NEW moment past the ceiling; an edit to one
// already stored always fits.
func checkMomentRoom(existing []db.MatchMoment, momentID string) error {
	if IsStoredMoment(existing, momentID) {
		return nil
	}
	if len(existing) >= MaxMomentsPerMatch {
		return fmt.Errorf("%w: a match holds at most %d moments", ErrInvalidMoment, MaxMomentsPerMatch)
	}
	return nil
}
