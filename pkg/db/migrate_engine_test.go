package db_test

import (
	"database/sql"
	"strings"
	"testing"
	"testing/fstest"

	"recall/pkg/db"
)

// The migration framework ships inert pre-1.0 (no `.up.sql` / `.down.sql`
// pairs), so nothing in the repository exercises its pairing, ordering, or
// rollback rules. These tests drive the FS seam with synthetic pairs, which
// is the only chance to find a framework bug BEFORE a real schema change
// depends on it — at that point a wrong rollback costs a user's history.

// migrationFS builds a synthetic `migrations/` directory. Keys are bare file
// names; a key containing "/" lands in a subdirectory.
func migrationFS(files map[string]string) fstest.MapFS {
	out := fstest.MapFS{}
	for name, body := range files {
		out["migrations/"+name] = &fstest.MapFile{Data: []byte(body)}
	}
	return out
}

// tableExists reports whether the DB carries a table of that name.
func tableExists(t *testing.T, d *sql.DB, name string) bool {
	t.Helper()
	var n int
	if err := d.QueryRow(
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, name,
	).Scan(&n); err != nil {
		t.Fatalf("probe table %s: %v", name, err)
	}
	return n > 0
}

// scalarInt runs a single-value query, failing the test on any error.
func scalarInt(t *testing.T, d *sql.DB, query string) int {
	t.Helper()
	var n int
	if err := d.QueryRow(query).Scan(&n); err != nil {
		t.Fatalf("query %q: %v", query, err)
	}
	return n
}

// Versions are the leading INTEGER, applied in ascending numeric order — NOT
// the lexical order `fs.ReadDir` hands back. Unpadded names make the two
// disagree (lexically "10_ten" sorts before "2_two"), and the pairs are folded
// through a map first, so without the explicit sort the order is random.
func TestLoadMigrationsFrom_OrdersByNumericVersionNotFilename(t *testing.T) {
	migs, err := db.LoadMigrationsFrom(migrationFS(map[string]string{
		"10_ten.up.sql": "SELECT 10", "10_ten.down.sql": "SELECT -10",
		"2_two.up.sql": "SELECT 2", "2_two.down.sql": "SELECT -2",
		"0001_one.up.sql": "SELECT 1", "0001_one.down.sql": "SELECT -1",
	}))
	if err != nil {
		t.Fatalf("LoadMigrationsFrom: %v", err)
	}
	got := make([]int, 0, len(migs))
	for _, m := range migs {
		got = append(got, m.Version)
	}
	if len(got) != 3 || got[0] != 1 || got[1] != 2 || got[2] != 10 {
		t.Fatalf("versions = %v, want [1 2 10] (ascending numeric)", got)
	}
	if migs[2].Up != "SELECT 10" || migs[2].Down != "SELECT -10" {
		t.Errorf("bodies folded onto the wrong pair: %+v", migs[2])
	}
}

// Every `.up.sql` requires a paired `.down.sql` (and vice-versa), and the
// version prefix must parse — a half-shipped or mis-named pair must fail at
// load, not halfway through an apply.
func TestLoadMigrationsFrom_RejectsMalformedPairs(t *testing.T) {
	cases := []struct {
		name    string
		files   map[string]string
		wantErr string
	}{
		{"missing down", map[string]string{"0001_init.up.sql": "SELECT 1"}, "migration 0001_init: missing .down.sql"},
		{"missing up", map[string]string{"0001_init.down.sql": "SELECT 1"}, "migration 0001_init: missing .up.sql"},
		{"no version prefix", map[string]string{"init.up.sql": "SELECT 1"}, `parse "init.up.sql": missing version prefix`},
		{"non-numeric version", map[string]string{"v1_init.up.sql": "SELECT 1"}, `parse "v1_init.up.sql": non-numeric version`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := db.LoadMigrationsFrom(migrationFS(c.files))
			if err == nil {
				t.Fatalf("want error %q, got nil", c.wantErr)
			}
			if !strings.Contains(err.Error(), c.wantErr) {
				t.Errorf("error = %q, want it to contain %q", err, c.wantErr)
			}
		})
	}
}

// The shipped `migrations/` directory holds a README.md and nothing else, so
// "anything that isn't an `NNNN_<name>.{up,down}.sql` file is skipped" is a
// live rule, not a hypothetical: a phantom migration parsed out of the README
// would fail every store open. Subdirectories are skipped too — a draft
// parked in one must not apply itself.
func TestLoadMigrationsFrom_SkipsNonPairEntries(t *testing.T) {
	migs, err := db.LoadMigrationsFrom(migrationFS(map[string]string{
		"README.md":                "How to add a migration.",
		".gitkeep":                 "",
		"0001_init.sql":            "SELECT 'not a direction-suffixed pair'",
		"drafts/0002_draft.up.sql": "SELECT 2",
		"0003_real.up.sql":         "SELECT 3",
		"0003_real.down.sql":       "SELECT -3",
	}))
	if err != nil {
		t.Fatalf("LoadMigrationsFrom: %v", err)
	}
	if len(migs) != 1 || migs[0].Version != 3 {
		t.Fatalf("migrations = %+v, want only version 3", migs)
	}
}

// A missing `migrations/` directory is an error, not an empty set. The
// directory reaches the runner through a `//go:embed` directive, and a broken
// one would otherwise degrade into "zero migrations to apply" — every store
// opening happily against a schema nobody migrated.
func TestLoadMigrationsFrom_MissingDirectoryIsAnError(t *testing.T) {
	_, err := db.LoadMigrationsFrom(fstest.MapFS{"schema.sql": &fstest.MapFile{}})
	if err == nil {
		t.Fatal("an FS with no migrations directory loaded cleanly, want an error")
	}
	if !strings.Contains(err.Error(), "read migrations dir") {
		t.Errorf("error = %q, want it to name the unreadable directory", err)
	}
}

// The whole set is parsed and validated before any of it runs, so a
// half-shipped pair aborts the run instead of applying the migrations that
// happened to sort ahead of it. Anything else leaves the database at a version
// the migration files no longer describe.
func TestApplyMigrationsFrom_MalformedSetAppliesNothing(t *testing.T) {
	d := openMem(t)
	err := db.ApplyMigrationsFrom(d, migrationFS(map[string]string{
		"0001_create.up.sql":      `CREATE TABLE widgets (id INTEGER PRIMARY KEY)`,
		"0001_create.down.sql":    `DROP TABLE widgets`,
		"0002_halfshipped.up.sql": `CREATE TABLE gadgets (id INTEGER PRIMARY KEY)`,
	}))
	if err == nil {
		t.Fatal("a set with an unpaired migration applied cleanly, want an error")
	}
	if tableExists(t, d, "widgets") {
		t.Error("the well-formed migration ran despite the set failing validation")
	}
	if tableExists(t, d, "schema_version") {
		t.Error("schema_version was created before the set validated")
	}
}

// The runner applies pending migrations in ascending order and then skips
// them forever. 0002 inserts into the table 0001 creates, so a wrong order
// fails outright; the second run has real teeth too — a broken
// already-applied guard would re-INSERT the schema_version primary key and
// re-run the seed.
func TestApplyMigrationsFrom_AppliesPendingInOrderThenSkipsThem(t *testing.T) {
	d := openMem(t)
	fsys := migrationFS(map[string]string{
		"0001_create.up.sql":   `CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT)`,
		"0001_create.down.sql": `DROP TABLE widgets`,
		"0002_seed.up.sql":     `INSERT INTO widgets (id, label) VALUES (1, 'seeded')`,
		"0002_seed.down.sql":   `DELETE FROM widgets WHERE id = 1`,
	})
	mustNoErr(t, db.ApplyMigrationsFrom(d, fsys))
	if got := scalarInt(t, d, `SELECT count(*) FROM widgets`); got != 1 {
		t.Fatalf("widgets rows after first run = %d, want 1", got)
	}

	mustNoErr(t, db.ApplyMigrationsFrom(d, fsys))

	if got := scalarInt(t, d, `SELECT count(*) FROM widgets`); got != 1 {
		t.Errorf("widgets rows after re-run = %d, want 1 (0002 must not re-apply)", got)
	}
	if got := scalarInt(t, d, `SELECT count(*) FROM schema_version`); got != 2 {
		t.Errorf("schema_version rows = %d, want 2", got)
	}
	v, err := db.SchemaVersion(d)
	if err != nil || v != 2 {
		t.Errorf("SchemaVersion = (%d, %v), want (2, nil)", v, err)
	}
}

// Each migration runs in its own transaction: a statement that fails partway
// through must leave NOTHING behind — not the tables its earlier statements
// created, and not a schema_version row claiming it landed. A recorded
// version for a rolled-back migration is the worst outcome, because the next
// run skips it and the schema silently diverges forever.
func TestApplyMigrationsFrom_FailedStatementRollsBackTheWholeMigration(t *testing.T) {
	d := openMem(t)
	err := db.ApplyMigrationsFrom(d, migrationFS(map[string]string{
		"0001_ok.up.sql":    `CREATE TABLE kept (id INTEGER PRIMARY KEY)`,
		"0001_ok.down.sql":  `DROP TABLE kept`,
		"0002_bad.up.sql":   "CREATE TABLE doomed (id INTEGER PRIMARY KEY)\n-- statement-end\nTHIS IS NOT SQL",
		"0002_bad.down.sql": `DROP TABLE doomed`,
	}))
	if err == nil {
		t.Fatal("want an error from the malformed statement, got nil")
	}
	for _, want := range []string{"apply migration 0002_bad", "THIS IS NOT SQL"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error = %q, want it to name %q", err, want)
		}
	}
	if !tableExists(t, d, "kept") {
		t.Error("the committed 0001 migration was rolled back too")
	}
	if tableExists(t, d, "doomed") {
		t.Error("0002's first statement survived its own migration's failure")
	}
	if got := scalarInt(t, d, `SELECT count(*) FROM schema_version`); got != 1 {
		t.Errorf("schema_version rows = %d, want 1 (0002 must not be recorded)", got)
	}
}

// MAX(version) over an empty schema_version is NULL, not 0 — the NullInt64
// hop is what keeps a freshly-created table from erroring the version probe.
// ensureSchemaVersionTable is idempotent (every store open calls it).
func TestSchemaVersion_EmptyTableReportsZero(t *testing.T) {
	d := openMem(t)
	mustNoErr(t, db.EnsureSchemaVersionTable(d))
	mustNoErr(t, db.EnsureSchemaVersionTable(d))
	v, err := db.SchemaVersion(d)
	if err != nil {
		t.Fatalf("SchemaVersion: %v", err)
	}
	if v != 0 {
		t.Errorf("SchemaVersion over an empty table = %d, want 0", v)
	}
}

// A version may be recorded exactly once. The up body is IF NOT EXISTS, so
// the second apply gets all the way to the version INSERT — the primary key
// is the only thing standing between a re-run and a duplicated history.
func TestApplyOne_RejectsAReplayedVersion(t *testing.T) {
	d := openMem(t)
	mustNoErr(t, db.EnsureSchemaVersionTable(d))
	m := db.NewMigration(9001, "replayed",
		`CREATE TABLE IF NOT EXISTS replayed (id INTEGER PRIMARY KEY)`,
		`DROP TABLE replayed`)
	mustNoErr(t, db.ApplyOne(d, m))

	err := db.ApplyOne(d, m)
	if err == nil {
		t.Fatal("re-applying version 9001 succeeded; want a duplicate-version error")
	}
	if !strings.Contains(err.Error(), "record version") {
		t.Errorf("error = %q, want it to name the version INSERT", err)
	}
	if got := scalarInt(t, d, `SELECT count(*) FROM schema_version WHERE version = 9001`); got != 1 {
		t.Errorf("schema_version rows for 9001 = %d, want 1", got)
	}
}

// The rollback path is transactional too: a `.down.sql` that fails partway
// must leave the migration fully applied — the DROP its first statement ran
// is undone and the version row stays — rather than stranding the schema
// between two versions with no record of which one it is.
func TestRevertOne_FailedDownStatementLeavesTheMigrationApplied(t *testing.T) {
	d := openMem(t)
	mustNoErr(t, db.EnsureSchemaVersionTable(d))
	m := db.NewMigration(9002, "half_down",
		`CREATE TABLE half_down (id INTEGER PRIMARY KEY)`,
		"DROP TABLE half_down\n-- statement-end\nNOT VALID SQL")
	mustNoErr(t, db.ApplyOne(d, m))

	err := db.RevertOne(d, m)
	if err == nil {
		t.Fatal("want an error from the malformed down statement, got nil")
	}
	if !strings.Contains(err.Error(), "NOT VALID SQL") {
		t.Errorf("error = %q, want it to name the offending statement", err)
	}
	if !tableExists(t, d, "half_down") {
		t.Error("the DROP survived a failed revert; the down migration is not transactional")
	}
	if got := scalarInt(t, d, `SELECT count(*) FROM schema_version WHERE version = 9002`); got != 1 {
		t.Errorf("schema_version rows for 9002 = %d, want 1 (revert failed, version stands)", got)
	}
}
