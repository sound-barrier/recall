package db

import (
	"database/sql"
	"errors"
	"fmt"
)

// ErrInvalidBackup marks a restore-candidate file that isn't a usable
// Recall database — not SQLite at all, corrupt, or missing the schema.
// The app layer wraps it into its own 4xx-mapped sentinel.
var ErrInvalidBackup = errors.New("not a valid Recall database")

// schemaSentinelTable is one table every Recall database carries; its
// presence distinguishes a Recall snapshot from an arbitrary SQLite file.
const schemaSentinelTable = "summary_screenshots"

// BackupTo writes a consistent, compacted snapshot of the database at
// srcPath to destPath via `VACUUM INTO`. destPath must NOT already exist
// (SQLite refuses to overwrite) — callers vacuum to a fresh temp path and
// rename it into place. The snapshot captures every committed table, so it
// is a complete backup, not the lossy per-table export the JSON/CSV path was.
func BackupTo(srcPath, destPath string) error {
	src, err := sql.Open("sqlite", srcPath+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return fmt.Errorf("backup: open source: %w", err)
	}
	defer func() { _ = src.Close() }()
	if _, err := src.Exec("VACUUM INTO ?", destPath); err != nil {
		return fmt.Errorf("backup: vacuum into %q: %w", destPath, err)
	}
	return nil
}

// ValidateBackupFile reports whether path is a usable Recall database: it
// opens read-only, runs PRAGMA integrity_check, and confirms the schema
// sentinel table exists. It never mutates the file (no schema apply, no
// migrations) so a candidate snapshot can be vetted before it replaces the
// live DB. Any failure returns an error wrapping ErrInvalidBackup.
func ValidateBackupFile(path string) error {
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("%w: open: %w", ErrInvalidBackup, err)
	}
	// Force a single connection so the read-only pragma + checks share it.
	conn.SetMaxOpenConns(1)
	defer func() { _ = conn.Close() }()

	if _, err := conn.Exec("PRAGMA query_only = ON"); err != nil {
		return fmt.Errorf("%w: %w", ErrInvalidBackup, err)
	}

	var result string
	if err := conn.QueryRow("PRAGMA integrity_check").Scan(&result); err != nil {
		return fmt.Errorf("%w: integrity check: %w", ErrInvalidBackup, err)
	}
	if result != "ok" {
		return fmt.Errorf("%w: integrity check reported %q", ErrInvalidBackup, result)
	}

	var name string
	err = conn.QueryRow(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
		schemaSentinelTable,
	).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: missing %s table", ErrInvalidBackup, schemaSentinelTable)
	}
	if err != nil {
		return fmt.Errorf("%w: schema probe: %w", ErrInvalidBackup, err)
	}
	return nil
}
