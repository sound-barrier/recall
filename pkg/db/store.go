package db

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"

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
// CHECK-constrained enum ('role' | 'open'); `SetAt` is the server-
// assigned timestamp captured when the user toggled the value (or
// when a future parser update wrote it from a scoreboard parse).
type QueueState struct {
	QueueType string
	SetAt     string
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
// CHECK-constrained enum ('quickplay' | 'competitive'); `SetAt` is
// the server-assigned timestamp captured when the user toggled the
// value. Acts as an OVERRIDE — the aggregator prefers this when set,
// otherwise falls back to summary_screenshots.mode + rank-row
// presence.
type PlayModeState struct {
	PlayMode string
	SetAt    string
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
	Mode             string
	Hero             string
	Result           string
	FinalScore       string
	Date             string
	FinishedAt       string
	GameLength       string

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
	Mode             string
	Hero             string
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
	MatchKey  string
	DistanceS int
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
	if err := applyMigrations(d); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	// Pre-1.0 break: rewrite legacy colon-form match_keys to the
	// new URL-safe `-` form. Idempotent — once every row carries
	// `match-` / `unmatched-` / `ambiguous-` the LIKE clauses miss
	// and the rewrites no-op. Runs once on every store open; cheap
	// in the post-migration steady state.
	if err := migrateMatchKeysColonToDash(d); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("migrate match_keys: %w", err)
	}
	return &SQLStore{db: d}, nil
}

// migrateMatchKeysColonToDash rewrites the legacy `match:` /
// `unmatched:` / `ambiguous:` prefix + the colon-bearing timestamp
// format `2026-05-10T22:21:11` to the new URL-safe forms across all
// parent tables AND the annotation / hidden / ambiguous_candidates
// child tables that store match_key as a stand-alone value.
//
// Two-step per table:
//  1. Replace the `match:` timestamp colon-form everywhere it appears
//     in match_key. SQLite REPLACE is global within the string; after
//     this step the prefix is still `match:` but the time portion is
//     `T22-21-11`.
//  2. Swap the prefix. Three forms × N tables; each is a single
//     UPDATE with a `WHERE match_key LIKE` so the rewriter only
//     touches rows that still carry the legacy shape.
//
// The order matters because step 2 changes the prefix and step 1
// would no longer find rows; doing step 1 first keeps the LIKE
// patterns simple.
func migrateMatchKeysColonToDash(d *sql.DB) error {
	// match_annotation_members and match_annotation_tags carry FKs on
	// (match_key) → match_annotations(match_key) with ON DELETE CASCADE
	// but no ON UPDATE clause. Updating the parent's match_key would
	// break the child references; defer FK checks across this whole
	// migration so the constraint only fires at COMMIT — by then
	// every table is consistent.
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`PRAGMA defer_foreign_keys = ON`); err != nil {
		return fmt.Errorf("defer_foreign_keys: %w", err)
	}

	tables := []string{
		"summary_screenshots",
		"scoreboard_screenshots",
		"personal_screenshots",
		"rank_screenshots",
		"unknown_screenshots",
		"match_annotations",
		"match_annotation_members",
		"match_annotation_tags",
		"hidden_matches",
		"ambiguous_candidates",
	}
	// Step 1: rewrite `match:<ts>` colons inside the timestamp.
	// Only the `match:` prefix has internal colons; unmatched and
	// ambiguous embed filenames which don't carry colons on disk.
	// The rewrite swaps the two timestamp colons specifically — a
	// pattern like `match:%T%:%:%` would be tighter but SQLite's
	// LIKE doesn't support back-refs; instead, we look for the
	// `T` boundary and rewrite everything after.
	//
	// SQLite's REPLACE() is global so a `match:2026-05-10T22:21:11`
	// becomes `match-2026-05-10T22-21-11` in one pass once we also
	// swap the prefix in step 2. To avoid colliding with the prefix
	// colon, we do prefix-first here: replace `match:` → `match-`,
	// then replace remaining colons in the timestamp.
	for _, t := range tables {
		// Prefix swap. The table name and the prefix literals are
		// all compile-time constants — `t` comes from the closed
		// `tables` slice above, prefix values are inline string
		// literals. No user input ever reaches this SQL string.
		// #nosec G202 -- concat over fixed constants
		for _, prefix := range []struct{ old, new string }{
			{"match:", "match-"},
			{"unmatched:", "unmatched-"},
			{"ambiguous:", "ambiguous-"},
		} {
			q := `UPDATE ` + t + ` SET match_key =
				'` + prefix.new + `' || substr(match_key, ` + lengthLiteral(prefix.old) + `)
				WHERE match_key LIKE '` + prefix.old + `%'`
			if _, err := tx.Exec(q); err != nil {
				return fmt.Errorf("rewrite %s prefix on %s: %w", prefix.old, t, err)
			}
		}
		// Timestamp swap: every `match-` key now has the form
		// `match-2026-05-10T22:21:11`. Replace the two remaining
		// `:` characters with `-`. REPLACE() is global; the
		// `match-` prefix has no colons so only the timestamp's
		// two colons match. Same constant-only-concat shape as
		// the prefix swap above.
		// #nosec G202 -- concat over fixed constants
		q := `UPDATE ` + t + ` SET match_key = REPLACE(match_key, ':', '-')
			WHERE match_key LIKE 'match-%T%'`
		if _, err := tx.Exec(q); err != nil {
			return fmt.Errorf("rewrite timestamp colons on %s: %w", t, err)
		}
	}
	return tx.Commit()
}

// lengthLiteral returns the SQL-literal length-plus-one for
// `substr(... , N)` — SQLite's substr is 1-indexed so the slice
// starts at len(prefix)+1.
func lengthLiteral(s string) string {
	return strconv.Itoa(len(s) + 1)
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
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
