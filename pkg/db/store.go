package db

import (
	"database/sql"
	"fmt"
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
	// (0, nil) so callers can store NULL for unset/legacy.
	EnsureScreenshotsDir(path string) (int64, error)

	// LoadAllFilenames returns every filename across all five parent
	// tables, so the parse loop can skip OCR for already-parsed files.
	LoadAllFilenames() (map[string]bool, error)

	// LoadAll bulk-reads every row across all 10 tables and returns
	// them grouped by parent type with children already attached.
	LoadAll() (Screenshots, error)

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

	// Clear deletes every row in every table — children cascade.
	Clear() error
	Close() error
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
	// which folder this screenshot was ingested from. 0 = NULL (legacy
	// rows parsed before the column existed, or rows where the dir
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
	// can surface SourceDirs on each MatchRecord without a per-row JOIN.
	ScreenshotsDirs map[int64]string
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
	for _, stmt := range schemaStatements {
		if _, err := d.Exec(stmt); err != nil {
			_ = d.Close()
			return nil, fmt.Errorf("schema: %w (stmt: %s)", err, firstLine(stmt))
		}
	}
	// Additive migrations: tolerate "duplicate column" since SQLite has
	// no ADD COLUMN IF NOT EXISTS before 3.35. Fail loudly on anything
	// else so a real schema error doesn't get swallowed.
	for _, stmt := range migrations {
		if _, err := d.Exec(stmt); err != nil {
			if strings.Contains(err.Error(), "duplicate column") {
				continue
			}
			_ = d.Close()
			return nil, fmt.Errorf("migration: %w (stmt: %s)", err, firstLine(stmt))
		}
	}
	return &SQLStore{db: d}, nil
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
