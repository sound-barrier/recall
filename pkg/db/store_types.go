package db

// Domain types — the row/state structs the Store reads and writes. Split
// out of store.go, which keeps the Store interface + the SQLStore impl.

// ReviewState is one row of match_reviews. `ReviewedBy` is the
// CHECK-constrained enum ('self' | 'coach'); `ReviewedAt` is the
// server-assigned timestamp the dossier uses to compute "days since
// last review."
type ReviewState struct {
	ReviewedBy string
	ReviewedAt string
}

// QueueState is one row of match_queue. `QueueType` is the
// CHECK-constrained enum ('role' | 'open'); `OverriddenAt` is the
// server-assigned timestamp captured when the user toggled the value
// (or when a future parser update wrote it from a teams parse).
type QueueState struct {
	QueueType    string
	OverriddenAt string
}

// IgnoredRow is one row of ignored_screenshots — a filename the user
// chose to "Delete forever" on the Unknown tab. `IgnoredAt` is the
// server-assigned timestamp the Settings panel renders so users can
// distinguish recent ignores from old ones.
// IngestedFile is one content-hash registry row (see ingested_files in
// schema.sql). DuplicateOf is ” for originals.
type IngestedFile struct {
	ContentHash string
	DuplicateOf string
}

type IgnoredRow struct {
	Filename  string
	IgnoredAt string
}

// FailedFileRow is one OCR-failure ledger row (see failed_files in
// schema.sql). Error holds the most recent attempt's message; Attempts
// counts every failed run since FirstFailedAt. ScreenshotsDirID resolves
// the on-disk directory for the diagnostic bundle.
type FailedFileRow struct {
	Filename         string
	ScreenshotsDirID int64
	Error            string
	Attempts         int
	FirstFailedAt    string
	LastFailedAt     string
}

// PlayModeState is one row of match_play_mode. `PlayMode` is the
// CHECK-constrained enum ('quickplay' | 'competitive'); `OverriddenAt`
// is the server-assigned timestamp captured when the user toggled the
// value. Acts as an OVERRIDE — the aggregator prefers this when set,
// otherwise falls back to summary_screenshots.mode + rank-row
// presence.
type PlayModeState struct {
	PlayMode     string
	OverriddenAt string
}

// Annotation is one row of match_annotations plus its joined-on child
// lists. Every field is optional; the App-layer policy is "if every field is
// empty, delete the row entirely" (see App.SetMatchAnnotation).
//
// Leavers and Throwers are SETS of {"self", "team", "enemy"} — a match can
// carry a disruption on both teams at once, and "a teammate left, then I left"
// needs two leaver sides on one match. The SQL CHECK constraint on each side
// table enforces the vocabulary at the boundary too.
type Annotation struct {
	MatchKey   string
	Leavers    []string
	Throwers   []string
	Note       string
	ReplayCode string
	Members    []string
	// Free-form user tags applied to the match. `stack`, `stream`,
	// `placement` are the conventional three (surfaced as quick-add
	// toggles in the inline editor); the user can add anything.
	// Normalized to lowercase + trimmed at the app layer before
	// reaching SQL, so `Stack` and `stack` collapse to one row.
	Tags        []string
	AnnotatedAt string
}

// SummaryRow holds one parsed SUMMARY screenshot. Match identity is
// MatchKey (resolved at insert time by the correlation pass); per-file
// uniqueness is Filename (UNIQUE constraint).
type SummaryRow struct {
	ID       int64
	Filename string
	MatchKey string
	ParsedAt string
	// ScreenshotsDirID points at the screenshots_dirs row recording
	// which folder this screenshot was ingested from. The column is
	// NOT NULL: a zero here means "dir unset" and the write path maps
	// it to the id=1 sentinel row via dirIDOrSentinel before insert.
	ScreenshotsDirID int64
	// ParserGeneration is parser.Generation as of the parse that wrote this row.
	// 0 means unstamped, which is stale by definition. Set by pkg/app, which owns
	// both sides — the store deliberately does not import the parser.
	ParserGeneration int
	Map              string
	// MapRaw / HeroRaw — raw OCR text preserved when the matcher
	// rejected the candidate as unknown. Empty when the canonical
	// column resolved cleanly. See pkg/parser/types.go MatchResult
	// for the full rationale.
	MapRaw     string
	Playlist   string
	Hero       string
	HeroRaw    string
	Result     string
	FinalScore string
	Date       string
	FinishedAt string
	GameLength string
	// PlayedAtUTC is the canonical UTC instant (RFC3339), derived at parse
	// time from Date+FinishedAt via the machine's timezone identity. nil =
	// SQL NULL (date/finished_at absent or unparseable). The naive Date/
	// FinishedAt above stay naive-local for the correlator; this is additive.
	PlayedAtUTC *string

	// Eliminations / Assists / Deaths are the player's own, off the SUMMARY
	// performance panel — the same fact TeamsRow carries under the same
	// names. The read-time fold reconciles the two observations.
	Eliminations int
	Assists      int
	Deaths       int

	PerfElimAvgPer10Min    float64
	PerfAssistsAvgPer10Min float64
	PerfDeathsAvgPer10Min  float64

	HeroesPlayed []SummaryHeroPlayed
}

// SummaryHeroPlayed is one row of summary_heroes_played.
type SummaryHeroPlayed struct {
	Hero          string
	PercentPlayed int
	PlayTime      string
}

// TeamsRow holds one parsed TEAMS screenshot.
// TeamsRow is the in-game teams scoreboard's contribution: combat stats
// only. Match identity (map, playlist, hero, role) is NOT stored here —
// it comes from the SUMMARY / RANK / PERSONAL screenshots and is merged
// in by correlation.
type TeamsRow struct {
	ID               int64
	Filename         string
	MatchKey         string
	ParsedAt         string
	ScreenshotsDirID int64 // 0 = dir unset → id=1 sentinel on write (column is NOT NULL)
	// ParserGeneration is parser.Generation as of the parse that wrote this row.
	// 0 means unstamped, which is stale by definition. Set by pkg/app, which owns
	// both sides — the store deliberately does not import the parser.
	ParserGeneration int
	Eliminations     int
	Assists          int
	Deaths           int
	Damage           int
	Healing          int
	Mitigation       int
	// QueueType is the parser-detected match format ('role' 5v5 /
	// 'open' 6v6 / '' unread), inferred from players-per-team.
	QueueType string

	HeroStats []HeroStat
}

// HeroStat is one (hero, stat_key, stat_value) row. Shared shape used by
// both teams_hero_stats and personal_hero_stats.
type HeroStat struct {
	Hero      string
	StatKey   string
	StatValue int
}

// PersonalRow holds one parsed PERSONAL screenshot.
type PersonalRow struct {
	ID               int64
	Filename         string
	MatchKey         string
	ParsedAt         string
	ScreenshotsDirID int64 // 0 = dir unset → id=1 sentinel on write (column is NOT NULL)
	// ParserGeneration is parser.Generation as of the parse that wrote this row.
	// 0 means unstamped, which is stale by definition. Set by pkg/app, which owns
	// both sides — the store deliberately does not import the parser.
	ParserGeneration int
	Hero             string
	HeroRaw          string

	HeroStats []HeroStat
}

// RankRow holds one parsed RANK screenshot.
type RankRow struct {
	ID               int64
	Filename         string
	MatchKey         string
	ParsedAt         string
	ScreenshotsDirID int64 // 0 = dir unset → id=1 sentinel on write (column is NOT NULL)
	// ParserGeneration is parser.Generation as of the parse that wrote this row.
	// 0 means unstamped, which is stale by definition. Set by pkg/app, which owns
	// both sides — the store deliberately does not import the parser.
	ParserGeneration int
	Rank             string
	Level            int
	// RankProgress and ChangePercent are pointers because nil ("the caption did
	// not read") and 0 (the bottom of a division; a match that moved the rank by
	// nothing) are different facts that a plain int conflates — which it did for
	// 21 of the 44 rank captures in the corpus.
	RankProgress  *int
	ChangePercent *int
	Result        string
	// RankPercentile is the season-4 "HIGHER RANKED THAN N% OF PLAYERS"
	// reading. nil = the screen carried no such caption (placements, and
	// everything before season 4), which is not the same as 0.
	RankPercentile *int

	Modifiers []string
	// ModifiersRaw is the modifier-row text this release's vocabulary could not
	// account for. A plain string, not a pointer: "" is the honest "nothing
	// unaccounted for", so absent and empty carry the same meaning here — unlike
	// the three readings above, where 0 is a real value.
	ModifiersRaw string
	SR           []HeroSR
}

// HeroSR is one row of rank_sr.
type HeroSR struct {
	Hero   string
	SR     int
	Change int
}

// UserMatchData is the per-match user override layer (user_match_data + its
// child tables). Scalar fields are pointers: nil = "not overridden, use OCR";
// non-nil = the user's value, so a user-entered 0 is distinct from unset. A
// manual match is a UserMatchData whose key has no screenshot row behind it.
type UserMatchData struct {
	MatchKey     string
	Map          *string
	Hero         *string
	Eliminations *int
	Assists      *int
	Deaths       *int
	Damage       *int
	Healing      *int
	Mitigation   *int
	Result       *string
	FinalScore   *string
	Date         *string
	FinishedAt   *string
	GameLength   *string
	// PlayedAtUTC is the canonical UTC instant (RFC3339). Manual entries
	// send an offset on the wire so it's exact; naive Date/FinishedAt/key
	// stay naive-local for axis consistency with OCR rows.
	PlayedAtUTC   *string
	Rank          *string
	Level         *int
	RankProgress  *int
	ChangePercent *int
	UpdatedAt     string
	// Heroes is the heroes-played LIST override (position 0 = primary). When
	// non-empty it replaces the OCR roster wholesale — a manual match's picked
	// heroes, or a deliberate roster correction.
	Heroes []UserMatchHero
	// HeroStats is the per-(hero, stat) cell override, applied INDEPENDENTLY of
	// Heroes: a user can fix one OCR'd stat cell without touching the roster, so
	// these overlay onto the effective heroes-played stats rather than implying a
	// list replacement.
	HeroStats []UserMatchHeroStat
	SR        []HeroSR // per-hero SR override (OCR-rank edits only)
	Modifiers []string // rank modifiers, e.g. "demotion protection"
}

// UserMatchHero is one heroes-played LIST entry in a UserMatchData. PercentPlayed
// and PlayTime are pointers — nil for hand-entered matches, which have neither.
// Per-hero stats live in UserMatchData.HeroStats, not here, so a stat-cell edit
// stays independent of a roster edit.
type UserMatchHero struct {
	Hero          string
	PercentPlayed *int
	PlayTime      *string
	Position      int
}

// UserMatchHeroStat is one overridden stat cell (e.g. junkrat / rip_tire_kill =
// 4). Keyed by (hero, stat_key); overlaid onto the effective heroes-played stats
// at read time.
type UserMatchHeroStat struct {
	Hero    string
	StatKey string
	Value   int
}

// UnknownRow holds one parsed screenshot that didn't match any
// parser.ScreenshotType heuristic. Kept so parses aren't silently dropped.
type UnknownRow struct {
	ID               int64
	Filename         string
	MatchKey         string
	ParsedAt         string
	ScreenshotsDirID int64 // 0 = dir unset → id=1 sentinel on write (column is NOT NULL)
	// ParserGeneration is parser.Generation as of the parse that wrote this row.
	// 0 means unstamped, which is stale by definition. Set by pkg/app, which owns
	// both sides — the store deliberately does not import the parser.
	ParserGeneration int
}

// Screenshots is the bulk-load result — every row in the DB grouped by
// parent type, with children attached.
type Screenshots struct {
	Summaries []SummaryRow
	Teams     []TeamsRow
	Personals []PersonalRow
	Ranks     []RankRow
	Unknowns  []UnknownRow

	// ScreenshotsDirs maps screenshots_dirs.id → path so the aggregator
	// can validate per-row dirIDs before populating SourceDirIDs on
	// each match.Record (stale FKs whose path was deleted yield no
	// URL — the client falls back to the configured dir).
	ScreenshotsDirs map[int64]string

	// AmbiguousCandidates maps filename → candidate matches it could
	// belong to, populated for screenshots whose match_key is
	// "ambiguous-<base64url(filename)>". Empty for the common case.
	AmbiguousCandidates map[string][]AmbiguousCandidate
}

// AmbiguousCandidate is one row of ambiguous_candidates — a possible
// match the screenshot could belong to, captured by the resolver when
// `matchByEAD` finds an EAD signature match in the 5-30 min ambiguous
// zone or multiple matches anywhere in the 0-30 min window.
type AmbiguousCandidate struct {
	MatchKey        string
	DistanceSeconds int
}

// ── Coaching ────────────────────────────────────────────────────────────
//
// Two families that must never be confused, because one machine can be both
// a coach and a player:
//
//   * coach-AUTHORED — what THIS user wrote about someone else's matches
//     while a coaching session was open. Keyed by the player they were
//     written about (CoachPlayer), not by any local match. Survives Clear().
//   * coach-RECEIVED — notes another coach wrote about THIS user's matches,
//     accepted through the return sheet. Keyed by local match_key like every
//     other sidecar. Wiped by Clear() and HardDeleteMatch().

// CoachPlayer identifies a player the local user has coached. PlayerID is
// the stable UUID a "share with a coach" export mints on the player's side;
// it is empty for anonymous/older bundles, where the handle (matched
// case-insensitively) is the best identity available. Handle is display
// only and may be corrected by the coach.
type CoachPlayer struct {
	ID       int64
	PlayerID string
	Handle   string
}

// CoachNote is one coach-authored note against one of a player's matches.
// NoteID is a UUID minted on first save and stable across re-exports — it is
// the identity the player's side dedupes on. Kind is "note" or
// "reviewed_only" (the "I looked at this, nothing to add" mark, which
// carries no text or tags).
type CoachNote struct {
	NoteID     string
	PlayerRef  int64
	MatchKey   string
	Kind       string
	Text       string
	MatchClock string
	FocusTags  []string
	ExtraTags  []string
	CreatedAt  string
	UpdatedAt  string
}

// MatchMoment is one of the PLAYER's own timestamped moments on their match —
// a self-review that can point at seconds. Distinct from the coach families:
// these are the player's words about their own game.
type MatchMoment struct {
	MomentID   string
	MatchKey   string
	MatchClock string
	Text       string
	FocusTag   string
	SortOrder  int
	CreatedAt  string
	UpdatedAt  string
}

// CoachNoteMoment is one timestamped observation hanging off a coach note.
// NoteID is the parent's public id rather than its row id, so callers address
// a moment the same way the API path does.
type CoachNoteMoment struct {
	MomentID   string
	NoteID     string
	MatchClock string
	Text       string
	FocusTag   string
	SortOrder  int
	CreatedAt  string
	UpdatedAt  string
}

// CoachPlayerSummary is one roster row: a player this user has coached,
// with enough to recognize the work.
type CoachPlayerSummary struct {
	ID         int64
	Handle     string
	NoteCount  int
	LastNoteAt string
	// FocusItems is what this coach told that player to work on, in order —
	// the roster's version of the set-level note it replaces.
	FocusItems []string
}

// MatchCoachNote is a coach-RECEIVED note the local user accepted onto one
// of their own matches. NoteID is the coach's UUID, so importing the same
// notes file twice upserts rather than duplicates. Blocks accumulate per
// match — one per (coach, session) — and are never merged into the user's
// own annotation.
type MatchCoachNote struct {
	ID          int64
	NoteID      string
	MatchKey    string
	CoachName   string
	SessionDate string
	Text        string
	MatchClock  string
	FocusTags   []string
	ExtraTags   []string
	// Moments are the coach's timestamped observations, in reading order.
	// They arrive with the note and are stored beside it rather than folded
	// into Text — the player reads them as a list down the match.
	Moments    []MatchCoachNoteMoment
	AcceptedAt string
}

// MatchCoachNoteMoment is one timestamped observation on an accepted note.
type MatchCoachNoteMoment struct {
	MomentID   string
	MatchClock string
	Text       string
	FocusTag   string
	SortOrder  int
}

// CoachReturn is a staged notes file the player has imported but not
// finished deciding on. The file's notes.json is kept verbatim (it is an
// uploaded document; only the decisions are relational) and content-hashed
// so the same file imported twice is the same row.
type CoachReturn struct {
	ID           int64
	ContentHash  string
	CoachName    string
	PlayerHandle string
	SessionDate  string
	NotesJSON    []byte
	ImportedAt   string
	// Decisions is keyed by note_id; a note with no entry is undecided.
	Decisions map[string]CoachDecision
}

// CoachDecision is the player's verdict on one staged note.
type CoachDecision struct {
	Decision  string // "accepted" | "skipped"
	DecidedAt string
}

// SelfReview is one saved sitting in which the player reviewed a set of
// their OWN matches the way a coach would — the player-AUTHORED family
// (see schema.sql). ReviewID is a UUID: the wire id and the identity a
// bundle or a profile move carries, so no integer ever leaves the database.
// FinishedAt is "" while the review is in progress. Loaded whole: the
// member keys in the player's order and every note, keyed by match.
type SelfReview struct {
	ReviewID   string
	Title      string
	CreatedAt  string
	UpdatedAt  string
	FinishedAt string
	MatchKeys  []string
	Notes      map[string]SelfReviewNote
	// FocusItems is what the sitting concluded — what the player is going
	// to work on — in the order they wrote it.
	FocusItems []FocusItem
}

// SelfReviewNote is the player's one note per (review, match): the same
// per-match record the coach's authored note is, plus its moments in
// reading order. Kind is 'note' when words were written and
// 'reviewed_only' when the match was only looked at (or only holds moments).
type SelfReviewNote struct {
	ReviewID   string
	MatchKey   string
	Kind       string
	Text       string
	MatchClock string
	FocusTags  []string
	ExtraTags  []string
	Moments    []SelfReviewMoment
	CreatedAt  string
	UpdatedAt  string
}

// SelfReviewMoment is one timestamped observation inside a self-review
// note. MomentID is minted by the client and unique within its note.
type SelfReviewMoment struct {
	MomentID   string
	MatchClock string
	Text       string
	FocusTag   string
	SortOrder  int
	CreatedAt  string
	UpdatedAt  string
}

// SelfReviewNoteOnMatch is a self-review note as the match sees it: the
// note plus the identity of the review it belongs to, which is what the
// aggregator prints on the block ("Your review · 18 Aug", the title if
// set) and what a delete addresses.
type SelfReviewNoteOnMatch struct {
	SelfReviewNote
	ReviewTitle      string
	ReviewCreatedAt  string
	ReviewFinishedAt string
}
