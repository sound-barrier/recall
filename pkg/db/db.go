// SPDX-License-Identifier: Apache-2.0

// Package db owns the SQLite persistence layer for Recall. The Store
// interface is the boundary the app uses; SQLStore is the production
// implementation.
//
// Schema is 3NF: one parent table per screenshot type (SUMMARY,
// TEAMS, PERSONAL, RANK, UNKNOWN) plus per-parent child tables
// for the repeating-group fields (heroes_played, modifiers, sr, hero
// stats). Each screenshot's parse writes to its own parent + children
// in one transaction; aggregation is read-time only.
//
// Schema is a single embedded file at `pkg/db/schema.sql` applied by
// `applySchema` on every `NewSQLStore`. Pre-1.0 the project uses a
// "wipe + relaunch" model — when the schema changes incompatibly
// the operator wipes the DB (CONTRIBUTING.md carries the per-platform
// path).
//
// The migration framework in `migrate.go` is scaffolded but
// intentionally inert: `pkg/db/migrations/` ships with no
// `.up.sql` / `.down.sql` pairs pre-1.0, so `applyMigrations` is a
// no-op on every store open. Once 1.0 lands and the schema is
// stable, schema changes go in as versioned migration pairs and the
// runner picks them up automatically.
package db

// parentTables enumerates every parent screenshot table. Used by
// LoadAllFilenames, Clear, and the aggregator to iterate uniformly.
var parentTables = []string{
	"summary_screenshots",
	"teams_screenshots",
	"personal_screenshots",
	"rank_screenshots",
	"unknown_screenshots",
}

// matchKeyTables is every table that names a match by its match_key and is
// NOT reached through a parent's cascade. One list, because match_key is the
// match's identity and a match can be RENAMED — resolving an ambiguous
// screenshot does exactly that — so anything missing here is silently
// stranded on a key nothing will look up again.
//
// It is deliberately not "every table with a match_key column":
//
//   - The user_match_* children, the match_annotation_* children and
//     self_review_notes reach their key through a parent FK declared
//     ON UPDATE CASCADE, so renaming the parent renames them. Listing them
//     here would be a second, competing write.
//   - coach_notes is excluded on purpose. Its match_key belongs to ANOTHER
//     player's corpus — it is what this user, as a coach, wrote about a
//     loaned match. Renaming one of our own keys must not touch it.
//
// storeSchemaCompletenessTest pins this against schema.sql, so a new table
// with a match_key column fails the build rather than going quietly missing.
var matchKeyTables = []string{
	"summary_screenshots",
	"teams_screenshots",
	"personal_screenshots",
	"rank_screenshots",
	"unknown_screenshots",
	"ambiguous_candidates",
	"hidden_matches",
	"acknowledged_reference_gaps",
	"pinned_matches",
	"match_annotations",
	"match_moments",
	"match_reviews",
	"match_queue",
	"match_play_mode",
	"match_coach_notes",
	"self_review_matches",
	"share_export_matches",
	"user_match_data",
	"duplicate_matches",
}

// secondaryMatchKeyColumns is every column that names a match by something
// OTHER than `match_key`. matchKeyTables above is keyed on the column NAME,
// and storeSchemaCompletenessTest can only see columns that carry it — so a
// column like duplicate_matches.duplicate_of is invisible to both, and a
// rename would strand it on a dead key while its card went on claiming a
// duplicate. There is one today; the point of the list is that the next one
// has somewhere to go.
var secondaryMatchKeyColumns = []struct{ table, column string }{
	{"duplicate_matches", "duplicate_of"},
}
