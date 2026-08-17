package db_test

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/db"
)

// Every test in this package builds its schema fresh, which is exactly how the
// modifier vocabulary drifted for two releases without anything failing: the
// bug only exists on a database that ALREADY EXISTS.
//
// schema.sql is applied with CREATE TABLE IF NOT EXISTS, so re-opening an
// upgraded install is a no-op — SQLite cannot widen a CHECK constraint that
// way, additiveColumns handles nullable columns only, and migrate.go is inert
// pre-1.0. A user who installed months ago therefore still carries whatever
// vocabulary shipped then, forever.
//
// That is not a stale-annotation problem. UpsertRank writes the parent, its
// modifiers and its SR lines in ONE transaction and the child error rolls the
// parent back, so a single unrecognized chip discarded the whole rank row —
// tier, division, progress, SR, percentile — and pkg/app had already cleared
// the file from the failed-files ledger by then, so it surfaced nowhere at all.
//
// A modifier is an annotation. A rank row is the measurement. Losing the
// measurement to protect the annotation is the wrong trade at any severity,
// which is why the row now survives a modifier the local schema will not take.
func openLegacyStore(t *testing.T, checkList string) *db.SQLStore {
	t.Helper()
	path := filepath.Join(t.TempDir(), "legacy.db")

	d, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	// Just the two tables the constraint lives on, with a DELIBERATELY STALE
	// vocabulary — standing in for an install from before the chip existed.
	if _, err := d.Exec(`CREATE TABLE rank_screenshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filename TEXT UNIQUE NOT NULL,
		match_key TEXT NOT NULL,
		parsed_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
		screenshots_dir_id INTEGER,
		rank TEXT NOT NULL DEFAULT '',
		level INTEGER NOT NULL DEFAULT 0,
		-- NULLABLE deliberately: this helper exercises a stale MODIFIER
		-- vocabulary, and a stale NOT NULL on these two is a different failure
		-- that ensureNoStaleNotNull refuses outright (see the test below). Do
		-- not "restore" the NOT NULL here — NewSQLStore would reject the fixture
		-- before any modifier was ever inserted.
		rank_progress INTEGER,
		change_percent INTEGER,
		result TEXT NOT NULL DEFAULT ''
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`CREATE TABLE rank_modifiers (
		rank_screenshot_id INTEGER NOT NULL REFERENCES rank_screenshots (id) ON DELETE CASCADE,
		modifier TEXT NOT NULL CHECK (modifier IN (` + checkList + `)),
		PRIMARY KEY (rank_screenshot_id, modifier)
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`CREATE TABLE rank_sr (
		rank_screenshot_id INTEGER NOT NULL REFERENCES rank_screenshots (id) ON DELETE CASCADE,
		hero TEXT NOT NULL, sr INTEGER NOT NULL DEFAULT 0, change INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (rank_screenshot_id, hero)
	)`); err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}

	s, err := db.NewSQLStore(path)
	if err != nil {
		t.Fatalf("NewSQLStore on a pre-existing database: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestUpsertRank_SurvivesAModifierTheLocalSchemaRejects(t *testing.T) {
	// The vocabulary as it shipped in v0.23.0 — no trend chips, no variance.
	s := openLegacyStore(t, `'expected', 'uphill battle', 'reversal', 'consolation',
		'win streak', 'loss streak', 'calibration', 'volatile',
		'new map', 'leaver compensation', 'victory', 'defeat', 'draw',
		'demotion protection'`)

	if err := s.UpsertRank(db.RankRow{
		Filename: "r.png", MatchKey: "k1", Rank: "platinum", Level: 2,
		RankProgress: new(67), Result: "defeat",
		// 'variance' rides every post-placement season-4 rank screen, so on an
		// upgraded install this is not an edge case — it is every one of them.
		Modifiers: []string{"reversal", "variance", "defeat"},
		SR:        []db.HeroSR{{Hero: "juno", SR: 2065, Change: -18}},
	}); err != nil {
		t.Fatalf("UpsertRank = %v — an old CHECK must cost the PILL, never the row", err)
	}

	got := loadOneRank(t, s)
	if got.Rank != "platinum" || got.Level != 2 || *got.RankProgress != 67 {
		t.Errorf("rank = %q %d @%d%%, want platinum 2 @67%% — the measurement was lost",
			got.Rank, got.Level, got.RankProgress)
	}
	if len(got.SR) != 1 || got.SR[0].SR != 2065 {
		t.Errorf("sr = %+v, want juno at 2065 — the SR line went with the row", got.SR)
	}
	// The two the old schema accepts are stored; the one it will not take is
	// dropped rather than taking everything else with it.
	if len(got.Modifiers) != 2 {
		t.Errorf("modifiers = %v, want the two this schema accepts", got.Modifiers)
	}
	for _, m := range got.Modifiers {
		if m == "variance" {
			t.Errorf("modifiers = %v — this schema cannot store 'variance'", got.Modifiers)
		}
	}
}

// The row must still survive when the schema takes NONE of its modifiers.
func TestUpsertRank_SurvivesWhenEveryModifierIsRejected(t *testing.T) {
	s := openLegacyStore(t, `'expected'`)

	if err := s.UpsertRank(db.RankRow{
		Filename: "r.png", MatchKey: "k1", Rank: "diamond", Level: 5,
		Modifiers: []string{"variance", "winning trend"},
	}); err != nil {
		t.Fatalf("UpsertRank = %v, want the row stored with no modifiers", err)
	}
	got := loadOneRank(t, s)
	if got.Rank != "diamond" || got.Level != 5 {
		t.Errorf("rank = %q %d, want diamond 5", got.Rank, got.Level)
	}
	if len(got.Modifiers) != 0 {
		t.Errorf("modifiers = %v, want none", got.Modifiers)
	}
}

// A real failure must still fail. Swallowing modifier errors is a targeted
// trade — the row outranks the annotation — not a general "ignore write
// errors" rule, so a rejected SR line still takes the transaction down.
func TestUpsertRank_StillFailsOnARejectedSRLine(t *testing.T) {
	s := openLegacyStore(t, `'expected'`)

	err := s.UpsertRank(db.RankRow{
		Filename: "r.png", MatchKey: "k1", Rank: "platinum", Level: 2,
		SR: []db.HeroSR{
			{Hero: "juno", SR: 2500},
			{Hero: "juno", SR: 2521}, // duplicate hero — composite PK violation
		},
	})
	if err == nil {
		t.Fatal("a duplicate SR hero was accepted; only MODIFIER rejections are tolerated")
	}
	snap, lerr := s.LoadAll()
	mustNoErr(t, lerr)
	if len(snap.Ranks) != 0 {
		t.Errorf("rank rows = %d, want 0 — a genuine child failure still rolls back", len(snap.Ranks))
	}
}

// The other half of the same lesson. A column that GAINS nullability cannot be
// altered in place by SQLite, so an install predating the change keeps NOT NULL
// forever — and because UpsertRank writes the parent and its children in one
// transaction, a rejected NULL rolls the entire rank row back. Half the rank
// captures in the corpus read no movement pill, so on an upgraded install that
// is most of them, discarded silently while the app still looks healthy.
//
// The store therefore refuses to open at all, which routes to the startup
// failure modal instead of to rows nobody can account for.
func TestNewSQLStore_RefusesADatabaseWithAStaleNotNull(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stale.db")

	d, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	// The shape as it stood before the movement/progress columns went nullable.
	// parsed_at and screenshots_dir_id are carried because applySchema still
	// runs first and its index references parsed_at — without them the open
	// fails on the INDEX before ever reaching the nullability check.
	if _, err := d.Exec(`CREATE TABLE rank_screenshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filename TEXT UNIQUE NOT NULL,
		match_key TEXT NOT NULL,
		parsed_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
		screenshots_dir_id INTEGER,
		rank TEXT NOT NULL DEFAULT '',
		level INTEGER NOT NULL DEFAULT 0,
		rank_progress INTEGER NOT NULL DEFAULT 0,
		change_percent INTEGER NOT NULL DEFAULT 0,
		result TEXT NOT NULL DEFAULT ''
	)`); err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}

	s, err := db.NewSQLStore(path)
	if err == nil {
		_ = s.Close()
		t.Fatal("NewSQLStore accepted a database whose rank columns are still NOT NULL; " +
			"every unread movement would silently discard its rank row")
	}
	// The message has to be actionable — the user can only fix this by clearing
	// and re-parsing, so it must say that rather than naming a constraint.
	for _, want := range []string{"rank_progress", "Re-parse All"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not mention %q", err, want)
		}
	}
}

// The restore path is where a stale column shape does REAL damage, and it is
// the flow the startup refusal's own advice invites: back up, clear, then
// restore the backup to get the history back.
//
// RestoreDatabase renames the candidate over the live database and only THEN
// reopens. So a snapshot that passes validation but cannot be opened destroys
// the previous database and leaves the profile permanently unopenable —
// integrity_check says ok, the sentinel table is present, and VACUUM INTO
// preserves nullability, so nothing else in the chain would notice.
//
// Validation therefore has to reject it while the live file is still untouched.
func TestValidateBackupFile_RejectsAStaleNotNullShape(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old-backup.db")

	d, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	// A snapshot from before the movement/progress columns went nullable, with
	// the sentinel table present so the older checks all pass.
	for _, stmt := range []string{
		`CREATE TABLE summary_screenshots (id INTEGER PRIMARY KEY, filename TEXT)`,
		`CREATE TABLE rank_screenshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			filename TEXT UNIQUE NOT NULL,
			match_key TEXT NOT NULL,
			rank_progress INTEGER NOT NULL DEFAULT 0,
			change_percent INTEGER NOT NULL DEFAULT 0
		)`,
	} {
		if _, err := d.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}

	err = db.ValidateBackupFile(path)
	if err == nil {
		t.Fatal("ValidateBackupFile accepted a snapshot this build cannot open; " +
			"restoring it would destroy the live database and strand the profile")
	}
	if !errors.Is(err, db.ErrInvalidBackup) {
		t.Errorf("error %v does not wrap ErrInvalidBackup, so the handler cannot "+
			"map it to a 4xx and the user gets an opaque 500", err)
	}
	// The message has to survive to the user — clearing and re-parsing is the
	// only way forward, and they cannot guess it.
	if !strings.Contains(err.Error(), "Re-parse All") {
		t.Errorf("error %q does not tell the user what to do", err)
	}
}

// The control: a database this build CAN open must still validate, or the fix
// above would have made every legitimate restore fail.
func TestValidateBackupFile_AcceptsTheCurrentShape(t *testing.T) {
	path := filepath.Join(t.TempDir(), "current.db")
	s, err := db.NewSQLStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	if err := db.ValidateBackupFile(path); err != nil {
		t.Errorf("ValidateBackupFile rejected a database this build just created: %v", err)
	}
}
