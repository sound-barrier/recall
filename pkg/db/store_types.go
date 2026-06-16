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
type IgnoredRow struct {
	Filename  string
	IgnoredAt string
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
// member list. Every scalar is optional; the App-layer policy is "if
// every field is empty, delete the row entirely" (see
// App.SetMatchAnnotation). Leaver, when set, is one of
// {"self", "team", "enemy"} — the SQL CHECK constraint enforces this
// at the boundary too.
type Annotation struct {
	MatchKey   string
	Leaver     string
	Note       string
	ReplayCode string
	Members    []string
	// Free-form user tags applied to the match. `stack`, `stream`,
	// `placement` are the conventional three (surfaced as quick-add
	// toggles in the inline editor); the user can add anything.
	// Normalised to lowercase + trimmed at the app layer before
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
	// which folder this screenshot was ingested from. 0 = NULL (the dir
	// was unset at parse time).
	ScreenshotsDirID int64
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

	PerfElimTotal          int
	PerfElimAvgPer10Min    float64
	PerfAssistsTotal       int
	PerfAssistsAvgPer10Min float64
	PerfDeathsTotal        int
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
	ScreenshotsDirID int64 // 0 = NULL
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
	ScreenshotsDirID int64 // 0 = NULL
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
	ScreenshotsDirID int64 // 0 = NULL
	Rank             string
	Level            int
	RankProgress     int
	ChangePercent    int
	Result           string

	Modifiers []string
	SR        []HeroSR
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
	MatchKey      string
	Map           *string
	Hero          *string
	Eliminations  *int
	Assists       *int
	Deaths        *int
	Damage        *int
	Healing       *int
	Mitigation    *int
	Result        *string
	FinalScore    *string
	Date          *string
	FinishedAt    *string
	GameLength    *string
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
	ScreenshotsDirID int64 // 0 = NULL
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
	// each MatchRecord (stale FKs whose path was deleted yield no
	// URL — the client falls back to the configured dir).
	ScreenshotsDirs map[int64]string

	// AmbiguousCandidates maps filename → candidate matches it could
	// belong to, populated for screenshots whose match_key is
	// "ambiguous:<filename>". Empty for the common case.
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
