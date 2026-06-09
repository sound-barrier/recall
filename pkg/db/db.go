// Package db owns the SQLite persistence layer for Recall. The Store
// interface is the boundary the app uses; SQLStore is the production
// implementation.
//
// Schema is 3NF: one parent table per screenshot type (SUMMARY,
// SCOREBOARD, PERSONAL, RANK, UNKNOWN) plus per-parent child tables
// for the repeating-group fields (heroes_played, modifiers, sr, hero
// stats). Each screenshot's parse writes to its own parent + children
// in one transaction; aggregation is read-time only.
//
// Schema is a single embedded file at `pkg/db/schema.sql` applied by
// `applySchema` on every `NewSQLStore`. Pre-1.0 the project uses a
// "wipe + relaunch" model — no migration framework, no
// `schema_version` table, no rollback path. When the schema changes
// incompatibly the operator wipes the DB (CONTRIBUTING.md carries
// the per-platform path).
package db

// parentTables enumerates every parent screenshot table. Used by
// LoadAllFilenames, Clear, and the aggregator to iterate uniformly.
var parentTables = []string{
	"summary_screenshots",
	"scoreboard_screenshots",
	"personal_screenshots",
	"rank_screenshots",
	"unknown_screenshots",
}
