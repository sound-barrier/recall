package db

import "database/sql"

// RawDB exposes the store's internal handle to the external `db_test` package
// so black-box tests can assert on child-table state (cascade cleanup, server-
// stamped timestamps) that the exported Load/Save surface does not reveal. It is
// compiled only under test, so it is not part of the package's real API.
func RawDB(s *SQLStore) *sql.DB { return s.db }

// Migration-engine bridges. The framework is inert pre-1.0 (no shipped
// migration files), so it has no public driver — these re-exports let the
// black-box migrate tests exercise the apply/revert/version primitives.
// Compiled only under test.
var (
	ApplyMigrations          = applyMigrations
	LoadMigrations           = loadMigrations
	SplitVersion             = splitVersion
	SchemaVersion            = schemaVersion
	EnsureSchemaVersionTable = ensureSchemaVersionTable
	ApplyOne                 = applyOne
	RevertOne                = revertOne
)

// NewMigration builds a synthetic migration (unexported fields) for the
// apply/revert round-trip test.
func NewMigration(version int, name, up, down string) migration {
	return migration{version: version, name: name, up: up, down: down}
}
