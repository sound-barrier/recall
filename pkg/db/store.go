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
	MatchKey    string
	Leaver      string
	Note        string
	ReplayCode  string
	Members     []string
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

// SQLStore is the production Store, backed by *sql.DB.
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
	// Rebuild migrations (CREATE new → COPY → DROP → RENAME) for
	// schema changes ALTER TABLE can't express, e.g. relaxing a
	// CHECK constraint. Each block is guarded by a SELECT COUNT that
	// returns 0 when the migration is already applied — re-running
	// is a no-op.
	for _, m := range rebuildMigrations {
		var n int
		if err := d.QueryRow(m.guard).Scan(&n); err != nil {
			_ = d.Close()
			return nil, fmt.Errorf("rebuild guard %q: %w", m.name, err)
		}
		if n == 0 {
			continue
		}
		tx, err := d.Begin()
		if err != nil {
			_ = d.Close()
			return nil, fmt.Errorf("rebuild %q: begin: %w", m.name, err)
		}
		for _, stmt := range m.statements {
			if _, err := tx.Exec(stmt); err != nil {
				_ = tx.Rollback()
				_ = d.Close()
				return nil, fmt.Errorf("rebuild %q: %w (stmt: %s)", m.name, err, firstLine(stmt))
			}
		}
		if err := tx.Commit(); err != nil {
			_ = d.Close()
			return nil, fmt.Errorf("rebuild %q: commit: %w", m.name, err)
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

// LoadAllFilenames returns the union of every filename across every
// parent table. Used to skip already-parsed files in the next OCR run.
func (s *SQLStore) LoadAllFilenames() (map[string]bool, error) {
	out := map[string]bool{}
	for _, t := range parentTables {
		if err := s.collectFilenames(t, out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *SQLStore) collectFilenames(table string, out map[string]bool) error {
	// #nosec G202 -- table name comes from a hard-coded slice, not user input.
	rows, err := s.db.Query(`SELECT filename FROM ` + table)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			return err
		}
		out[f] = true
	}
	return rows.Err()
}

// Clear deletes every row in every table. Children cascade.
func (s *SQLStore) Clear() error {
	for _, t := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := s.db.Exec(`DELETE FROM ` + t); err != nil {
			return err
		}
	}
	if _, err := s.db.Exec(`DELETE FROM screenshots_dirs`); err != nil {
		return err
	}
	return nil
}

// EnsureScreenshotsDir is the upsert+lookup for screenshots_dirs.
// Returns (0, nil) on empty path so callers can store NULL for "no
// dir set at parse time". For non-empty paths: INSERT OR IGNORE
// (creates if missing, no-ops if present), then SELECT to return
// the id either way.
func (s *SQLStore) EnsureScreenshotsDir(path string) (int64, error) {
	if path == "" {
		return 0, nil
	}
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO screenshots_dirs (path) VALUES (?)`, path); err != nil {
		return 0, err
	}
	var id int64
	if err := s.db.QueryRow(`SELECT id FROM screenshots_dirs WHERE path = ?`, path).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

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

// ──────────────────────────────────────────────────────────────────────
// UPSERT — per parent type. Each runs the parent + child writes inside
// one transaction so a partial failure (child violates a constraint)
// rolls the parent back too.
//
// Parent UPSERT excludes parsed_at from the SET clause so the
// first-insert timestamp is preserved across re-parses (matches the
// previous single-table behaviour).
//
// Child writes use DELETE-then-INSERT (not UPSERT) because the child
// table has no UNIQUE on a non-PK column we can hook ON CONFLICT to;
// the parent's id may also change semantically on conflict-update.
// Wiping and reinserting is correct and simple.
// ──────────────────────────────────────────────────────────────────────

func (s *SQLStore) UpsertSummary(r SummaryRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	err = tx.QueryRow(
		`INSERT INTO summary_screenshots (
			filename, match_key, screenshots_dir_id,
			map, mode, hero, result, final_score, date, finished_at, game_length,
			perf_elim_total, perf_elim_avg_per_10min,
			perf_assists_total, perf_assists_avg_per_10min,
			perf_deaths_total, perf_deaths_avg_per_10min
		) VALUES (?,?,?, ?,?,?,?,?,?,?,?, ?,?, ?,?, ?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id,
			map         = excluded.map,
			mode        = excluded.mode,
			hero        = excluded.hero,
			result      = excluded.result,
			final_score = excluded.final_score,
			date        = excluded.date,
			finished_at = excluded.finished_at,
			game_length = excluded.game_length,
			perf_elim_total            = excluded.perf_elim_total,
			perf_elim_avg_per_10min    = excluded.perf_elim_avg_per_10min,
			perf_assists_total         = excluded.perf_assists_total,
			perf_assists_avg_per_10min = excluded.perf_assists_avg_per_10min,
			perf_deaths_total          = excluded.perf_deaths_total,
			perf_deaths_avg_per_10min  = excluded.perf_deaths_avg_per_10min
		RETURNING id`,
		r.Filename, r.MatchKey, nullableInt64(r.ScreenshotsDirID),
		nullableString(r.Map), nullableString(r.Mode), nullableString(r.Hero),
		nullableString(r.Result), nullableString(r.FinalScore),
		nullableString(r.Date), nullableString(r.FinishedAt), nullableString(r.GameLength),
		r.PerfElimTotal, r.PerfElimAvgPer10Min,
		r.PerfAssistsTotal, r.PerfAssistsAvgPer10Min,
		r.PerfDeathsTotal, r.PerfDeathsAvgPer10Min,
	).Scan(&id)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM summary_heroes_played WHERE summary_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, h := range r.HeroesPlayed {
		if _, err := tx.Exec(
			`INSERT INTO summary_heroes_played (summary_screenshot_id, hero, percent_played, play_time)
			VALUES (?,?,?,?)`,
			id, h.Hero, h.PercentPlayed, nullableString(h.PlayTime),
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) UpsertScoreboard(r ScoreboardRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	err = tx.QueryRow(
		`INSERT INTO scoreboard_screenshots (
			filename, match_key, screenshots_dir_id,
			map, mode, hero,
			eliminations, assists, deaths, damage, healing, mitigation
		) VALUES (?,?,?, ?,?,?, ?,?,?,?,?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id,
			map          = excluded.map,
			mode         = excluded.mode,
			hero         = excluded.hero,
			eliminations = excluded.eliminations,
			assists      = excluded.assists,
			deaths       = excluded.deaths,
			damage       = excluded.damage,
			healing      = excluded.healing,
			mitigation   = excluded.mitigation
		RETURNING id`,
		r.Filename, r.MatchKey, nullableInt64(r.ScreenshotsDirID),
		nullableString(r.Map), nullableString(r.Mode), nullableString(r.Hero),
		r.Eliminations, r.Assists, r.Deaths, r.Damage, r.Healing, r.Mitigation,
	).Scan(&id)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM scoreboard_hero_stats WHERE scoreboard_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, st := range r.HeroStats {
		if _, err := tx.Exec(
			`INSERT INTO scoreboard_hero_stats (scoreboard_screenshot_id, hero, stat_key, stat_value)
			VALUES (?,?,?,?)`,
			id, st.Hero, st.StatKey, st.StatValue,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) UpsertPersonal(r PersonalRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	err = tx.QueryRow(
		`INSERT INTO personal_screenshots (filename, match_key, screenshots_dir_id, hero)
		VALUES (?,?,?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id,
			hero               = excluded.hero
		RETURNING id`,
		r.Filename, r.MatchKey, nullableInt64(r.ScreenshotsDirID), nullableString(r.Hero),
	).Scan(&id)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM personal_hero_stats WHERE personal_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, st := range r.HeroStats {
		if _, err := tx.Exec(
			`INSERT INTO personal_hero_stats (personal_screenshot_id, hero, stat_key, stat_value)
			VALUES (?,?,?,?)`,
			id, st.Hero, st.StatKey, st.StatValue,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) UpsertRank(r RankRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	err = tx.QueryRow(
		`INSERT INTO rank_screenshots (
			filename, match_key, screenshots_dir_id,
			rank, level, rank_progress, change_percent, result
		) VALUES (?,?,?, ?,?,?,?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id,
			rank           = excluded.rank,
			level          = excluded.level,
			rank_progress  = excluded.rank_progress,
			change_percent = excluded.change_percent,
			result         = excluded.result
		RETURNING id`,
		r.Filename, r.MatchKey, nullableInt64(r.ScreenshotsDirID),
		nullableString(r.Rank), r.Level, r.RankProgress, r.ChangePercent,
		nullableString(r.Result),
	).Scan(&id)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM rank_modifiers WHERE rank_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, m := range r.Modifiers {
		if _, err := tx.Exec(
			`INSERT INTO rank_modifiers (rank_screenshot_id, modifier) VALUES (?,?)`,
			id, m,
		); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(`DELETE FROM rank_sr WHERE rank_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, sr := range r.SR {
		if _, err := tx.Exec(
			`INSERT INTO rank_sr (rank_screenshot_id, hero, sr, change) VALUES (?,?,?,?)`,
			id, sr.Hero, sr.SR, sr.Change,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) UpsertUnknown(r UnknownRow) error {
	_, err := s.db.Exec(
		`INSERT INTO unknown_screenshots (filename, match_key, screenshots_dir_id)
		VALUES (?,?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id`,
		r.Filename, r.MatchKey, nullableInt64(r.ScreenshotsDirID),
	)
	return err
}

// ──────────────────────────────────────────────────────────────────────
// Match annotations — user-curated per-match notes (leaver flag + free
// text). UPSERT semantics on SetAnnotation; DeleteAnnotation is a
// targeted delete; LoadAnnotations returns the full snapshot the
// aggregator merges into MatchRecord at read time. The CHECK
// constraint on the leaver column is the source of truth for the
// enum — the App layer additionally validates before reaching SQL so
// the error surface is friendlier than a raw SQLite constraint
// violation.
// ──────────────────────────────────────────────────────────────────────

func (s *SQLStore) SetAnnotation(a Annotation) error {
	// Empty-string leaver is the App-layer "no leaver tag" signal; the
	// SQLite CHECK constraint only accepts NULL or the three valid
	// values, so coerce here. Same for replay_code so an empty string
	// stays an empty string (NULL would be lossy; the column is plain
	// TEXT, an empty string round-trips fine).
	var leaver any
	if a.Leaver == "" {
		leaver = nil
	} else {
		leaver = a.Leaver
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(
		`INSERT INTO match_annotations (match_key, leaver, note, replay_code)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(match_key) DO UPDATE SET
		   leaver       = excluded.leaver,
		   note         = excluded.note,
		   replay_code  = excluded.replay_code,
		   annotated_at = CURRENT_TIMESTAMP`,
		a.MatchKey, leaver, a.Note, a.ReplayCode,
	); err != nil {
		return err
	}
	// Rewrite the member set wholesale — simplest concurrency model
	// (delete-then-reinsert in one txn). Composite-PK on the child
	// table guards against accidental duplicates in the input list.
	if _, err := tx.Exec(`DELETE FROM match_annotation_members WHERE match_key = ?`, a.MatchKey); err != nil {
		return err
	}
	for _, m := range a.Members {
		if m == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO match_annotation_members (match_key, member) VALUES (?, ?)`,
			a.MatchKey, m,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) DeleteAnnotation(matchKey string) error {
	// ON DELETE CASCADE on the child table FK takes care of the
	// member rows in the same statement.
	_, err := s.db.Exec(`DELETE FROM match_annotations WHERE match_key = ?`, matchKey)
	return err
}

func (s *SQLStore) LoadAnnotations() (map[string]Annotation, error) {
	rows, err := s.db.Query(
		`SELECT match_key, COALESCE(leaver, ''), COALESCE(note, ''), COALESCE(replay_code, ''), annotated_at
		 FROM match_annotations`,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := make(map[string]Annotation)
	for rows.Next() {
		var a Annotation
		if err := rows.Scan(&a.MatchKey, &a.Leaver, &a.Note, &a.ReplayCode, &a.AnnotatedAt); err != nil {
			return nil, err
		}
		out[a.MatchKey] = a
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Attach members. One round-trip across the whole table; ordered
	// by match_key for stable iteration during the attach loop.
	memberRows, err := s.db.Query(`SELECT match_key, member FROM match_annotation_members ORDER BY match_key, member`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = memberRows.Close() }()
	for memberRows.Next() {
		var key, member string
		if err := memberRows.Scan(&key, &member); err != nil {
			return nil, err
		}
		a, ok := out[key]
		if !ok {
			// Orphan member row (shouldn't happen with FK enforcement
			// on, but guard against the case for robustness).
			continue
		}
		a.Members = append(a.Members, member)
		out[key] = a
	}
	return out, memberRows.Err()
}

// ──────────────────────────────────────────────────────────────────────
// LoadAll — bulk read. Returns every parent row across all five tables
// with children attached. Aggregator does the per-match grouping.
// ──────────────────────────────────────────────────────────────────────

func (s *SQLStore) LoadAll() (Screenshots, error) {
	var out Screenshots
	var err error
	if out.ScreenshotsDirs, err = s.loadScreenshotsDirs(); err != nil {
		return out, err
	}
	if out.Summaries, err = s.loadSummaries(); err != nil {
		return out, err
	}
	if out.Scoreboards, err = s.loadScoreboards(); err != nil {
		return out, err
	}
	if out.Personals, err = s.loadPersonals(); err != nil {
		return out, err
	}
	if out.Ranks, err = s.loadRanks(); err != nil {
		return out, err
	}
	if out.Unknowns, err = s.loadUnknowns(); err != nil {
		return out, err
	}
	return out, nil
}

func (s *SQLStore) loadScreenshotsDirs() (map[int64]string, error) {
	out := map[int64]string{}
	rows, err := s.db.Query(`SELECT id, path FROM screenshots_dirs`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var path string
		if err := rows.Scan(&id, &path); err != nil {
			return nil, err
		}
		out[id] = path
	}
	return out, rows.Err()
}

func (s *SQLStore) loadSummaries() ([]SummaryRow, error) {
	rows, err := s.db.Query(`SELECT
		id, filename, match_key, parsed_at, screenshots_dir_id,
		map, mode, hero, result, final_score, date, finished_at, game_length,
		perf_elim_total, perf_elim_avg_per_10min,
		perf_assists_total, perf_assists_avg_per_10min,
		perf_deaths_total, perf_deaths_avg_per_10min
		FROM summary_screenshots ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]*SummaryRow{}
	out := make([]SummaryRow, 0)
	for rows.Next() {
		var r SummaryRow
		var dirID sql.NullInt64
		var mapC, mode, hero, result, fs, date, fa, gl sql.NullString
		if err := rows.Scan(
			&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID,
			&mapC, &mode, &hero, &result, &fs, &date, &fa, &gl,
			&r.PerfElimTotal, &r.PerfElimAvgPer10Min,
			&r.PerfAssistsTotal, &r.PerfAssistsAvgPer10Min,
			&r.PerfDeathsTotal, &r.PerfDeathsAvgPer10Min,
		); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		r.Map = mapC.String
		r.Mode = mode.String
		r.Hero = hero.String
		r.Result = result.String
		r.FinalScore = fs.String
		r.Date = date.String
		r.FinishedAt = fa.String
		r.GameLength = gl.String
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}

	hpRows, err := s.db.Query(
		`SELECT summary_screenshot_id, hero, percent_played, play_time
		FROM summary_heroes_played`,
	)
	if err != nil {
		return nil, err
	}
	defer hpRows.Close()
	for hpRows.Next() {
		var id int64
		var h SummaryHeroPlayed
		var pt sql.NullString
		if err := hpRows.Scan(&id, &h.Hero, &h.PercentPlayed, &pt); err != nil {
			return nil, err
		}
		h.PlayTime = pt.String
		if parent, ok := byID[id]; ok {
			parent.HeroesPlayed = append(parent.HeroesPlayed, h)
		}
	}
	return out, hpRows.Err()
}

func (s *SQLStore) loadScoreboards() ([]ScoreboardRow, error) {
	rows, err := s.db.Query(`SELECT
		id, filename, match_key, parsed_at, screenshots_dir_id,
		map, mode, hero,
		eliminations, assists, deaths, damage, healing, mitigation
		FROM scoreboard_screenshots ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]*ScoreboardRow{}
	out := make([]ScoreboardRow, 0)
	for rows.Next() {
		var r ScoreboardRow
		var dirID sql.NullInt64
		var mapC, mode, hero sql.NullString
		if err := rows.Scan(
			&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID,
			&mapC, &mode, &hero,
			&r.Eliminations, &r.Assists, &r.Deaths,
			&r.Damage, &r.Healing, &r.Mitigation,
		); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		r.Map = mapC.String
		r.Mode = mode.String
		r.Hero = hero.String
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}

	hsRows, err := s.db.Query(
		`SELECT scoreboard_screenshot_id, hero, stat_key, stat_value
		FROM scoreboard_hero_stats`,
	)
	if err != nil {
		return nil, err
	}
	defer hsRows.Close()
	for hsRows.Next() {
		var id int64
		var h HeroStat
		if err := hsRows.Scan(&id, &h.Hero, &h.StatKey, &h.StatValue); err != nil {
			return nil, err
		}
		if parent, ok := byID[id]; ok {
			parent.HeroStats = append(parent.HeroStats, h)
		}
	}
	return out, hsRows.Err()
}

func (s *SQLStore) loadPersonals() ([]PersonalRow, error) {
	rows, err := s.db.Query(
		`SELECT id, filename, match_key, parsed_at, screenshots_dir_id, hero
		FROM personal_screenshots ORDER BY id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]*PersonalRow{}
	out := make([]PersonalRow, 0)
	for rows.Next() {
		var r PersonalRow
		var dirID sql.NullInt64
		var hero sql.NullString
		if err := rows.Scan(&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID, &hero); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		r.Hero = hero.String
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}

	hsRows, err := s.db.Query(
		`SELECT personal_screenshot_id, hero, stat_key, stat_value
		FROM personal_hero_stats`,
	)
	if err != nil {
		return nil, err
	}
	defer hsRows.Close()
	for hsRows.Next() {
		var id int64
		var h HeroStat
		if err := hsRows.Scan(&id, &h.Hero, &h.StatKey, &h.StatValue); err != nil {
			return nil, err
		}
		if parent, ok := byID[id]; ok {
			parent.HeroStats = append(parent.HeroStats, h)
		}
	}
	return out, hsRows.Err()
}

func (s *SQLStore) loadRanks() ([]RankRow, error) {
	rows, err := s.db.Query(`SELECT
		id, filename, match_key, parsed_at, screenshots_dir_id,
		rank, level, rank_progress, change_percent, result
		FROM rank_screenshots ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]*RankRow{}
	out := make([]RankRow, 0)
	for rows.Next() {
		var r RankRow
		var dirID sql.NullInt64
		var rank, result sql.NullString
		if err := rows.Scan(
			&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID,
			&rank, &r.Level, &r.RankProgress, &r.ChangePercent, &result,
		); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		r.Rank = rank.String
		r.Result = result.String
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}

	modRows, err := s.db.Query(`SELECT rank_screenshot_id, modifier FROM rank_modifiers`)
	if err != nil {
		return nil, err
	}
	defer modRows.Close()
	for modRows.Next() {
		var id int64
		var m string
		if err := modRows.Scan(&id, &m); err != nil {
			return nil, err
		}
		if parent, ok := byID[id]; ok {
			parent.Modifiers = append(parent.Modifiers, m)
		}
	}
	if err := modRows.Err(); err != nil {
		return nil, err
	}

	srRows, err := s.db.Query(`SELECT rank_screenshot_id, hero, sr, change FROM rank_sr`)
	if err != nil {
		return nil, err
	}
	defer srRows.Close()
	for srRows.Next() {
		var id int64
		var sr HeroSR
		if err := srRows.Scan(&id, &sr.Hero, &sr.SR, &sr.Change); err != nil {
			return nil, err
		}
		if parent, ok := byID[id]; ok {
			parent.SR = append(parent.SR, sr)
		}
	}
	return out, srRows.Err()
}

func (s *SQLStore) loadUnknowns() ([]UnknownRow, error) {
	rows, err := s.db.Query(
		`SELECT id, filename, match_key, parsed_at, screenshots_dir_id
		FROM unknown_screenshots ORDER BY id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]UnknownRow, 0)
	for rows.Next() {
		var r UnknownRow
		var dirID sql.NullInt64
		if err := rows.Scan(&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		out = append(out, r)
	}
	return out, rows.Err()
}
