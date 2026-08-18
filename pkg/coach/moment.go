package coach

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"recall/pkg/db"
)

// A moment is one timestamped observation inside a note: "3:23 — you didn't
// take the off-angle, so the tank ate the pressure alone".
//
// The note is still the per-match record — the overall read, the tags, the
// reviewed mark — and moments hang off it. That split is the point: a review
// says several things at several times, and before this a coach had one clock
// field and had to choose which of them to stamp.

// MaxMomentTextRunes bounds one moment. A moment names a single thing that
// happened; the note's own 4000 runes are where a longer read belongs, and a
// paragraph here would defeat a strip meant to be scanned down the match.
const MaxMomentTextRunes = 600

// MaxMomentsPerNote is a ceiling, not a target. Well past any real review of
// one match, and low enough that a malformed import cannot make a note
// unrenderable.
const MaxMomentsPerNote = 50

// Moment is one timestamped observation as the session view, the notes file
// and the return sheet all carry it.
type Moment struct {
	MomentID   string `json:"moment_id"`
	MatchClock string `json:"match_clock"`
	Text       string `json:"text"`
	FocusTag   string `json:"focus_tag,omitempty"`
	// SortOrder is the authored order, kept only to break ties between two
	// moments stamped at the same second — there is no other signal for which
	// the coach meant first.
	SortOrder int    `json:"-"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

// MomentInput is the body of a moment write — the moment minus its identity.
type MomentInput struct {
	MatchClock string `json:"match_clock"`
	Text       string `json:"text"`
	FocusTag   string `json:"focus_tag"`
}

// ValidateMomentInput normalizes a moment write and enforces its rules,
// returning the copy to store. Every rejection wraps ErrNoteInvalid and names
// the field.
//
// Unlike the note's optional clock, a moment's is REQUIRED: a moment without a
// time is just a sentence, and the note it hangs on is already the place for
// those. The focus tag stays optional — a coach saying what happened at 4:45
// should not have to classify it first.
func ValidateMomentInput(in MomentInput) (MomentInput, error) {
	out := MomentInput{
		MatchClock: normalizeMatchClock(strings.TrimSpace(in.MatchClock)),
		Text:       strings.TrimSpace(in.Text),
		FocusTag:   strings.TrimSpace(in.FocusTag),
	}
	if out.MatchClock == "" {
		return MomentInput{}, fmt.Errorf("%w: a moment needs a match clock — MM:SS", ErrNoteInvalid)
	}
	if !matchClockPattern.MatchString(out.MatchClock) {
		return MomentInput{}, fmt.Errorf("%w: match clock %q is not MM:SS", ErrNoteInvalid, in.MatchClock)
	}
	if out.Text == "" {
		return MomentInput{}, fmt.Errorf("%w — say what happened", ErrMomentEmpty)
	}
	if utf8.RuneCountInString(out.Text) > MaxMomentTextRunes {
		return MomentInput{}, fmt.Errorf("%w: moment text exceeds %d characters", ErrNoteInvalid, MaxMomentTextRunes)
	}
	if out.FocusTag != "" && !IsFocusTag(out.FocusTag) {
		return MomentInput{}, fmt.Errorf("%w: focus tag %q is not in the vocabulary", ErrNoteInvalid, out.FocusTag)
	}
	return out, nil
}

// normalizeMatchClock zero-pads a single-digit minute so "4:45" and "04:45"
// are one value. Stored padded because the strip aligns the column, and
// because clockSeconds is not the only reader — a string compare on a padded
// clock is at least stable.
func normalizeMatchClock(clock string) string {
	m, s, ok := strings.Cut(clock, ":")
	if !ok || len(m) != 1 {
		return clock
	}
	return "0" + m + ":" + s
}

// SortMoments returns the moments in the order the strip reads them: down the
// match, ties broken by the order they were written.
//
// By SECONDS, not by string — "10:00" sorts before "9:00" lexically, and a
// review that reads out of order is worse than one that reads in a pile.
func SortMoments(moments []Moment) []Moment {
	out := slices.Clone(moments)
	slices.SortStableFunc(out, func(a, b Moment) int {
		if d := clockSeconds(a.MatchClock) - clockSeconds(b.MatchClock); d != 0 {
			return d
		}
		return a.SortOrder - b.SortOrder
	})
	return out
}

// clockSeconds reads MM:SS into seconds. An unreadable clock sorts first
// rather than last — a moment the app cannot place belongs where the reader
// will notice it, not buried at the bottom of the strip.
func clockSeconds(clock string) int {
	m, s, ok := strings.Cut(clock, ":")
	if !ok {
		return -1
	}
	minutes, err := strconv.Atoi(m)
	if err != nil {
		return -1
	}
	seconds, err := strconv.Atoi(s)
	if err != nil {
		return -1
	}
	return minutes*60 + seconds
}

// MomentFromRow lifts a stored row into the wire shape.
func MomentFromRow(m db.CoachNoteMoment) Moment {
	return Moment{
		MomentID:   m.MomentID,
		MatchClock: m.MatchClock,
		Text:       m.Text,
		FocusTag:   m.FocusTag,
		SortOrder:  m.SortOrder,
		UpdatedAt:  m.UpdatedAt,
	}
}

// MomentRowFromInput builds the row to store for a validated input.
func MomentRowFromInput(noteID, momentID string, sortOrder int, in MomentInput) db.CoachNoteMoment {
	return db.CoachNoteMoment{
		MomentID:   momentID,
		NoteID:     noteID,
		MatchClock: in.MatchClock,
		Text:       in.Text,
		FocusTag:   in.FocusTag,
		SortOrder:  sortOrder,
	}
}
