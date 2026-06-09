package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Store is the persistence boundary the app interacts with. Five typed
// Upsert methods (one per screenshot type) write a parent row plus its
// child rows in a single transaction; LoadAll reads every parent row
// across the five tables with children pre-attached.
type Store interface {
	UpsertSummary(r SummaryRow) error
	UpsertScoreboard(r ScoreboardRow) error
	UpsertPersonal(r PersonalRow) error
	UpsertRank(r RankRow) error
	UpsertUnknown(r UnknownRow) error

	// EnsureScreenshotsDir inserts a screenshots_dirs row for path if
	// one doesn't exist and returns its id. Idempotent — repeated calls
	// with the same path return the same id. Empty path returns
	// (0, nil) so callers can store NULL for unset dir.
	EnsureScreenshotsDir(path string) (int64, error)

	// LookupScreenshotsDir returns the on-disk path recorded for the
	// given screenshots_dirs row id. Used by ScreenshotHandler to
	// resolve `/_screenshot/<dir-id>/<filename>` URLs at request time.
	// Returns ("", nil) for id == 0 (the "use current setting"
	// sentinel embedded in URLs for unparsed files in the watched
	// folder) and for unknown ids. Errors only surface for DB-level
	// failures.
	LookupScreenshotsDir(id int64) (string, error)

	// LoadAllFilenames returns every filename across all five parent
	// tables, so the parse loop can skip OCR for already-parsed files.
	LoadAllFilenames() (map[string]bool, error)

	// LookupMatchKeysForFilename returns every distinct match_key
	// referenced by `filename` across the five parent tables. Used by
	// App.IgnoreScreenshot to wipe the actual match the user clicked
	// on — match-<ts> when the parser failed to extract a map and the
	// row surfaces on the Unknown tab. Returns an empty slice for
	// filenames not in the DB.
	LookupMatchKeysForFilename(filename string) ([]string, error)

	// LoadAll bulk-reads every row across all 10 tables and returns
	// them grouped by parent type with children already attached.
	LoadAll() (Screenshots, error)

	// Ambiguous-attribution surface. When a screenshot's parse can't
	// pin a single match (EAD signature matches in the 5-30 min
	// ambiguous zone, multiple matches inside 0-30 min, or a
	// timestamp-window tie), the resolver records candidates here
	// and the screenshot's parent row stores
	// `match_key = "ambiguous:<filename>"`. Other screenshots within
	// mergeWindow of that screenshot inherit the same sentinel via
	// the timestamp-window pass, so several rows can share one
	// ambiguous match_key. The user picks the real match via
	// `ResolveAmbiguous`, which rewrites every parent row carrying
	// that match_key in lockstep.
	//
	// ApplyAmbiguity is idempotent: it always deletes the filename's
	// rows first, then re-inserts iff cands is non-empty. Presence
	// of any row for filename in ambiguous_candidates is itself the
	// ambiguity flag.
	//
	// ResolveAmbiguous returns (true, nil) on success, (false, nil)
	// when there are no candidates to resolve (caller maps to 404).
	ApplyAmbiguity(filename string, cands []AmbiguousCandidate) error
	LoadAmbiguousCandidatesFor(filename string) ([]AmbiguousCandidate, error)
	ResolveAmbiguous(ambiguousMatchKey, newMatchKey string) (bool, error)

	// Match-annotation surface — user-curated per-match notes.
	// SetAnnotation upserts; DeleteAnnotation removes by key; LoadAnnotations
	// returns the full map keyed by match_key for the aggregator to attach
	// to MatchRecords at read time.
	SetAnnotation(a Annotation) error
	DeleteAnnotation(matchKey string) error
	LoadAnnotations() (map[string]Annotation, error)

	// Soft-delete surface — flag a match as hidden so the aggregator
	// drops it from the default match list (FilterRail "Hidden · N"
	// toggle opts it back in). Per-screenshot rows stay intact so
	// re-parses skip the source files naturally.
	HideMatch(matchKey string) error
	UnhideMatch(matchKey string) error
	LoadHiddenKeys() (map[string]bool, error)

	// HardDeleteMatch removes every trace of matchKey from the DB —
	// rows across all five parent tables (children CASCADE), the
	// hidden_matches flag, the annotation, and the review-status
	// row. Surface for the "Delete forever" affordance on the Hidden
	// drawer. Idempotent.
	HardDeleteMatch(matchKey string) error

	// Per-match review-status surface — `'self'` (user reviewed the
	// VOD themselves) or `'coach'` (a coach reviewed it). Presence
	// in match_reviews IS the "reviewed" signal; absence means "not
	// reviewed." SetReview upserts; ClearReview deletes; LoadReviews
	// returns the full map keyed by match_key for the aggregator to
	// attach to MatchRecord. Each ReviewState carries `reviewed_at`
	// (a server-assigned timestamp) so the dossier can compute
	// activity windows like "days since last review."
	SetReview(matchKey, reviewedBy string) error
	ClearReview(matchKey string) error
	LoadReviews() (map[string]ReviewState, error)

	// Per-match queue-type surface — 'role' (5v5 role queue) or
	// 'open' (6v6 open queue). Presence in match_queue IS the "queue
	// known" signal; absence means "queue not set." Set by the user
	// via the right-panel radiogroup today; a future parser update
	// will also write here when it can count team rows on a
	// scoreboard screenshot. SetMatchQueue upserts; ClearMatchQueue
	// deletes; LoadMatchQueues returns the full map keyed by
	// match_key for the aggregator to attach to MatchRecord.
	SetMatchQueue(matchKey, queueType string) error
	ClearMatchQueue(matchKey string) error
	LoadMatchQueues() (map[string]QueueState, error)
	// BulkSetMatchQueue upserts the same queue_type onto every key
	// in the slice inside ONE transaction. queueType="" deletes the
	// rows (bulk Clear). Single-transaction so a partial mid-write
	// crash leaves the table in a consistent state. Empty key slice
	// is a no-op — callers don't need to short-circuit.
	BulkSetMatchQueue(matchKeys []string, queueType string) error

	// Per-match play-mode override — 'quickplay' or 'competitive'.
	// User-set via the right-panel radiogroup; the aggregator falls
	// back to data.mode (parser-written) when this is absent, and
	// then to rank-row presence (rank only appears in ranked play)
	// before giving up. SetMatchPlayMode upserts; ClearMatchPlayMode
	// deletes; LoadMatchPlayModes returns the full map keyed by
	// match_key for the aggregator to attach to MatchRecord.
	SetMatchPlayMode(matchKey, playMode string) error
	ClearMatchPlayMode(matchKey string) error
	LoadMatchPlayModes() (map[string]PlayModeState, error)

	// ReAggregateUnknowns walks every per-screenshot row whose
	// canonical hero / map is empty but whose raw OCR is preserved,
	// runs the caller-supplied matchers against the current
	// roster, and writes back rows that now resolve to canonical. Used
	// at App.Startup so a YAML release that adds a new hero/map
	// (e.g. Miyazaki) retroactively promotes previously-unknown
	// records — no Tesseract re-run required. Returns the number
	// of rows promoted (hero promotions + map promotions, deduped
	// per row). One transaction across all three parent tables so
	// a partial mid-write crash leaves the table consistent.
	ReAggregateUnknowns(heroFn func(rawHero string) string, mapFn func(rawMap string) string) (int, error)
	// BulkSetMatchPlayMode upserts the same play_mode onto every key
	// in the slice inside ONE transaction. playMode="" deletes the
	// rows (bulk Clear). Same crash-consistency rationale as
	// BulkSetMatchQueue.
	BulkSetMatchPlayMode(matchKeys []string, playMode string) error

	// Ignored-screenshots surface — per-file suppress list for the
	// "Delete forever" affordance on the Unknown tab. Presence in
	// ignored_screenshots means "skip this filename on every future
	// parse run." Idempotent: adding an already-ignored filename
	// refreshes the timestamp; removing a non-ignored one is a no-op.
	//
	// LoadIgnoredFilenames is the hot path the parse loop consults
	// (presence-only map). ListIgnoredScreenshots returns the same
	// rows with their `ignored_at` timestamp for the Settings panel.
	// ClearIgnoredScreenshots truncates the table in one statement
	// for the bulk "Re-enable all" action.
	AddIgnoredScreenshot(filename string) error
	RemoveIgnoredScreenshot(filename string) error
	LoadIgnoredFilenames() (map[string]bool, error)
	ListIgnoredScreenshots() ([]IgnoredRow, error)
	ClearIgnoredScreenshots() error

	// Clear deletes every row in every table — children cascade.
	Clear() error
	Close() error
}

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
// (or when a future parser update wrote it from a scoreboard parse).
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
	Mode       string
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

// ScoreboardRow holds one parsed SCOREBOARD screenshot.
type ScoreboardRow struct {
	ID               int64
	Filename         string
	MatchKey         string
	ParsedAt         string
	ScreenshotsDirID int64 // 0 = NULL
	Map              string
	MapRaw           string
	Mode             string
	Hero             string
	HeroRaw          string
	Eliminations     int
	Assists          int
	Deaths           int
	Damage           int
	Healing          int
	Mitigation       int

	HeroStats []HeroStat
}

// HeroStat is one (hero, stat_key, stat_value) row. Shared shape used by
// both scoreboard_hero_stats and personal_hero_stats.
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
	Summaries   []SummaryRow
	Scoreboards []ScoreboardRow
	Personals   []PersonalRow
	Ranks       []RankRow
	Unknowns    []UnknownRow

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

// SQLStore is the production Store, backed by *sql.DB. Methods are
// split across `store_<concern>.go` files — `ls pkg/db/store_*.go` is
// the source of truth for the available concerns.
//
// Per-concern UPSERT methods (one parent + its children) run inside
// a single transaction so a child constraint violation rolls the
// parent back too. Parent UPSERT excludes parsed_at from the SET
// clause so the first-insert timestamp is preserved across re-parses.
// Child writes use DELETE-then-INSERT — the child table has no UNIQUE
// on a non-PK column we could hook ON CONFLICT to, and the parent's
// id may also change semantically on conflict-update. Wiping and
// re-inserting is correct and simple.
type SQLStore struct {
	db *sql.DB
}

var _ Store = (*SQLStore)(nil)

// NewSQLStore opens the SQLite database at path, applies the schema, and
// enables foreign-key enforcement so ON DELETE CASCADE fires for child
// rows. path may be ":memory:" for tests.
func NewSQLStore(path string) (*SQLStore, error) {
	d, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// SQLite ships with FK enforcement OFF by default — without this
	// PRAGMA, the ON DELETE CASCADE rules in the schema are parsed and
	// silently ignored.
	if _, err := d.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		_ = d.Close()
		return nil, err
	}
	if err := applySchema(d); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	// No-op until the first migration file lands post-1.0; the
	// framework is wired in so adding one is a drop-in addition.
	if err := applyMigrations(d); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &SQLStore{db: d}, nil
}

func (s *SQLStore) Close() error { return s.db.Close() }

// nullableString maps Go "" to SQL NULL for nullable TEXT columns.
func nullableString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

// nullableInt64 maps Go 0 to SQL NULL for nullable INTEGER FK columns
// (specifically screenshots_dir_id, which uses 0 as the unset sentinel).
func nullableInt64(n int64) sql.NullInt64 {
	if n == 0 {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: n, Valid: true}
}
