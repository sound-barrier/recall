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
	// #nosec G202 -- table is a hard-coded constant from additiveColumns.
	rows, err := d.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return false, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var (
			cid, notnull, pk int
			name, ctype      string
			dflt             any
		)
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
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
