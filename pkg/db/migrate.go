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

// Schema migrations.
//
// Each migration is a versioned pair of SQL files under
// `pkg/db/migrations/`: `NNNN_<name>.up.sql` (forward) and
// `NNNN_<name>.down.sql` (rollback). The version is the leading
// integer, parsed as int and applied in ascending order. Statements
// inside a single file are split on `-- statement-end` so a syntax
// error points at exactly one statement.
//
// Two operating modes:
//
//  1. Fresh DB — schema_version table does not exist; the runner
//     creates it and applies every up migration in order, recording
//     each version as it goes.
//
//  2. Legacy DB (pre-framework users) — parent tables already exist
//     from the previous idempotent CREATE-IF-NOT-EXISTS sweep, but no
//     schema_version row. The runner detects this case and seeds
//     schema_version at the current latest version without re-running
//     the baseline. Subsequent migrations apply normally on top.
//
// Each migration runs in its own transaction; partial failure rolls
// the version forward only if the SQL committed.

//go:embed migrations/*.sql
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

// migration is one parsed file pair: the version, the file basename,
// and the SQL bodies of the up and down halves.
type migration struct {
	version int
	name    string
	up      string
	down    string
}

// loadMigrations reads + parses every migration pair from the
// embedded FS, sorted by version ascending. Returns an error if any
// up file lacks a paired down or vice-versa, or if the filename
// doesn't parse as `NNNN_<name>.{up,down}.sql`.
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

// listMigrationFiles is a test helper: returns the set of distinct
// migration keys (e.g. "0001_init") whose .up.sql exists, and the set
// of those whose .down.sql exists, so a test can assert pairing.
func listMigrationFiles() (ups []string, downs map[string]struct{}, err error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, nil, err
	}
	downs = map[string]struct{}{}
	for _, e := range entries {
		n := e.Name()
		switch {
		case strings.HasSuffix(n, ".up.sql"):
			ups = append(ups, strings.TrimSuffix(n, ".up.sql"))
		case strings.HasSuffix(n, ".down.sql"):
			downs[strings.TrimSuffix(n, ".down.sql")] = struct{}{}
		}
	}
	return ups, downs, nil
}

func splitVersion(key string) (int, string, error) {
	// key shape: "NNNN_<name>"
	idx := strings.Index(key, "_")
	if idx <= 0 {
		return 0, "", fmt.Errorf("missing version prefix")
	}
	num, err := strconv.Atoi(key[:idx])
	if err != nil {
		return 0, "", fmt.Errorf("non-numeric version: %w", err)
	}
	return num, key[idx+1:], nil
}

// splitStatements breaks a migration body into individual SQL
// statements on lines whose content is exactly the sentinel
// "-- statement-end" (leading/trailing whitespace ignored). Matching
// whole-line-only prevents the splitter from triggering on prose that
// quotes the sentinel inside a doc comment. Empty pieces are dropped.
func splitStatements(body string) []string {
	const sentinel = "-- statement-end"
	lines := strings.Split(body, "\n")
	var (
		out  []string
		curr []string
	)
	flush := func() {
		piece := strings.TrimSpace(strings.Join(curr, "\n"))
		if piece != "" {
			out = append(out, piece)
		}
		curr = curr[:0]
	}
	for _, line := range lines {
		if strings.TrimSpace(line) == sentinel {
			flush()
			continue
		}
		curr = append(curr, line)
	}
	flush()
	return out
}

// applyMigrations runs every pending migration in order. On a fresh
// DB it creates schema_version and applies the full set. On a legacy
// DB (parent tables already exist via the old idempotent CREATE
// sweep) it seeds schema_version at the latest known version and
// skips re-applying the baseline.
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
	// Legacy-DB adoption: schema_version doesn't exist yet but a known
	// table from the baseline does. Mark every shipped version as
	// already applied; the legacy DB's structure IS the baseline.
	if current == 0 {
		legacy, err := looksLikeLegacyDB(d)
		if err != nil {
			return err
		}
		if legacy {
			if err := ensureSchemaVersionTable(d); err != nil {
				return err
			}
			for _, m := range migs {
				if _, err := d.Exec(`INSERT INTO schema_version (version, name) VALUES (?, ?)`, m.version, m.name); err != nil {
					return fmt.Errorf("seed schema_version %d: %w", m.version, err)
				}
			}
			return nil
		}
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

// looksLikeLegacyDB returns true when the DB has parent tables from
// the pre-framework era but no schema_version table. Used solely to
// distinguish "fresh DB, apply everything" from "existing DB on the
// implicit baseline, mark as up-to-date".
func looksLikeLegacyDB(d *sql.DB) (bool, error) {
	row := d.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='summary_screenshots'`)
	var n int
	if err := row.Scan(&n); err != nil {
		return false, fmt.Errorf("probe legacy table: %w", err)
	}
	return n > 0, nil
}
