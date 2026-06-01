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
// Schema evolution lives under `pkg/db/migrations/` as versioned
// `.up.sql` / `.down.sql` pairs applied by `applyMigrations`. The
// baseline (`0001_init`) is the schema captured at the moment the
// migration framework shipped.
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
