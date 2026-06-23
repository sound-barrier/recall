package db

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
)

// Migration framework.
//
// Pre-1.0 the schema lives entirely in `pkg/db/schema.sql` (applied
// by `applySchema`) and migrations are intentionally empty — the
// `migrations/` directory ships with no `.up.sql` / `.down.sql`
// pairs, so `applyMigrations` is a no-op on every store open. The
// scaffolding is preserved so that once 1.0 lands and the schema is
// stable, schema changes can be expressed as versioned
// `NNNN_<name>.{up,down}.sql` pairs without re-introducing the
// framework.
//
// File-pair conventions, when they start shipping:
//
//   - Each migration is a versioned pair under `pkg/db/migrations/`:
//     `NNNN_<name>.up.sql` (forward) and `NNNN_<name>.down.sql`
//     (rollback). The version is the leading integer, parsed as int
//     and applied in ascending order.
//   - Statements inside a single file are split on `-- statement-end`
//     so a syntax error points at exactly one statement
//     (`splitStatements` lives in `schema.go` and is shared).
//   - Each migration runs in its own transaction; partial failure
//     rolls the version forward only if the SQL committed.
//   - Every `.up.sql` requires a paired `.down.sql`.

//go:embed migrations
var migrationsFS embed.FS

// schemaVersion returns the highest applied migration version, or
// 0 if the schema_version table doesn't exist yet.
func schemaVersion(d *sql.DB) (int, error) {
	row := d.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`)
	var name string
	if err := row.Scan(&name); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, fmt.Errorf("probe schema_version: %w", err)
	}
	var v sql.NullInt64
	if err := d.QueryRow(`SELECT MAX(version) FROM schema_version`).Scan(&v); err != nil {
		return 0, fmt.Errorf("read schema_version: %w", err)
	}
	if !v.Valid {
		return 0, nil
	}
	return int(v.Int64), nil
}

// migration is one parsed file pair.
type migration struct {
	version int
	name    string
	up      string
	down    string
}

// loadMigrations reads + parses every migration pair from the
// embedded FS, sorted by version ascending. Returns an empty slice
// when no migration files have shipped yet (the pre-1.0 state).
// Errors when any `.up.sql` lacks a paired `.down.sql` (or
// vice-versa) or the filename doesn't parse as
// `NNNN_<name>.{up,down}.sql`.
func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("read migrations dir: %w", err)
	}
	byKey := map[string]*migration{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		var dir string
		switch {
		case strings.HasSuffix(name, ".up.sql"):
			dir = "up"
		case strings.HasSuffix(name, ".down.sql"):
			dir = "down"
		default:
			continue
		}
		key := strings.TrimSuffix(name, "."+dir+".sql")
		num, _, err := splitVersion(key)
		if err != nil {
			return nil, fmt.Errorf("parse %q: %w", name, err)
		}
		body, err := fs.ReadFile(migrationsFS, "migrations/"+name)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", name, err)
		}
		m, ok := byKey[key]
		if !ok {
			m = &migration{version: num, name: key}
			byKey[key] = m
		}
		if dir == "up" {
			m.up = string(body)
		} else {
			m.down = string(body)
		}
	}
	out := make([]migration, 0, len(byKey))
	for _, m := range byKey {
		if m.up == "" {
			return nil, fmt.Errorf("migration %s: missing .up.sql", m.name)
		}
		if m.down == "" {
			return nil, fmt.Errorf("migration %s: missing .down.sql", m.name)
		}
		out = append(out, *m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

func splitVersion(key string) (int, string, error) {
	// key shape: "NNNN_<name>"
	idx := strings.Index(key, "_")
	if idx <= 0 {
		return 0, "", errors.New("missing version prefix")
	}
	num, err := strconv.Atoi(key[:idx])
	if err != nil {
		return 0, "", fmt.Errorf("non-numeric version: %w", err)
	}
	return num, key[idx+1:], nil
}

// applyMigrations runs every pending migration in order. With no
// migration files shipped (the pre-1.0 state), this returns nil
// immediately without creating the `schema_version` table — the
// store stays free of framework state until the first real
// migration lands.
func applyMigrations(d *sql.DB) error {
	migs, err := loadMigrations()
	if err != nil {
		return err
	}
	if len(migs) == 0 {
		return nil
	}
	current, err := schemaVersion(d)
	if err != nil {
		return err
	}
	if err := ensureSchemaVersionTable(d); err != nil {
		return err
	}
	for _, m := range migs {
		if m.version <= current {
			continue
		}
		if err := applyOne(d, m); err != nil {
			return fmt.Errorf("apply migration %s: %w", m.name, err)
		}
	}
	return nil
}

func ensureSchemaVersionTable(d *sql.DB) error {
	_, err := d.Exec(`CREATE TABLE IF NOT EXISTS schema_version (
		version    INTEGER PRIMARY KEY,
		name       TEXT NOT NULL,
		applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return fmt.Errorf("create schema_version: %w", err)
	}
	return nil
}

func applyOne(d *sql.DB, m migration) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, stmt := range splitStatements(m.up) {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("statement %q: %w", firstLine(stmt), err)
		}
	}
	if _, err := tx.Exec(`INSERT INTO schema_version (version, name) VALUES (?, ?)`, m.version, m.name); err != nil {
		return fmt.Errorf("record version: %w", err)
	}
	return tx.Commit()
}

// revertOne runs a single migration's `.down.sql` inside a
// transaction and removes its row from `schema_version`. Test-only
// today — the production runner has no rollback path, but the
// round-trip test exercises this so a bad `.down.sql` fails CI
// instead of failing first in a real rollback.
func revertOne(d *sql.DB, m migration) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, stmt := range splitStatements(m.down) {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("statement %q: %w", firstLine(stmt), err)
		}
	}
	if _, err := tx.Exec(`DELETE FROM schema_version WHERE version = ?`, m.version); err != nil {
		return fmt.Errorf("clear version %d: %w", m.version, err)
	}
	return tx.Commit()
}
