package coach

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"recall/pkg/db"
)

// Note is one coach note as the session view, the notes file, and the
// return sheet carry it. Match is the descriptive snapshot the notes file
// attaches so an orphaned note still renders on the player's side; it is
// absent on the session view.
type Note struct {
	NoteID     string        `json:"note_id"`
	MatchKey   string        `json:"match_key"`
	Kind       string        `json:"kind"`
	Text       string        `json:"text"`
	FocusTags  []string      `json:"focus_tags"`
	ExtraTags  []string      `json:"extra_tags"`
	MatchClock string        `json:"match_clock"`
	UpdatedAt  string        `json:"updated_at"`
	Match      *MatchContext `json:"match,omitempty"`
	// Moments are the timestamped observations inside this note, in reading
	// order. omitempty so a note with none carries no key at all rather than
	// a null — Go marshals a nil slice as null, and the schema says array.
	Moments []Moment `json:"moments,omitempty"`
}

// MatchContext is the descriptive snapshot of the match a note is about,
// in the player's naive local clock — enough for the return sheet to
// render "Ilios · Ana · victory · Aug 1, 18:30" without the match.
type MatchContext struct {
	Map        string `json:"map"`
	Hero       string `json:"hero"`
	Result     string `json:"result"`
	Date       string `json:"date"`
	FinishedAt string `json:"finished_at"`
}

// NoteInput is the body of a note write — the note minus its identity.
type NoteInput struct {
	Kind       string   `json:"kind"`
	Text       string   `json:"text"`
	FocusTags  []string `json:"focus_tags"`
	ExtraTags  []string `json:"extra_tags"`
	MatchClock string   `json:"match_clock"`
}

const (
	maxNoteTextRunes = 4000
	maxExtraTags     = 20
	maxExtraTagRunes = 40
)

// matchClockPattern is the in-match clock a coach types: minutes (one or
// two digits) and seconds, "6:40" or "12:05".
var matchClockPattern = regexp.MustCompile(`^\d{1,2}:[0-5]\d$`)

// ValidateNoteInput normalizes a note write and enforces the note rules,
// returning the copy to store. Text and clock are trimmed; focus tags are
// deduplicated and sorted; extra tags are trimmed and deduplicated
// case-insensitively (first spelling kept, order preserved). Every
// rejection wraps ErrNoteInvalid and names the field.
func ValidateNoteInput(in NoteInput) (NoteInput, error) {
	if in.Kind != KindNote && in.Kind != KindReviewedOnly {
		return NoteInput{}, fmt.Errorf("%w: kind must be %q or %q", ErrNoteInvalid, KindNote, KindReviewedOnly)
	}
	out := NoteInput{
		Kind:       in.Kind,
		Text:       strings.TrimSpace(in.Text),
		FocusTags:  normalizeFocusTags(in.FocusTags),
		ExtraTags:  normalizeExtraTags(in.ExtraTags),
		MatchClock: strings.TrimSpace(in.MatchClock),
	}
	if err := validateNoteFields(out); err != nil {
		return NoteInput{}, err
	}
	return out, nil
}

// validateNoteFields enforces the rules on an already-normalized input.
func validateNoteFields(in NoteInput) error {
	if err := validateKindShape(in); err != nil {
		return err
	}
	if utf8.RuneCountInString(in.Text) > maxNoteTextRunes {
		return fmt.Errorf("%w: text exceeds %d characters", ErrNoteInvalid, maxNoteTextRunes)
	}
	for _, tag := range in.FocusTags {
		if !IsFocusTag(tag) {
			return fmt.Errorf("%w: focus tag %q is not in the vocabulary", ErrNoteInvalid, tag)
		}
	}
	if err := validateExtraTags(in.ExtraTags); err != nil {
		return err
	}
	if in.MatchClock != "" && !matchClockPattern.MatchString(in.MatchClock) {
		return fmt.Errorf("%w: match clock %q is not MM:SS", ErrNoteInvalid, in.MatchClock)
	}
	return nil
}

// validateKindShape is the kind rule: reviewed_only carries nothing, a
// note carries text or at least one tag.
func validateKindShape(in NoteInput) error {
	hasTags := len(in.FocusTags) > 0 || len(in.ExtraTags) > 0
	if in.Kind == KindReviewedOnly {
		if in.Text != "" || hasTags || in.MatchClock != "" {
			return fmt.Errorf("%w: a reviewed_only mark carries no text, tags, or clock", ErrNoteShape)
		}
		return nil
	}
	if in.Text == "" && !hasTags {
		return fmt.Errorf("%w: a note cannot be empty — add text or a tag", ErrNoteShape)
	}
	return nil
}

func validateExtraTags(tags []string) error {
	if len(tags) > maxExtraTags {
		return fmt.Errorf("%w: more than %d extra tags", ErrNoteInvalid, maxExtraTags)
	}
	for _, tag := range tags {
		if utf8.RuneCountInString(tag) > maxExtraTagRunes {
			return fmt.Errorf("%w: extra tag %q exceeds %d characters", ErrNoteInvalid, tag, maxExtraTagRunes)
		}
	}
	return nil
}

// normalizeFocusTags drops empties and duplicates and sorts — the order
// the store's child tables read back in.
func normalizeFocusTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		if tag != "" && !slices.Contains(out, tag) {
			out = append(out, tag)
		}
	}
	slices.Sort(out)
	return out
}

// normalizeExtraTags trims, drops empties, and deduplicates
// case-insensitively, keeping the first spelling in its position.
func normalizeExtraTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	for _, raw := range tags {
		tag := strings.TrimSpace(raw)
		if tag == "" {
			continue
		}
		dup := slices.ContainsFunc(out, func(have string) bool { return strings.EqualFold(have, tag) })
		if !dup {
			out = append(out, tag)
		}
	}
	return out
}

// nonNilTags guarantees a non-nil slice so the wire carries [] not null.
func nonNilTags(tags []string) []string {
	if tags == nil {
		return []string{}
	}
	return tags
}

// NoteFromCoachNote projects a stored coach-authored note onto the wire
// shape, attaching the match snapshot when one is given.
func NoteFromCoachNote(n db.CoachNote, ctx *MatchContext) Note {
	return Note{
		NoteID:     n.NoteID,
		MatchKey:   n.MatchKey,
		Kind:       n.Kind,
		Text:       n.Text,
		FocusTags:  nonNilTags(n.FocusTags),
		ExtraTags:  nonNilTags(n.ExtraTags),
		MatchClock: n.MatchClock,
		UpdatedAt:  n.UpdatedAt,
		Match:      ctx,
	}
}

// MatchCoachNoteFromNote builds the coach-received block the player's
// store accepts for a note, attributed to the coach and session it came
// from. The store stamps ID and AcceptedAt.
func MatchCoachNoteFromNote(n Note, coachName, sessionDate string) db.MatchCoachNote {
	return db.MatchCoachNote{
		NoteID:      n.NoteID,
		MatchKey:    n.MatchKey,
		CoachName:   coachName,
		SessionDate: sessionDate,
		Text:        n.Text,
		MatchClock:  n.MatchClock,
		FocusTags:   nonNilTags(n.FocusTags),
		ExtraTags:   nonNilTags(n.ExtraTags),
		Moments:     acceptedMoments(n.Moments),
	}
}

// acceptedMoments carries the note's moments onto the block the player keeps,
// numbering them by their position in the already-sorted list so the reading
// order the coach wrote survives a round trip through the player's database.
func acceptedMoments(moments []Moment) []db.MatchCoachNoteMoment {
	// nil, not an empty slice: omitempty drops the key entirely, so an
	// unmarked note carries no `"moments": []` onto every match payload, and
	// the equality checks the existing tests make keep working.
	if len(moments) == 0 {
		return nil
	}
	out := make([]db.MatchCoachNoteMoment, 0, len(moments))
	for i, m := range SortMoments(moments) {
		out = append(out, db.MatchCoachNoteMoment{
			MomentID:   m.MomentID,
			MatchClock: m.MatchClock,
			Text:       m.Text,
			FocusTag:   m.FocusTag,
			SortOrder:  i,
		})
	}
	return out
}

// CoachNoteFromInput builds the store row for a validated note write on
// one of the player's matches. NoteID is left empty so the store keeps
// the id minted on the first save.
func CoachNoteFromInput(playerRef int64, matchKey string, in NoteInput) db.CoachNote {
	return db.CoachNote{
		PlayerRef:  playerRef,
		MatchKey:   matchKey,
		Kind:       in.Kind,
		Text:       in.Text,
		MatchClock: in.MatchClock,
		FocusTags:  nonNilTags(in.FocusTags),
		ExtraTags:  nonNilTags(in.ExtraTags),
	}
}
