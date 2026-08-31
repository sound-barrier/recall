package db_test

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"recall/pkg/db"
)

// The registry that says which tables a match rename has to reach, held
// against the schema itself.
//
// match_key is the match's identity in twenty-odd tables and is declared a
// foreign key in none of them — a match is five parent rows, not one
// referenceable row — so the rename is hand-written. That makes a new table
// with a match_key column a silent bug: rows on the old key, unreachable
// forever, and in user_match_data's case a phantom manual match.
//
// This is the same shape as the rank-modifier CHECK held against the
// parser's vocabulary: the list cannot rot, because the schema fails it.

var (
	createTableRe = regexp.MustCompile(`(?s)CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\((.*?)\n\)`)
	matchKeyColRe = regexp.MustCompile(`(?m)^\s*match_key\b`)
	// A child that reaches its key through a parent FK comes along on the
	// parent's ON UPDATE CASCADE; listing it would be a second, competing
	// write. Anything else with a match_key column belongs in the registry.
	cascadingChildRe = regexp.MustCompile(`REFERENCES\s+\w+\s*\([^)]*match_key[^)]*\)\s*ON UPDATE CASCADE`)
)

// coachAuthored names the tables whose match_key belongs to SOMEBODY
// ELSE's corpus: what this user, as a coach, wrote about a loaned match,
// and which loaned matches a sitting covered. Renaming one of our own keys
// must never touch either.
var coachAuthored = []string{"coach_notes", "coach_session_matches"}

func tablesDeclaringMatchKey(t *testing.T) (registry, cascading []string) {
	t.Helper()
	raw, err := os.ReadFile("schema.sql")
	if err != nil {
		t.Fatalf("read schema.sql: %v", err)
	}
	// Strip comments so match_key in prose does not count as a column.
	var body strings.Builder
	for line := range strings.SplitSeq(string(raw), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			body.WriteString(line + "\n")
		}
	}
	for _, m := range createTableRe.FindAllStringSubmatch(body.String(), -1) {
		name, cols := m[1], m[2]
		if !matchKeyColRe.MatchString(cols) {
			continue
		}
		switch {
		case cascadingChildRe.MatchString(cols):
			cascading = append(cascading, name)
		case slices.Contains(coachAuthored, name):
			// Deliberately neither.
		default:
			registry = append(registry, name)
		}
	}
	return registry, cascading
}

func TestSchema_EveryMatchKeyTableIsRenamable(t *testing.T) {
	want, cascading := tablesDeclaringMatchKey(t)
	got := db.MatchKeyTables()
	slices.Sort(want)
	slices.Sort(got)

	for _, table := range want {
		if !slices.Contains(got, table) {
			t.Errorf("%s declares match_key but is not in the rename registry — "+
				"resolving an ambiguous match would strand its rows on a dead key", table)
		}
	}
	for _, table := range got {
		if !slices.Contains(want, table) {
			t.Errorf("the rename registry names %s, which no longer declares a match_key column", table)
		}
	}
	if len(cascading) == 0 {
		t.Error("no cascading child found — the ON UPDATE CASCADE the rename relies on is gone")
	}
	for _, table := range cascading {
		if slices.Contains(got, table) {
			t.Errorf("%s cascades from its parent AND is in the registry — one of the two is wrong", table)
		}
	}
}
