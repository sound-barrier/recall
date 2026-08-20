package db_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"recall/pkg/db"
)

// Reproduces a real-world crash: a database created before the mode→playlist
// rename has `playlist TEXT` (nullable, no default) — CREATE TABLE IF NOT
// EXISTS never retrofits the current NOT-NULL-DEFAULT shape — and any row
// written before the column existed carries NULL. loadSummaries scans the
// column into a plain string, so ONE legacy row broke every matches load:
//
//	load screenshots: sql: Scan error on column index 7, name "playlist":
//	converting NULL to string is unsupported
//
// The store must heal such rows at open (backfill NULL to the empty string),
// keeping the wipe-and-relaunch model for everything non-additive.
func TestNewSQLStore_HealsLegacyNullPlaylist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	writeLegacyDB(t, path)

	store, err := db.NewSQLStore(path)
	if err != nil {
		t.Fatalf("NewSQLStore on legacy db: %v", err)
	}
	defer func() { _ = store.Close() }()

	shots, err := store.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll on healed legacy db: %v", err)
	}
	if len(shots.Summaries) != 1 {
		t.Fatalf("summaries = %d, want 1", len(shots.Summaries))
	}
	if got := shots.Summaries[0].Playlist; got != "" {
		t.Errorf("playlist = %q, want the healed empty string", got)
	}
	if shots.Summaries[0].Hero != "lucio" {
		t.Errorf("hero = %q — the legacy row's real data must survive the heal", shots.Summaries[0].Hero)
	}
	if len(shots.Ranks) != 1 {
		t.Fatalf("ranks = %d, want 1", len(shots.Ranks))
	}
	if got := shots.Ranks[0].Rank; got != "" {
		t.Errorf("rank = %q, want the healed empty string", got)
	}
}

// writeLegacyDB lays down the pre-rename schema + rows the heal must fix.
func writeLegacyDB(t *testing.T, path string) {
	t.Helper()
	// The exact legacy summary_screenshots shape observed in the wild
	// (nullable scalars, no played_at_utc yet), with one row predating the
	// playlist column — its playlist is NULL.
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open raw: %v", err)
	}
	if _, err := raw.Exec(`CREATE TABLE summary_screenshots (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		filename      TEXT NOT NULL UNIQUE,
		match_key     TEXT NOT NULL,
		parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		screenshots_dir_id INTEGER NOT NULL DEFAULT 1,
		map           TEXT,
		map_raw       TEXT NOT NULL DEFAULT '',
		playlist      TEXT,
		hero          TEXT,
		hero_raw      TEXT NOT NULL DEFAULT '',
		result        TEXT,
		final_score   TEXT,
		date          TEXT,
		finished_at   TEXT,
		game_length   TEXT,
		eliminations            INTEGER NOT NULL DEFAULT 0,
		perf_elim_avg_per_10min    REAL    NOT NULL DEFAULT 0,
		assists         INTEGER NOT NULL DEFAULT 0,
		perf_assists_avg_per_10min REAL    NOT NULL DEFAULT 0,
		deaths          INTEGER NOT NULL DEFAULT 0,
		perf_deaths_avg_per_10min  REAL    NOT NULL DEFAULT 0
	)`); err != nil {
		t.Fatalf("create legacy table: %v", err)
	}
	if _, err := raw.Exec(`INSERT INTO summary_screenshots
		(filename, match_key, map, hero, result, date, finished_at)
		VALUES ('Screenshot 2026-06-07 224903.png', 'match-2026-06-07T22-49-03',
		        'ilios', 'lucio', 'victory', '2026-06-07', '22:49')`); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	// The legacy rank_screenshots shape is nullable too (rank, result) —
	// same crash on the next load path, so the healer must cover it.
	if _, err := raw.Exec(`CREATE TABLE rank_screenshots (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		filename      TEXT NOT NULL UNIQUE,
		match_key     TEXT NOT NULL,
		parsed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		screenshots_dir_id INTEGER NOT NULL DEFAULT 1,
		rank          TEXT,
		level         INTEGER NOT NULL DEFAULT 0,
		-- Nullable per the current schema: a stale NOT NULL here is a separate,
		-- unhealable shape that ensureNoStaleNotNull refuses at open.
		rank_progress INTEGER,
		change_percent INTEGER,
		result        TEXT
	)`); err != nil {
		t.Fatalf("create legacy rank table: %v", err)
	}
	if _, err := raw.Exec(`INSERT INTO rank_screenshots (filename, match_key)
		VALUES ('Screenshot 2026-06-08 101502.png', 'match-2026-06-08T10-15-02')`); err != nil {
		t.Fatalf("insert legacy rank row: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw: %v", err)
	}
}
