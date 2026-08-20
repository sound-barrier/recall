package db

import (
	"database/sql"
	"fmt"
)

// querier is the read surface shared by *sql.DB and *sql.Tx. LoadAll's
// bulk loaders take it so the whole snapshot reads through ONE deferred
// transaction instead of racing pooled connections.
type querier interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

// Bulk read/write paths — LoadAll fans out across the five parent
// tables; LoadAllFilenames is the union read used by the parse loop
// to skip already-parsed files; Clear wipes every parent (children
// cascade) plus the screenshots_dirs lookup.

// LoadAll bulk-reads every row across all parent tables with their
// children attached. The aggregator does the per-match grouping.
//
// The loaders run inside ONE deferred read transaction: on pooled
// connections a cross-table write landing between them (e.g.
// ResolveAmbiguous rewriting a parent key + deleting its candidate rows)
// was visible half-applied — a torn aggregate.
func (s *SQLStore) LoadAll() (Screenshots, error) {
	var out Screenshots
	tx, err := s.db.Begin()
	if err != nil {
		return out, fmt.Errorf("load screenshots: %w", err)
	}
	// Read-only usage; Rollback just releases the snapshot.
	defer func() { _ = tx.Rollback() }()
	if out.ScreenshotsDirs, err = loadScreenshotsDirs(tx); err != nil {
		return out, fmt.Errorf("load screenshots: %w", err)
	}
	if out.Summaries, err = loadSummaries(tx); err != nil {
		return out, fmt.Errorf("load screenshots: %w", err)
	}
	if out.Teams, err = loadTeams(tx); err != nil {
		return out, fmt.Errorf("load screenshots: %w", err)
	}
	if out.Personals, err = loadPersonals(tx); err != nil {
		return out, fmt.Errorf("load screenshots: %w", err)
	}
	if out.Ranks, err = loadRanks(tx); err != nil {
		return out, fmt.Errorf("load screenshots: %w", err)
	}
	if out.Unknowns, err = loadUnknowns(tx); err != nil {
		return out, fmt.Errorf("load screenshots: %w", err)
	}
	if out.AmbiguousCandidates, err = loadAllAmbiguousCandidates(tx); err != nil {
		return out, fmt.Errorf("load screenshots: %w", err)
	}
	return out, nil
}

// LoadAllFilenames returns the union of every filename across every
// parent table. Used to skip already-parsed files in the next OCR run.
func (s *SQLStore) LoadAllFilenames() (map[string]bool, error) {
	out := map[string]bool{}
	for _, t := range parentTables {
		if err := s.collectFilenames(t, out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// LookupMatchKeysForFilename returns every distinct match_key that
// has a row referencing `filename` across the five parent tables.
// Used by App.IgnoreScreenshot to wipe the actual match the user
// clicked on — which may be keyed `match-<ts>` (a tracked match
// whose parser failed to extract a map name, surfacing it on the
// Unknown tab), not just the unmatched- / ambiguous- shapes the
// earlier wipe handled. Idempotent / safe on absent filenames
// (returns an empty slice, no error).
func (s *SQLStore) LookupMatchKeysForFilename(filename string) ([]string, error) {
	seen := map[string]bool{}
	for _, t := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		rows, err := s.db.Query(`SELECT DISTINCT match_key FROM `+t+` WHERE filename = ?`, filename)
		if err != nil {
			return nil, err
		}
		if err := scanMatchKeys(rows, seen); err != nil {
			return nil, err
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	return out, nil
}

func scanMatchKeys(rows *sql.Rows, out map[string]bool) error {
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return err
		}
		out[k] = true
	}
	return rows.Err()
}

// LoadMatchKeys returns every DISTINCT match_key the profile tracks: the
// five parent tables plus the user override layer (a manual match lives only
// there). The same table set MatchKeyExists probes, read in bulk.
func (s *SQLStore) LoadMatchKeys() (map[string]bool, error) {
	out := map[string]bool{}
	for _, t := range append(append([]string{}, parentTables...), "user_match_data") {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		rows, err := s.db.Query(`SELECT DISTINCT match_key FROM ` + t)
		if err != nil {
			return nil, fmt.Errorf("load match keys: %w", err)
		}
		if err := scanMatchKeys(rows, out); err != nil {
			return nil, fmt.Errorf("load match keys: %w", err)
		}
	}
	return out, nil
}

func (s *SQLStore) collectFilenames(table string, out map[string]bool) error {
	return s.collectFilenamesWhere(table, "", nil, out)
}

// LoadFilenamesForDir is collectFilenames scoped to ONE screenshots folder.
//
// The parse skip set has to be folder-scoped, because filename is a basename
// and screenshots_dirs accumulates rows as the user re-points the folder. A
// basename-keyed skip set meant a same-named capture in a second folder was
// treated as already parsed and silently never ingested — no row, no failed
// entry, no Unknown-tab appearance, and left out of the pending count too.
func (s *SQLStore) LoadFilenamesForDir(dirID int64) (map[string]bool, error) {
	out := map[string]bool{}
	for _, t := range parentTables {
		if err := s.collectFilenamesWhere(t, `WHERE screenshots_dir_id = ?`, []any{dirID}, out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *SQLStore) collectFilenamesWhere(table, where string, args []any, out map[string]bool) error {
	// #nosec G202 -- table name comes from a hard-coded slice, and `where` is
	// one of the constant predicates above.
	rows, err := s.db.Query(`SELECT filename FROM `+table+` `+where, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			return err
		}
		out[f] = true
	}
	return rows.Err()
}

// Clear deletes every row in every table — parent screenshot tables
// (children cascade), the screenshots_dirs lookup, the per-match
// auxiliary tables (match_reviews, match_annotations with its
// children cascading, hidden_matches, ambiguous_candidates, match_
// queue, match_play_mode, the received coach layer), the dedup
// registry, AND the ignored_screenshots suppress list. Used by App.ClearDatabase, which
// expects a "wipe my match history" semantic. Callers that
// want the suppress list to survive (App.ClearDatabase's keep-
// ignored opt-out path) snapshot the list, call Clear, then re-
// insert via AddIgnoredScreenshot.
//
// Deliberately NOT wiped: the coach-AUTHORED family (coach_players,
// coach_notes, coach_session_summaries). Those are notes this user wrote
// about OTHER players' matches — not match history — and a coach clearing
// an empty database must not lose their coaching work.
func (s *SQLStore) Clear() error {
	// One transaction for the whole wipe + sentinel reseed — the
	// crash-consistency convention the per-concern bulk writers follow. A
	// mid-way failure between the parent wipe and the user_match_data delete
	// would otherwise leave override rows whose matches resurrect as manual
	// matches on the next aggregate, and dying between the screenshots_dirs
	// delete and the reseed would FK-fail every insert until restart.
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, t := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := tx.Exec(`DELETE FROM ` + t); err != nil {
			return err
		}
	}
	for _, t := range []string{
		"failed_files", // references screenshots_dirs RESTRICT — must precede it
		"screenshots_dirs",
		"match_reviews",
		"match_queue",
		"match_play_mode",
		"match_annotations", // match_annotation_members + _tags cascade
		"match_moments",     // the player's own timestamped moments; no FK to cascade through
		"hidden_matches",
		"pinned_matches",
		"ambiguous_candidates",
		"ignored_screenshots",
		// The dedup registry. A standing duplicate is skipped before OCR on
		// every run, ReParseAll included, so a row surviving a wipe of the
		// history it describes silently withholds a screenshot forever.
		"ingested_files",
		"all_heroes_screenshots",
		"user_match_data",   // user_match_* children cascade on the match_key FK
		"match_coach_notes", // tag children cascade
		"coach_returns",     // coach_return_decisions cascade
		"self_reviews",      // membership, notes, tags and moments cascade
		"share_exports",     // the sent ledger; share_export_matches cascade
		// The player-side focus families are match history (self_review_focus_items
		// cascades with its sitting, but naming it is cheaper than relying on
		// the order the parent wipe happens to run in); coach_focus_items is the
		// AUTHORED family and survives, like the summaries it replaces.
		"received_focus_items",
		"self_review_focus_items",
	} {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := tx.Exec(`DELETE FROM ` + t); err != nil {
			return err
		}
	}
	// Re-seed the default screenshots-dir sentinel (id=1) that schema.sql
	// creates. Every parent table defaults screenshots_dir_id to 1, so wiping
	// the row above would FK-fail the very next insert — e.g. a forced
	// re-seed (`make seed-dev FORCE=1`) onto a profile that already exists, or
	// any insert that relies on the default rather than EnsureScreenshotsDir.
	// It's a config sentinel ("use the active screenshots folder"), not data.
	if _, err := tx.Exec(`INSERT OR IGNORE INTO screenshots_dirs (id, path) VALUES (1, '')`); err != nil {
		return err
	}
	return tx.Commit()
}
