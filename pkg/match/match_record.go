package match

import (
	"errors"

	"recall/pkg/parser"
)

// Record is the per-match shape returned by GetMatchResults.
// It's assembled at read time by aggregation, which fuses every
// per-type screenshot row that shares a match_key. No `id` field —
// the previous single-table primary key is gone; match_key is identity.
type Record struct {
	MatchKey       string                           `json:"match_key"`
	SourceFiles    []string                         `json:"source_files"`
	SourceTypes    map[string]parser.ScreenshotType `json:"source_types,omitempty"`
	SourceParsedAt map[string]string                `json:"source_parsed_at,omitempty"`
	// SourceDirIDs maps a source filename to the screenshots_dirs row
	// id it was ingested from. The frontend builds
	// `/_screenshot/<id>/<filename>` URLs from this map so the
	// ScreenshotHandler can serve the right directory even after the
	// user changes their screenshots folder (re-install, move,
	// profile switch). Empty / missing means the dir was unset at
	// parse time; the client sends `0` to fall back to
	// `a.settings.ScreenshotsDir`.
	SourceDirIDs map[string]int64 `json:"source_dir_ids,omitempty"`
	// ThumbnailFile is the source filename whose image is actually present
	// on disk and best represents the match (SUMMARY, else TEAMS, else any
	// source file) — the one the leaf-row hover preview should show. Empty
	// when no source image exists on disk (a manual match, a data-only
	// import, or a screenshot that was deleted/moved), so the frontend
	// never requests a `/_screenshot/...` URL it knows will 404. Resolved
	// at read time against the live filesystem, never stored.
	ThumbnailFile string             `json:"thumbnail_file,omitempty"`
	ParsedAt      string             `json:"parsed_at,omitempty"`
	Data          parser.MatchResult `json:"data"`
	// Source is this record's provenance: SourceOCR (parsed from
	// screenshots only), SourceOCREdited (parsed, then user-corrected via
	// the override layer), or SourceManual (hand-entered; no screenshot
	// rows). Always set by the read path.
	Source string `json:"source"`
	// EditedFields lists the dotted paths the user overrode on an OCR
	// match (e.g. "data.damage",
	// "data.heroes_played.junkrat.stats.rip_tire_kill") so the UI can mark
	// each with a revert affordance. Empty for pure OCR and for manual
	// matches — the Manual badge already conveys their provenance.
	EditedFields []string `json:"edited_fields,omitempty"`
	// User-curated annotation. Currently only `leaver` is surfaced in
	// the UI ("self" | "team" | "enemy"); empty string means no
	// annotation. Note is reserved for future per-match commentary.
	Annotation *Annotation `json:"annotation,omitempty"`
	// True iff the user soft-deleted this match. Omitted from the JSON
	// when false (the common case). Hidden matches are filtered out of
	// GetMatchResults by default — the frontend opts back in via the
	// FilterRail "Hidden · N" toggle so the user can unhide.
	Hidden bool `json:"hidden,omitempty"`

	// True iff the user acknowledged this match's reference-data gap
	// warning (an OCR'd hero/map the shipped roster doesn't know). The
	// match itself is untouched — the Unknown tab just stops warning,
	// behind an "N acknowledged" disclosure. Omitted when false.
	ReferenceGapAcknowledged bool `json:"reference_gap_acknowledged,omitempty"`

	// Review status — "self" (user reviewed the VOD themselves),
	// "coach" (a coach reviewed it), or "" (not reviewed; field
	// omitted from JSON). Drives the 3-state toggle at the top of
	// the detail-panel sidebar.
	ReviewedBy string `json:"reviewed_by,omitempty"`
	// Server-stamped timestamp of when the review row was last
	// upserted. Drives the dossier's "days since last review"
	// widget. Omitted from JSON when the match is unreviewed.
	ReviewedAt string `json:"reviewed_at,omitempty"`

	// Queue type — "role" (5v5 role queue), "open" (6v6 open
	// queue), or "" (not set; field omitted from JSON). Drives the
	// 3-state radiogroup at the very top of the detail-panel
	// sidebar AND the queue chip in the "Narrow this set" filter.
	QueueType string `json:"queue_type,omitempty"`

	// Play mode — "quickplay" or "competitive". Set ONLY from the
	// match_play_mode user-override aux table; parser-written
	// data.mode and rank-row presence do not surface here. New
	// matches default to "Not set" until the user explicitly
	// toggles via the right-panel radiogroup. Drives the 3-state
	// radiogroup directly below the queue chooser AND the
	// play-mode chip in "Narrow this set."
	PlayMode string `json:"play_mode,omitempty"`

	// Ambiguous + Candidates are populated when match_key starts with
	// "ambiguous-" — the resolver found multiple plausible matches
	// for the screenshot and is asking the user to pick the right
	// one. The frontend surfaces these in the Unknown tab's "Needs
	// your review" subsection.
	// Pinned mirrors the pinned_matches sidecar — notable matches the
	// user starred; the list renders them in a leading section.
	Pinned bool `json:"pinned,omitempty"`

	Ambiguous  bool                   `json:"ambiguous,omitempty"`
	Candidates []AmbiguousAttribution `json:"candidates,omitempty"`

	// DuplicateOf names the matches this one was judged SEPARATE from,
	// after a sweep proposed them as the same match and the user said no.
	// Symmetric — both cards name each other — so the reader of either one
	// can see the judgment was already made, and jump to the other to check
	// it. Empty for the overwhelming majority nobody ever had to decide
	// about.
	DuplicateOf []string `json:"duplicate_of,omitempty"`

	// CoachNotes is the coach-received layer: every accepted coach note on
	// this match, oldest first. Empty for matches no coach has written about.
	CoachNotes []CoachNote `json:"coach_notes,omitempty"`
	// Moments are the PLAYER's own timestamped observations, in reading
	// order — a self-review that points at seconds. Distinct from the ones
	// inside a CoachNote, which are someone else's words.
	Moments []CoachNoteMoment `json:"moments,omitempty"`
	// SelfReviewNotes are the notes the player wrote about this match in
	// their own saved review sittings — one block per sitting, oldest
	// sitting first. A sibling array of CoachNotes rather than a `source`
	// discriminator on it: the two families are separate on disk and in the
	// bundle, and stay separate on the wire.
	SelfReviewNotes []SelfReviewNote `json:"self_review_notes,omitempty"`
}

// Match provenance values for Record.Source.
//
// SourceReplay is deliberately distinct from SourceManual even though both
// live entirely in the override layer with no screenshot rows. A manual match
// is one the PLAYER entered about a game they played; a replay match was
// created by a COACH's review from a replay code, and its result is what the
// coach typed while watching. It appears in the match list and carries the
// notes, but it is not counted into the player's own record — a coaching
// session must not move a win rate.
const (
	SourceOCR       = "ocr"        // parsed from screenshots, unedited
	SourceOCREdited = "ocr_edited" // parsed, then user-corrected
	SourceManual    = "manual"     // hand-entered; no screenshot rows
	SourceReplay    = "replay"     // created by a coach's review of a replay code
)

// AmbiguousAttribution is one candidate match the user can pick to
// resolve the ambiguity. Mirrors db.AmbiguousCandidate but exposes the
// JSON wire shape so the domain layer owns the contract.
//
// RepresentativeSourceFile + RepresentativeDirID let the Unknown-tab
// picker render a small thumbnail beside each candidate.
//
// Reason says why the candidate was proposed: "duplicate_stats" from the
// end-of-parse duplicate sweep (identical TEAMS stat line, hours-to-days
// apart), "same_instant" from the re-capture sweep (the same match played
// at the same minute, captured twice), empty for the EAD-bridge /
// timestamp-window ambiguity. Stamped by its producer and stored on the
// candidate row — the re-capture sweep overlaps the EAD bridge on the
// distance axis, so distance no longer identifies who proposed what.
type AmbiguousAttribution struct {
	MatchKey                 string `json:"match_key"`
	DistanceSeconds          int    `json:"distance_seconds"`
	Reason                   string `json:"reason,omitempty"`
	RepresentativeSourceFile string `json:"representative_source_file,omitempty"`
	RepresentativeDirID      int64  `json:"representative_dir_id,omitempty"`
}

// Annotation is the per-match user note returned alongside
// Record. Mirrors the db.Annotation shape but lives in the domain
// layer so the JSON contract doesn't leak SQL field names.
//
// Every user-settable field (leavers / throwers / note / replay_code /
// members / tags) is optional; the App-layer policy is "if every field is
// empty, delete the row". `members` and `tags` are omitted from the
// JSON when empty so the wire shape stays compact for the common case.
//
// `leavers` and `throwers` are SETS of "self" / "team" / "enemy" — a match can
// be disrupted on both teams at once. They are always present on the wire (no
// omitempty) so clients can read `.length` without a nil check.
type Annotation struct {
	Leavers    []string `json:"leavers"`
	Throwers   []string `json:"throwers"`
	Note       string   `json:"note,omitempty"`
	ReplayCode string   `json:"replay_code,omitempty"`
	Members    []string `json:"members,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	// Why this match should not count toward the win rate — "placement",
	// "mmr_adjustment" or "outage". Absent for the matches that count,
	// which is nearly all of them.
	ExclusionReason string `json:"exclusion_reason,omitempty"`
	AnnotatedAt     string `json:"annotated_at,omitempty"`
}

// CoachNote is one accepted coach note on this match — the coach-received
// layer. It sits BESIDE the user's own Annotation, never inside it: the
// user's words and the coach's words stay separately attributed, and blocks
// accumulate (one per coach and session) rather than replace.
type CoachNote struct {
	ID          int64  `json:"id"`
	NoteID      string `json:"note_id"`
	CoachName   string `json:"coach_name"`
	SessionDate string `json:"session_date"`
	// ForTeam names the team the review was written for, when it was
	// addressed to one. Absent on an ordinary per-player note — a team
	// review that reads as a personal note has lost what made it one.
	ForTeam    string   `json:"for_team,omitempty"`
	Text       string   `json:"text"`
	MatchClock string   `json:"match_clock,omitempty"`
	FocusTags  []string `json:"focus_tags"`
	ExtraTags  []string `json:"extra_tags,omitempty"`
	// Moments are the coach's timestamped observations, in reading order.
	// omitempty so an unmarked note carries no empty array into every match
	// payload.
	Moments    []CoachNoteMoment `json:"moments,omitempty"`
	AcceptedAt string            `json:"accepted_at"`
}

// SelfReviewNote is one block a match carries from one of the player's own
// review sittings: what they wrote there, and which sitting it was — the
// review's id (the delete address), title, when it was opened, and whether
// it is finished (an unfinished sitting's block reads "in progress").
type SelfReviewNote struct {
	ReviewID         string `json:"review_id"`
	ReviewTitle      string `json:"review_title,omitempty"`
	ReviewCreatedAt  string `json:"review_created_at"`
	ReviewFinishedAt string `json:"review_finished_at,omitempty"`
	Kind             string `json:"kind"`
	Text             string `json:"text"`
	MatchClock       string `json:"match_clock,omitempty"`
	// Tag slices are carried as the store hands them over — absent when the
	// note carried none, like the coach block's.
	FocusTags []string `json:"focus_tags,omitempty"`
	ExtraTags []string `json:"extra_tags,omitempty"`
	// Moments are the player's timestamped observations in this sitting, in
	// reading order. omitempty like the coach block's.
	Moments   []CoachNoteMoment `json:"moments,omitempty"`
	UpdatedAt string            `json:"updated_at"`
}

// CoachNoteMoment is one timestamped observation on a received note.
type CoachNoteMoment struct {
	MomentID   string `json:"moment_id"`
	MatchClock string `json:"match_clock"`
	Text       string `json:"text"`
	FocusTag   string `json:"focus_tag,omitempty"`
	// ImageSHA256 names the frame this moment is about, served from
	// /_moment-image/{sha256}. Omitted when there is no picture.
	ImageSHA256 string `json:"image_sha256,omitempty"`
}

// ErrMatchNotFound is returned by GetMatchByKey when no match has the
// requested key. HTTP handlers route this to 404 via errors.Is.
var ErrMatchNotFound = errors.New("match not found")
