package db

import (
	"database/sql"
	_ "embed"
	"fmt"
	"strings"
)

// Pre-1.0 the project ships a single consolidated schema and a
// "wipe + relaunch" model for breaking changes — no `schema_version`
// table, no migration framework, no rollback path. Every CREATE
// uses `IF NOT EXISTS` so re-opening an existing DB is a no-op;
// when the schema changes incompatibly the operator wipes the DB
// (CONTRIBUTING.md carries the per-platform path).

//go:embed schema.sql
var schemaSQL string

// applySchema executes every statement in schema.sql against d.
// Statements are separated by `-- statement-end` so a syntax error
// can point at exactly one statement.
func applySchema(d *sql.DB) error {
	for _, stmt := range splitStatements(schemaSQL) {
		if _, err := d.Exec(stmt); err != nil {
			return fmt.Errorf("schema statement %q: %w", firstLine(stmt), err)
		}
	}
	return nil
}

// additiveColumns lists nullable columns added AFTER their table's original
// CREATE — the one schema-evolution case `CREATE TABLE IF NOT EXISTS` can't
// handle (it never alters an existing table). Kept deliberately tiny.
var additiveColumns = []struct{ table, column, ddl string }{
	{"summary_screenshots", "played_at_utc", "TEXT"},
	{"user_match_data", "played_at_utc", "TEXT"},
	{"rank_screenshots", "rank_percentile", "INTEGER"},
	// parser.Generation, stamped per row. Nullable, so the additive path can add
	// it to a database that predates it — and NULL is exactly the right value
	// there: a row written before the column existed cannot claim any vintage.
	{"summary_screenshots", "parser_generation", "INTEGER"},
	{"teams_screenshots", "parser_generation", "INTEGER"},
	{"personal_screenshots", "parser_generation", "INTEGER"},
	{"rank_screenshots", "parser_generation", "INTEGER"},
	{"unknown_screenshots", "parser_generation", "INTEGER"},
	// The one NOT NULL entry, and it is safe for a reason worth stating: SQLite
	// accepts ADD COLUMN NOT NULL when a CONSTANT default backfills the existing
	// rows, which '' does. Adding it nullable instead would leave every
	// pre-existing rank row with a NULL in a column the loader scans into a plain
	// string — the exact breakage backfillLegacyNulls exists to repair.
	{"rank_screenshots", "modifiers_raw", "TEXT NOT NULL DEFAULT ''"},
	// Every row that predates teams was a player — the constant default IS
	// the backfill, same shape as modifiers_raw above.
	{"coach_players", "kind", "TEXT NOT NULL DEFAULT 'player' CHECK (kind IN ('player', 'team'))"},
	// Same constant-default shape: every annotation written before the
	// column existed described a match that counts, which is ''.
	{"match_annotations", "exclusion_reason", "TEXT NOT NULL DEFAULT '' CHECK (exclusion_reason IN ('', 'placement', 'mmr_adjustment', 'outage'))"},
	{"ambiguous_candidates", "reason", "TEXT NOT NULL DEFAULT '' CHECK (reason IN ('', 'duplicate_stats', 'same_instant'))"},
}

// ensureAdditiveColumns adds any additiveColumns missing from an already-created
// database. Pre-1.0 the versioned migration framework is intentionally inert and
// the model is wipe-and-relaunch — but that forces a user with real history to
// discard it for a purely additive column, and until the column exists every
// INSERT (and the documented Re-parse All backfill) 500s. This is the ONE safe
// exception: additive nullable columns only, checked via PRAGMA table_info and
// added with ALTER TABLE ADD COLUMN (idempotent). Anything non-additive still
// belongs in the 1.0 migration framework.
func ensureAdditiveColumns(d *sql.DB) error {
	for _, c := range additiveColumns {
		has, err := columnExists(d, c.table, c.column)
		if err != nil {
			return err
		}
		if has {
			continue
		}
		// #nosec G202 -- table/column/ddl are hard-coded constants above, not
		// user input; ADD COLUMN doesn't accept bound parameters for the name.
		if _, err := d.Exec("ALTER TABLE " + c.table + " ADD COLUMN " + c.column + " " + c.ddl); err != nil {
			return fmt.Errorf("add %s.%s: %w", c.table, c.column, err)
		}
	}
	return nil
}

// legacyNullBackfills lists columns that today's schema declares
// NOT NULL with an empty-string default but that exist as plain nullable TEXT in databases
// created before the current shape (CREATE TABLE IF NOT EXISTS never
// retrofits constraints) — rows from back then can carry NULL, and the
// loaders scan every one of these into a plain string, so a single
// legacy row broke every matches load. The set is every string-scanned
// column observed nullable in a real pre-rename database; playlist (the
// mode→playlist rename) is the case caught in the wild.
var legacyNullBackfills = []struct{ table, column string }{
	{"summary_screenshots", "map"},
	{"summary_screenshots", "playlist"},
	{"summary_screenshots", "hero"},
	{"summary_screenshots", "result"},
	{"summary_screenshots", "final_score"},
	{"summary_screenshots", "date"},
	{"summary_screenshots", "finished_at"},
	{"summary_screenshots", "game_length"},
	{"personal_screenshots", "hero"},
	{"rank_screenshots", "rank"},
	{"rank_screenshots", "result"},
}

// backfillLegacyNulls heals legacy NULLs to the schema's empty-string default at
// store open. Idempotent (the WHERE clause matches nothing after the
// first run) and additive-safe — it only rewrites values the current
// schema forbids, never real data.
func backfillLegacyNulls(d *sql.DB) error {
	for _, b := range legacyNullBackfills {
		// #nosec G202 -- table/column are hard-coded constants above, not
		// user input; identifiers can't be bound as parameters.
		if _, err := d.Exec("UPDATE " + b.table + " SET " + b.column + " = '' WHERE " + b.column + " IS NULL"); err != nil {
			return fmt.Errorf("backfill %s.%s: %w", b.table, b.column, err)
		}
	}
	return nil
}

// columnExists reports whether table has a column named column.
func columnExists(d *sql.DB, table, column string) (bool, error) {
	found, _, err := columnInfo(d, table, column)
	return found, err
}

// columnInfo reports whether table has the named column and whether that column
// is declared NOT NULL. The nullability half is what detects a database whose
// shape predates a column becoming nullable — SQLite cannot alter that in place.
func columnInfo(d *sql.DB, table, column string) (found, notNull bool, err error) {
	// #nosec G202 -- table is a hard-coded constant from the tables above.
	rows, err := d.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return false, false, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var (
			cid, nn, pk int
			name, ctype string
			dflt        any
		)
		if err := rows.Scan(&cid, &name, &ctype, &nn, &dflt, &pk); err != nil {
			return false, false, err
		}
		if name == column {
			return true, nn != 0, nil
		}
	}
	return false, false, rows.Err()
}

// nowNullableColumns lists columns whose NOT NULL a later schema DROPPED.
//
// SQLite cannot change a column's nullability in place, CREATE TABLE IF NOT
// EXISTS never alters, and ensureAdditiveColumns is deliberately limited to
// ADDING nullable columns — so an install created before the change still
// carries NOT NULL forever. That is not a cosmetic drift: UpsertRank writes the
// parent and its children in one transaction, so a NULL rejected by the old
// constraint rolls the whole rank row back. Half the rank captures in the
// corpus read no movement pill, so on an upgraded install that is most of them,
// lost silently while the app looks like it is working.
//
// Pre-1.0 the model is wipe-and-relaunch and the real fix belongs in the 1.0
// migration framework. Until then the honest behavior is to refuse to open and
// SAY SO, which surfaces through the startup-failure modal rather than as
// missing rows nobody can explain. Re-parse All is what repopulates the new
// values anyway — the screenshots are the source of truth, not the database.
var nowNullableColumns = []struct{ table, column string }{
	{"rank_screenshots", "rank_progress"},
	{"rank_screenshots", "change_percent"},
}

// ensureNoStaleNotNull refuses to open a database whose columns still carry a
// NOT NULL that the current schema drops.
func ensureNoStaleNotNull(d *sql.DB) error {
	for _, c := range nowNullableColumns {
		found, notNull, err := columnInfo(d, c.table, c.column)
		if err != nil {
			return err
		}
		if found && notNull {
			return fmt.Errorf(
				"database predates this build: %s.%s is still NOT NULL, but this "+
					"version stores NULL there to distinguish \"the screenshot did not "+
					"report it\" from a real 0. Writing to it would discard whole rank "+
					"rows. Back up if you want the old file, then clear the database and "+
					"run Re-parse All \u2014 your screenshots are the source of truth",
				c.table, c.column)
		}
	}
	return nil
}

// splitStatements breaks a SQL body into individual statements on
// lines whose content is exactly the sentinel `-- statement-end`.
// Matching whole-line-only prevents the splitter from triggering on
// prose that quotes the sentinel inside a doc comment. Empty pieces
// are dropped.
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

func firstLine(s string) string {
	if before, _, ok := strings.Cut(s, "\n"); ok {
		return before
	}
	return s
}
