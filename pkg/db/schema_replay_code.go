package db

import (
	"database/sql"
	"fmt"
	"sort"

	"recall/pkg/match"
)

// replayCodeIndex is the uniqueness guarantee that lets a replay code mint a
// match key. It is PARTIAL for a reason: most matches have no code, and the
// column represents that as both NULL and the empty string depending on which
// build wrote the row. SQLite lets NULLs coexist under a unique index but not
// empty strings, so a plain UNIQUE would refuse to be created the moment two
// matches had no code — which is to say, immediately, on every real database.
const replayCodeIndex = `CREATE UNIQUE INDEX IF NOT EXISTS idx_match_annotations_replay_code
	ON match_annotations (replay_code)
	WHERE replay_code IS NOT NULL AND replay_code <> ''`

// normalizeReplayCodes canonicalizes stored replay codes and then guarantees
// they are unique, at store open, idempotently.
//
// Codes predate the rule that now governs them: they were stored verbatim for
// as long as they were only ever displayed. A code is now an identity a match
// key is minted from, so the same six characters have to have one spelling
// and name one match.
//
// Two deliberate limits on what this is allowed to destroy:
//
//   - A code that is merely the wrong CASE is repaired.
//   - A code that is the wrong LENGTH or holds the wrong characters is left
//     exactly as it is. It cannot be repaired by re-casing, it still renders,
//     it is still searchable, and it simply never mints a key — which is what
//     it already did. Deleting it would be destroying something the user
//     typed in order to satisfy a rule it was never asked to meet.
//
// Duplicates are the one case where data does go: the unique index cannot be
// created while two matches claim one code, and an index that fails to create
// at open is a desktop app that will not launch. The earliest match keeps the
// code.
func normalizeReplayCodes(d *sql.DB) error {
	stored, err := loadStoredReplayCodes(d)
	if err != nil {
		return err
	}
	for key, want := range resolveReplayCodes(stored) {
		if want == stored[key] {
			continue
		}
		if _, err := d.Exec(
			`UPDATE match_annotations SET replay_code = ? WHERE match_key = ?`, want, key); err != nil {
			return fmt.Errorf("normalize replay code for %s: %w", key, err)
		}
	}
	if _, err := d.Exec(replayCodeIndex); err != nil {
		return fmt.Errorf("create replay-code unique index: %w", err)
	}
	return nil
}

// loadStoredReplayCodes reads every annotation that claims a code.
func loadStoredReplayCodes(d *sql.DB) (map[string]string, error) {
	rows, err := d.Query(
		`SELECT match_key, replay_code FROM match_annotations
		 WHERE replay_code IS NOT NULL AND replay_code <> ''`)
	if err != nil {
		return nil, fmt.Errorf("load replay codes: %w", err)
	}
	defer func() { _ = rows.Close() }()

	stored := map[string]string{}
	for rows.Next() {
		var key, code string
		if err := rows.Scan(&key, &code); err != nil {
			return nil, fmt.Errorf("scan replay code: %w", err)
		}
		stored[key] = code
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read replay codes: %w", err)
	}
	return stored, nil
}

// resolveReplayCodes maps each match key to the code it should end up with:
// the canonical form where one exists, the original where it does not, and
// the empty string for the losers of a collision.
//
// Grouping happens on the RESOLVED value, so `a1b2c3` and `A1B2C3` collide
// with each other (they are one Overwatch match typed twice) while two
// unrepairable codes only collide when they are already identical.
func resolveReplayCodes(stored map[string]string) map[string]string {
	claims := map[string][]string{}
	resolved := make(map[string]string, len(stored))
	for key, code := range stored {
		want := code
		if canonical, ok := match.NormalizeReplayCode(code); ok {
			want = canonical
		}
		resolved[key] = want
		claims[want] = append(claims[want], key)
	}
	for _, keys := range claims {
		if len(keys) < 2 {
			continue
		}
		// Lexicographic order over `match-<ISO timestamp>` keys is
		// chronological, so the smallest key is the earliest match.
		sort.Strings(keys)
		for _, loser := range keys[1:] {
			resolved[loser] = ""
		}
	}
	return resolved
}
