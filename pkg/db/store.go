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
	UpsertTeams(r TeamsRow) error
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

	// User match-data override layer — the single source for BOTH inline
	// edits of a parsed match AND hand-entered matches. UpsertUserMatchData
	// replaces a match's override row + children; DeleteUserMatchData removes
	// them (reset-to-OCR / manual-delete); LoadAllUserMatchData returns the
	// full map the aggregator grafts over the OCR Data at read time. A
	// match_key with a row here but no screenshot row anywhere is a manual
	// match.
	UpsertUserMatchData(d UserMatchData) error
	DeleteUserMatchData(matchKey string) error
	LoadAllUserMatchData() (map[string]UserMatchData, error)

	// MatchKeyExists reports whether matchKey is already used anywhere —
	// across the five parent tables and the user-data override layer. Used
	// to reject a manual-match create that would collide with an existing
	// match so the user picks a different minute.
	MatchKeyExists(matchKey string) (bool, error)

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
	// teams screenshot. SetMatchQueue upserts; ClearMatchQueue
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

	// All-Heroes-screenshots surface — recognized-but-unstored skip list.
	// The PERSONAL "All Heroes" aggregate view carries no data worth
	// extracting (its combat totals duplicate the TEAMS screen, and its card
	// icons defeat the OCR), so the parser classifies it "all_heroes" and the
	// write path records only the filename here. Presence means "recognized,
	// skip on every future parse run" — the same hot-path role
	// LoadIgnoredFilenames plays — which keeps the screen out of both the
	// match aggregation and the Unknown tab without re-OCRing it each run.
	UpsertAllHeroesScreenshot(filename string) error
	LoadAllHeroesFilenames() (map[string]bool, error)

	// Clear deletes every row in every table — children cascade.
	Clear() error
	Close() error
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
	// Pragmas ride the DSN so modernc applies them to EVERY pooled
	// connection — a one-off d.Exec only configures whichever single
	// connection ran it, leaving the rest of the pool on SQLite defaults.
	// The load-bearing one is busy_timeout: its default of 0 means a read
	// racing the parse's write fails immediately with SQLITE_BUSY, which
	// surfaced as an intermittent 500 on GET /matches mid-parse. A non-zero
	// timeout makes the loser wait for the lock instead. foreign_keys(1)
	// likewise reaches every connection (CASCADE was only enforced on one).
	// :memory: stays bare — it's single-connection by reuse, so the Exec
	// below is the reliable setter there; the query-string DSN isn't worth
	// the shared-cache complexity for tests.
	dsn := path
	if path != ":memory:" {
		dsn += "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	}
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// Reliable for :memory: (and a harmless re-assert on file paths, where
	// the DSN already enabled it). SQLite ships FK enforcement OFF — without
	// it the schema's ON DELETE CASCADE rules are parsed and silently ignored.
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
	store := &SQLStore{db: d}
	// Reclaim screenshots_dirs rows orphaned by deleted matches / changed watch
	// folders (the FK is RESTRICT, so they never go on their own).
	if _, err := store.PruneScreenshotsDirs(); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("prune screenshots_dirs: %w", err)
	}
	return store, nil
}

func (s *SQLStore) Close() error { return s.db.Close() }

// dirIDOrSentinel maps a zero `screenshots_dir_id` to the sentinel
// row's id (1, seeded by `schema.sql`). Every parent-row insert must
// supply a valid FK target now that the column is `NOT NULL`; the
// sentinel exists so callers that don't have a real dir at hand
// (test fixtures, legacy imports with orphan FKs) can write a row
// without a constraint violation.
func dirIDOrSentinel(n int64) int64 {
	if n == 0 {
		return SentinelScreenshotsDirID
	}
	return n
}
