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
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
