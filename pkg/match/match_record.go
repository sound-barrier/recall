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
	MatchKey       string            `json:"match_key"`
	SourceFiles    []string          `json:"source_files"`
	SourceTypes    map[string]string `json:"source_types,omitempty"`
	SourceParsedAt map[string]string `json:"source_parsed_at,omitempty"`
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

	// CoachNotes is the coach-received layer: every accepted coach note on
	// this match, oldest first. Empty for matches no coach has written about.
	CoachNotes []CoachNote `json:"coach_notes,omitempty"`
}

// Match provenance values for Record.Source.
const (
	SourceOCR       = "ocr"        // parsed from screenshots, unedited
	SourceOCREdited = "ocr_edited" // parsed, then user-corrected
	SourceManual    = "manual"     // hand-entered; no screenshot rows
)

// AmbiguousAttribution is one candidate match the user can pick to
// resolve the ambiguity. Mirrors db.AmbiguousCandidate but exposes the
// JSON wire shape so the domain layer owns the contract.
//
// RepresentativeSourceFile + RepresentativeDirID let the Unknown-tab
// picker render a small thumbnail beside each candidate.
//
// Reason says why the candidate was proposed: "duplicate_stats" when it
// came from the end-of-parse duplicate sweep (identical TEAMS stat
// line, hours-to-days apart), empty for the EAD-bridge / timestamp-
// window ambiguity. Derived from distance at aggregate time
// (correlate.CandidateReason), never stored.
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
	Leavers     []string `json:"leavers"`
	Throwers    []string `json:"throwers"`
	Note        string   `json:"note,omitempty"`
	ReplayCode  string   `json:"replay_code,omitempty"`
	Members     []string `json:"members,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	AnnotatedAt string   `json:"annotated_at,omitempty"`
}

// CoachNote is one accepted coach note on this match — the coach-received
// layer. It sits BESIDE the user's own Annotation, never inside it: the
// user's words and the coach's words stay separately attributed, and blocks
// accumulate (one per coach and session) rather than replace.
type CoachNote struct {
	ID          int64    `json:"id"`
	NoteID      string   `json:"note_id"`
	CoachName   string   `json:"coach_name"`
	SessionDate string   `json:"session_date"`
	Text        string   `json:"text"`
	MatchClock  string   `json:"match_clock,omitempty"`
	FocusTags   []string `json:"focus_tags"`
	ExtraTags   []string `json:"extra_tags,omitempty"`
	AcceptedAt  string   `json:"accepted_at"`
}

// ErrMatchNotFound is returned by GetMatchByKey when no match has the
// requested key. HTTP handlers route this to 404 via errors.Is.
var ErrMatchNotFound = errors.New("match not found")
