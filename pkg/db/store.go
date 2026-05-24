package db

import (
	"database/sql"
	"encoding/json"
	"strings"

	_ "modernc.org/sqlite"
)

// Store is the persistence boundary the app interacts with. Methods take/
// return MatchRow (a flat SQL-shaped struct) so this package stays free of
// any dependency on pkg/parser — JSON columns are passed through as raw
// strings and decoded by the caller.
//
// Tests in pkg/app use a fake Store (no SQLite needed); the production
// wiring uses *SQLStore against modernc.org/sqlite at the on-disk path
// (or ":memory:" in pkg/db's own tests).
type Store interface {
	LoadAll() ([]MatchRow, error)
	LoadSourceFilenames() (map[string]bool, error)
	Upsert(r MatchRow) error
	Clear() error
	Close() error
}

// MatchRow mirrors one match_results row. Scalars use "" / 0 to mean SQL
// NULL — the SQLStore handles the conversion. JSON-encoded columns stay as
// raw strings here so this package doesn't have to know about HeroPlay,
// Performance, HeroSR, or Modifiers from pkg/parser. The caller decodes.
type MatchRow struct {
	ID       int64
	MatchKey string

	// SourceFiles is the decoded source_files JSON array. Decoded for
	// convenience because every caller iterates it.
	SourceFiles []string
	// SourceTypes is the decoded source_types JSON object (filename → type).
	// May be nil for rows persisted before the column existed.
	SourceTypes map[string]string
	// SourceParsedAt is the decoded source_parsed_at JSON object
	// (filename → ISO8601 timestamp of when that file was first
	// inserted into the DB). May be nil or missing entries for
	// rows / files persisted before the column existed.
	SourceParsedAt map[string]string

	// ParsedAt is the row's match-level "first inserted at" timestamp,
	// from the schema's parsed_at column. Stable across subsequent
	// upserts — Upsert intentionally does not refresh this on
	// conflict so the UI can display "this match was parsed on X"
	// without the value shifting when a screenshot is added later.
	ParsedAt string

	Map, Type, Mode, Role, Hero string

	Eliminations, Assists, Deaths int
	Damage, Healing, Mitigation   int

	Result, FinalScore           string
	Date, FinishedAt, GameLength string

	// Pre-encoded JSON for columns the store doesn't decode (callers own the
	// Go types these encode/decode to). "" means SQL NULL.
	HeroesPlayedJSON string
	PerformanceJSON  string
	ModifiersJSON    string
	SRJSON           string

	Rank                               string
	Level, RankProgress, ChangePercent int
}

// SQLStore is the production Store, backed by *sql.DB (modernc.org/sqlite).
// Holds a *sql.DB by composition — embedding would expose every database/sql
// method on SQLStore, which is more surface than the interface needs.
type SQLStore struct {
	db *sql.DB
}

// Compile-time assertion that *SQLStore satisfies Store. Catches an
// accidental signature drift (renaming a method, changing a return
// type) at build time instead of at the call site. Mirrors the
// pattern used by the fake store in pkg/app/store_integration_test.go.
var _ Store = (*SQLStore)(nil)

// NewSQLStore opens the SQLite database at path, applies the schema and
// idempotent migrations, and returns a ready-to-use Store. path may be
// ":memory:" for tests.
func NewSQLStore(path string) (*SQLStore, error) {
	d, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if _, err := d.Exec(schema); err != nil {
		_ = d.Close()
		return nil, err
	}
	for _, m := range migrations {
		if _, err := d.Exec(m); err != nil {
			// Lightweight migrations are idempotent; "duplicate column"
			// fires when the migration already applied. Anything else is a
			// real failure.
			if !strings.Contains(err.Error(), "duplicate column") {
				_ = d.Close()
				return nil, err
			}
		}
	}
	return &SQLStore{db: d}, nil
}

// Close releases the underlying connection pool.
func (s *SQLStore) Close() error { return s.db.Close() }

// LoadSourceFilenames returns a set of every source filename across every
// row, so the app can skip OCR for already-parsed files.
func (s *SQLStore) LoadSourceFilenames() (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT source_files FROM match_results`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	parsed := map[string]bool{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var files []string
		if err := json.Unmarshal([]byte(raw), &files); err != nil {
			return nil, err
		}
		for _, f := range files {
			parsed[f] = true
		}
	}
	return parsed, rows.Err()
}

// LoadAll returns every match_results row, ordered by id. Initializes the
// slice to length 0 so an empty result set still JSON-marshals as `[]`
// (the OpenAPI spec for GET /api/match-results declares `type: array`,
// which a nil slice would violate).
func (s *SQLStore) LoadAll() ([]MatchRow, error) {
	rows, err := s.db.Query(`SELECT
		id, match_key, source_files, source_types, source_parsed_at,
		map, type, mode, role, hero,
		eliminations, assists, deaths, damage, healing, mitigation,
		result, final_score, date, finished_at, game_length,
		heroes_played, performance,
		rank, level, rank_progress, change_percent, modifiers, sr,
		parsed_at
		FROM match_results ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]MatchRow, 0)
	for rows.Next() {
		var r MatchRow
		var sourcesJSON string
		var typesJSON, parsedAtJSON sql.NullString
		var mapCol, typeCol, mode, role, hero sql.NullString
		var result, finalScore, date, finishedAt, gameLength sql.NullString
		var heroesJSON, perfJSON sql.NullString
		var rank sql.NullString
		var modifiersJSON, srJSON sql.NullString
		var parsedAt sql.NullString
		err := rows.Scan(
			&r.ID, &r.MatchKey, &sourcesJSON, &typesJSON, &parsedAtJSON,
			&mapCol, &typeCol, &mode, &role, &hero,
			&r.Eliminations, &r.Assists, &r.Deaths,
			&r.Damage, &r.Healing, &r.Mitigation,
			&result, &finalScore, &date, &finishedAt, &gameLength,
			&heroesJSON, &perfJSON,
			&rank, &r.Level, &r.RankProgress, &r.ChangePercent,
			&modifiersJSON, &srJSON,
			&parsedAt,
		)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(sourcesJSON), &r.SourceFiles); err != nil {
			return nil, err
		}
		if typesJSON.Valid && typesJSON.String != "" {
			_ = json.Unmarshal([]byte(typesJSON.String), &r.SourceTypes)
		}
		if parsedAtJSON.Valid && parsedAtJSON.String != "" {
			_ = json.Unmarshal([]byte(parsedAtJSON.String), &r.SourceParsedAt)
		}
		r.Map = mapCol.String
		r.Type = typeCol.String
		r.Mode = mode.String
		r.Role = role.String
		r.Hero = hero.String
		r.Result = result.String
		r.FinalScore = finalScore.String
		r.Date = date.String
		r.FinishedAt = finishedAt.String
		r.GameLength = gameLength.String
		r.Rank = rank.String
		r.HeroesPlayedJSON = heroesJSON.String
		r.PerformanceJSON = perfJSON.String
		r.ModifiersJSON = modifiersJSON.String
		r.SRJSON = srJSON.String
		r.ParsedAt = parsedAt.String
		out = append(out, r)
	}
	return out, rows.Err()
}

// Upsert writes one row, replacing any existing row with the same match_key.
// parsed_at intentionally is NOT refreshed on conflict — once a row exists
// its parsed_at represents the first time that match key was inserted, and
// the UI displays it as "this match was parsed on X" without shifting on
// subsequent re-parses (e.g. when the user adds a rank screenshot later).
func (s *SQLStore) Upsert(r MatchRow) error {
	sourcesJSON, err := json.Marshal(r.SourceFiles)
	if err != nil {
		return err
	}
	var typesJSON sql.NullString
	if len(r.SourceTypes) > 0 {
		b, err := json.Marshal(r.SourceTypes)
		if err != nil {
			return err
		}
		typesJSON = sql.NullString{String: string(b), Valid: true}
	}
	var parsedAtJSON sql.NullString
	if len(r.SourceParsedAt) > 0 {
		b, err := json.Marshal(r.SourceParsedAt)
		if err != nil {
			return err
		}
		parsedAtJSON = sql.NullString{String: string(b), Valid: true}
	}

	_, err = s.db.Exec(
		`INSERT INTO match_results (
			match_key, source_files, source_types, source_parsed_at,
			map, type, mode, role, hero,
			eliminations, assists, deaths, damage, healing, mitigation,
			result, final_score, date, finished_at, game_length,
			heroes_played, performance,
			rank, level, rank_progress, change_percent, modifiers, sr
		) VALUES (?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?,?,?)
		ON CONFLICT(match_key) DO UPDATE SET
			source_files     = excluded.source_files,
			source_types     = excluded.source_types,
			source_parsed_at = excluded.source_parsed_at,
			map              = excluded.map,
			type             = excluded.type,
			mode             = excluded.mode,
			role             = excluded.role,
			hero             = excluded.hero,
			eliminations     = excluded.eliminations,
			assists          = excluded.assists,
			deaths           = excluded.deaths,
			damage           = excluded.damage,
			healing          = excluded.healing,
			mitigation       = excluded.mitigation,
			result           = excluded.result,
			final_score      = excluded.final_score,
			date             = excluded.date,
			finished_at      = excluded.finished_at,
			game_length      = excluded.game_length,
			heroes_played    = excluded.heroes_played,
			performance      = excluded.performance,
			rank             = excluded.rank,
			level            = excluded.level,
			rank_progress    = excluded.rank_progress,
			change_percent   = excluded.change_percent,
			modifiers        = excluded.modifiers,
			sr               = excluded.sr`,
		// parsed_at: NOT included in the UPDATE so the first-insert
		// timestamp is preserved across re-parses.
		r.MatchKey, string(sourcesJSON), typesJSON, parsedAtJSON,
		nullableString(r.Map), nullableString(r.Type),
		nullableString(r.Mode), nullableString(r.Role),
		nullableString(r.Hero),
		r.Eliminations, r.Assists, r.Deaths,
		r.Damage, r.Healing, r.Mitigation,
		nullableString(r.Result), nullableString(r.FinalScore),
		nullableString(r.Date), nullableString(r.FinishedAt),
		nullableString(r.GameLength),
		nullableString(r.HeroesPlayedJSON), nullableString(r.PerformanceJSON),
		nullableString(r.Rank), r.Level,
		r.RankProgress, r.ChangePercent,
		nullableString(r.ModifiersJSON), nullableString(r.SRJSON),
	)
	return err
}

// Clear deletes every row in match_results without touching the schema.
func (s *SQLStore) Clear() error {
	_, err := s.db.Exec(`DELETE FROM match_results`)
	return err
}

// nullableString maps a Go "" to SQL NULL.
func nullableString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
