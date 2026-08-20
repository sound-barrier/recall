package db

import (
	"database/sql"
	"io/fs"
)

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
	ApplyMigrationsFrom      = applyMigrationsFrom
	LoadMigrations           = func() ([]migration, error) { return loadMigrationsFrom(migrationsFS) }
	SplitVersion             = splitVersion
	SchemaVersion            = schemaVersion
	EnsureSchemaVersionTable = ensureSchemaVersionTable
	ApplyOne                 = applyOne
	RevertOne                = revertOne
)

// LoadedMigration is the readable view of a parsed migration pair. The real
// `migration` struct is unexported in every field, so the black-box tests
// assert on this instead of reaching inside it.
type LoadedMigration struct {
	Version int
	Name    string
	Up      string
	Down    string
}

// LoadMigrationsFrom parses a synthetic migration directory out of any fs.FS
// (the shipped one is empty pre-1.0) and returns the pairs in load order.
func LoadMigrationsFrom(fsys fs.FS) ([]LoadedMigration, error) {
	migs, err := loadMigrationsFrom(fsys)
	if err != nil {
		return nil, err
	}
	out := make([]LoadedMigration, 0, len(migs))
	for _, m := range migs {
		out = append(out, LoadedMigration{Version: m.version, Name: m.name, Up: m.up, Down: m.down})
	}
	return out, nil
}

// NewMigration builds a synthetic migration (unexported fields) for the
// apply/revert round-trip test.
func NewMigration(version int, name, up, down string) migration {
	return migration{version: version, name: name, up: up, down: down}
}

// Additive-schema bridges: ensureAdditiveColumns runs inside NewSQLStore, so
// the graceful-upgrade path has no public driver over a bare *sql.DB. Compiled
// only under test.
var (
	EnsureAdditiveColumns = ensureAdditiveColumns
	ColumnExists          = columnExists
)

// MatchKeyTables exposes the match_key registry to schema_registry_test, which
// holds it to schema.sql. A shim rather than a real export: nothing in
// production reads the list — renameMatchKey walks it directly — so exporting
// it would be a public symbol with no caller, which the deadcode gate refuses
// and rightly.
func MatchKeyTables() []string { return append([]string(nil), matchKeyTables...) }
