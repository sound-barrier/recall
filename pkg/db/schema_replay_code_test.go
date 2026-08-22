package db_test

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"

	"recall/pkg/db"
)

// annotationsTable is the shape the pass runs against. Deliberately spelled
// out rather than taken from schema.sql: this test is about what happens to
// rows written by an OLDER build, and pinning the old shape is the point.
func annotationsFixture(t *testing.T, rows [][2]string) *sql.DB {
	t.Helper()
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if _, err := d.Exec(`CREATE TABLE match_annotations (
		match_key TEXT PRIMARY KEY, note TEXT, replay_code TEXT, annotated_at TEXT)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	for _, r := range rows {
		if _, err := d.Exec(`INSERT INTO match_annotations (match_key, replay_code) VALUES (?, ?)`,
			r[0], r[1]); err != nil {
			t.Fatalf("seed %q: %v", r[0], err)
		}
	}
	return d
}

func codeOf(t *testing.T, d *sql.DB, key string) string {
	t.Helper()
	var code *string
	if err := d.QueryRow(`SELECT replay_code FROM match_annotations WHERE match_key = ?`, key).
		Scan(&code); err != nil {
		t.Fatalf("read %q: %v", key, err)
	}
	if code == nil {
		return ""
	}
	return *code
}

// A code typed in lowercase before the format was pinned still names the same
// Overwatch match, so it is re-cased rather than thrown away.
func TestNormalizeReplayCodes_RecasesLegacyRows(t *testing.T) {
	d := annotationsFixture(t, [][2]string{
		{"match-2026-08-01T10-00-00", "  a1b2c3 "},
		{"match-2026-08-02T10-00-00", "D4E5F6"},
	})
	if err := db.NormalizeReplayCodes(d); err != nil {
		t.Fatalf("NormalizeReplayCodes: %v", err)
	}
	if got := codeOf(t, d, "match-2026-08-01T10-00-00"); got != "A1B2C3" {
		t.Errorf("legacy code = %q, want A1B2C3", got)
	}
	if got := codeOf(t, d, "match-2026-08-02T10-00-00"); got != "D4E5F6" {
		t.Errorf("already-canonical code = %q, want D4E5F6", got)
	}
}

// A code that is the wrong LENGTH cannot be repaired by re-casing, and
// deleting it would destroy something the user typed to satisfy a rule that
// only bites when a key is minted. It keeps rendering and keeps being
// searchable, exactly as it does today.
func TestNormalizeReplayCodes_LeavesUnrepairableCodesAlone(t *testing.T) {
	d := annotationsFixture(t, [][2]string{
		{"match-2026-08-01T10-00-00", "ABC"},
		{"match-2026-08-02T10-00-00", "a-longer-legacy-string"},
	})
	if err := db.NormalizeReplayCodes(d); err != nil {
		t.Fatalf("NormalizeReplayCodes: %v", err)
	}
	if got := codeOf(t, d, "match-2026-08-01T10-00-00"); got != "ABC" {
		t.Errorf("short code = %q, want it untouched", got)
	}
	if got := codeOf(t, d, "match-2026-08-02T10-00-00"); got != "a-longer-legacy-string" {
		t.Errorf("long code = %q, want it untouched", got)
	}
}

// A replay code names exactly one Overwatch match, so two matches carrying
// one code is an error in the data. The unique index cannot be created while
// it stands, and an index that fails to create means the app will not open —
// so the pass breaks the tie first. The earliest match keeps the code.
func TestNormalizeReplayCodes_BreaksTiesEarliestKeeps(t *testing.T) {
	d := annotationsFixture(t, [][2]string{
		{"match-2026-08-03T10-00-00", "a1b2c3"},
		{"match-2026-08-01T10-00-00", "A1B2C3"},
		{"match-2026-08-02T10-00-00", "A1B2C3"},
	})
	if err := db.NormalizeReplayCodes(d); err != nil {
		t.Fatalf("NormalizeReplayCodes: %v", err)
	}
	if got := codeOf(t, d, "match-2026-08-01T10-00-00"); got != "A1B2C3" {
		t.Errorf("earliest match = %q, want it to keep A1B2C3", got)
	}
	for _, later := range []string{"match-2026-08-02T10-00-00", "match-2026-08-03T10-00-00"} {
		if got := codeOf(t, d, later); got != "" {
			t.Errorf("later match %s = %q, want the duplicate cleared", later, got)
		}
	}
}

// The whole point of breaking ties: the index has to survive being created on
// a database that already held duplicates, because a failure here is a
// desktop app that refuses to launch.
func TestNormalizeReplayCodes_CreatesUniqueIndexOverDirtyData(t *testing.T) {
	d := annotationsFixture(t, [][2]string{
		{"match-2026-08-01T10-00-00", "A1B2C3"},
		{"match-2026-08-02T10-00-00", "a1b2c3"},
	})
	if err := db.NormalizeReplayCodes(d); err != nil {
		t.Fatalf("NormalizeReplayCodes: %v", err)
	}
	_, err := d.Exec(`INSERT INTO match_annotations (match_key, replay_code)
		VALUES ('match-2026-09-09T10-00-00', 'A1B2C3')`)
	if err == nil {
		t.Fatal("a second row took the same replay code; the unique index is missing")
	}
}

// Several matches legitimately have NO code, and NULLs must not collide with
// each other under the index.
func TestNormalizeReplayCodes_ManyRowsMayHaveNoCode(t *testing.T) {
	d := annotationsFixture(t, [][2]string{
		{"match-2026-08-01T10-00-00", ""},
		{"match-2026-08-02T10-00-00", ""},
		{"match-2026-08-03T10-00-00", "A1B2C3"},
	})
	if err := db.NormalizeReplayCodes(d); err != nil {
		t.Fatalf("NormalizeReplayCodes: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO match_annotations (match_key, replay_code)
		VALUES ('match-2026-09-09T10-00-00', '')`); err != nil {
		t.Fatalf("a third code-less row was refused: %v", err)
	}
}

// Run at every store open, so the second run must change nothing and must not
// trip over the index it created the first time.
func TestNormalizeReplayCodes_Idempotent(t *testing.T) {
	d := annotationsFixture(t, [][2]string{
		{"match-2026-08-01T10-00-00", "a1b2c3"},
		{"match-2026-08-02T10-00-00", "A1B2C3"},
		{"match-2026-08-03T10-00-00", "ABC"},
	})
	if err := db.NormalizeReplayCodes(d); err != nil {
		t.Fatalf("first run: %v", err)
	}
	before := []string{
		codeOf(t, d, "match-2026-08-01T10-00-00"),
		codeOf(t, d, "match-2026-08-02T10-00-00"),
		codeOf(t, d, "match-2026-08-03T10-00-00"),
	}
	if err := db.NormalizeReplayCodes(d); err != nil {
		t.Fatalf("second run: %v", err)
	}
	after := []string{
		codeOf(t, d, "match-2026-08-01T10-00-00"),
		codeOf(t, d, "match-2026-08-02T10-00-00"),
		codeOf(t, d, "match-2026-08-03T10-00-00"),
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("row %d changed on the second run: %q → %q", i, before[i], after[i])
		}
	}
}

// The promise the whole pass exists to keep: a database written by an older
// build, holding two matches that claim one replay code, still OPENS. This is
// the integration half — the unit tests above drive the pass directly, and
// would all still pass if nobody had wired it into NewSQLStore.
func TestNewSQLStore_OpensOverDuplicateReplayCodes(t *testing.T) {
	path := t.TempDir() + "/legacy.db"

	// Write the dirty rows through a first open, the way an older build did.
	seed, err := db.NewSQLStore(path)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	raw := db.RawDB(seed)
	for _, r := range [][2]string{
		{"match-2026-08-02T10-00-00", "a1b2c3"},
		{"match-2026-08-01T10-00-00", "A1B2C3"},
	} {
		if _, err := raw.Exec(
			`INSERT OR REPLACE INTO match_annotations (match_key, replay_code) VALUES (?, ?)`,
			r[0], r[1]); err != nil {
			t.Fatalf("seed %q: %v", r[0], err)
		}
	}
	if err := seed.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	reopened, err := db.NewSQLStore(path)
	if err != nil {
		t.Fatalf("reopening a database with duplicate replay codes must not fail: %v", err)
	}
	defer func() { _ = reopened.Close() }()

	annotations, err := reopened.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations: %v", err)
	}
	if got := annotations["match-2026-08-01T10-00-00"].ReplayCode; got != "A1B2C3" {
		t.Errorf("earliest match kept %q, want A1B2C3", got)
	}
	if got := annotations["match-2026-08-02T10-00-00"].ReplayCode; got != "" {
		t.Errorf("later match kept %q, want the duplicate cleared", got)
	}
}
