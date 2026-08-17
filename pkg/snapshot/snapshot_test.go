package snapshot_test

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"recall/pkg/db"
	"recall/pkg/snapshot"
)

// captureLogs redirects slog.Default() for the duration of the test. Nothing
// in this package logs off a goroutine, so a plain buffer needs no lock.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	return buf
}

// touch creates each named file in dir with throwaway contents.
func touch(t *testing.T, dir string, names ...string) {
	t.Helper()
	for _, name := range names {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// basenamesIn lists dir's *.db files, sorted, for whole-directory assertions.
func basenamesIn(t *testing.T, dir string) []string {
	t.Helper()
	found, err := filepath.Glob(filepath.Join(dir, "*.db"))
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(found))
	for _, f := range found {
		names = append(names, filepath.Base(f))
	}
	slices.Sort(names)
	return names
}

// stubBackupTo swaps the VACUUM INTO seam for one that records its
// destinations and creates the file, so a prune has something to prune.
func stubBackupTo(t *testing.T, dests *[]string, fail error) {
	t.Helper()
	prev := snapshot.BackupToFunc
	snapshot.BackupToFunc = func(_, dest string) error {
		*dests = append(*dests, dest)
		if fail != nil {
			return fail
		}
		return os.WriteFile(dest, []byte("snapshot"), 0o600)
	}
	t.Cleanup(func() { snapshot.BackupToFunc = prev })
}

// newRecallDB writes a real, schema-complete Recall database and returns its
// path — the only thing that satisfies VACUUM INTO and the restore validator.
func newRecallDB(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "recall.db")
	store, err := db.NewSQLStore(path)
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return path
}

func TestPrune_KeepsNewestN(t *testing.T) {
	dir := t.TempDir()
	touch(t, dir,
		"pre-reparse-20260701-100000.db",
		"pre-reparse-20260702-100000.db",
		"pre-reparse-20260703-100000.db",
		"auto-20260630-090000.db", // different prefix — untouched
	)

	snapshot.Prune(dir, snapshot.ReparsePrefix, 2)

	want := []string{
		"auto-20260630-090000.db",
		"pre-reparse-20260702-100000.db",
		"pre-reparse-20260703-100000.db",
	}
	if got := basenamesIn(t, dir); !slices.Equal(got, want) {
		t.Errorf("survivors = %v, want %v", got, want)
	}
}

func TestPrune_KeepsEverythingAtOrUnderTheKeepCount(t *testing.T) {
	dir := t.TempDir()
	touch(t, dir, "auto-20260701-100000.db", "auto-20260702-100000.db")

	snapshot.Prune(dir, snapshot.AutoPrefix, 2)

	if got := basenamesIn(t, dir); len(got) != 2 {
		t.Errorf("survivors = %v, want both files — keep is a floor, not a target", got)
	}
}

// A Glob failure is not "nothing to prune". The two were folded into one
// `err != nil || len(matches) <= keep` return, so an unglobbable backups
// path — a single unmatched '[' anywhere in the data dir is enough —
// disabled pruning permanently and let backups/ grow without bound, with
// nothing anywhere saying why. Skipping the prune stays the safe arm; it
// just has to be a loud one. Reaching this needed a whole *App with a
// poisoned data dir until the carve; on a path argument it is one line.
func TestPrune_GlobFailureIsLoggedNotSwallowed(t *testing.T) {
	logs := captureLogs(t)

	// An unterminated '[' makes the joined pattern invalid, which is the
	// one reachable filepath.ErrBadPattern.
	snapshot.Prune(filepath.Join(t.TempDir(), "profile[1", "backups"), snapshot.AutoPrefix, 3)

	got := logs.String()
	if !strings.Contains(got, "level=ERROR") || !strings.Contains(got, filepath.ErrBadPattern.Error()) {
		t.Fatalf("a Glob failure must surface as a logged error; log was %q", got)
	}
}

func TestWrite_CreatesTheDirectoryStampsTheNameAndPrunes(t *testing.T) {
	backups := t.TempDir()
	var dests []string
	stubBackupTo(t, &dests, nil)
	touch(t, backups, "auto-20260101-000000.db", "auto-20260102-000000.db")

	dest, err := snapshot.Write("/db/recall.db", backups, snapshot.AutoPrefix, 1)
	if err != nil {
		t.Fatalf("Write: %v", err)
	}

	if len(dests) != 1 || dests[0] != dest {
		t.Fatalf("VACUUM INTO destinations = %v, want exactly the returned %q", dests, dest)
	}
	base := filepath.Base(dest)
	if !strings.HasPrefix(base, snapshot.AutoPrefix) || !strings.HasSuffix(base, ".db") {
		t.Errorf("snapshot name = %q, want <prefix><stamp>.db", base)
	}
	if got := len(base); got != len(snapshot.AutoPrefix)+len(snapshot.TimeLayout)+len(".db") {
		t.Errorf("snapshot name %q is %d chars, want a %s stamp", base, got, snapshot.TimeLayout)
	}
	if got := basenamesIn(t, backups); !slices.Equal(got, []string{base}) {
		t.Errorf("after a keep=1 write the directory holds %v, want only %q", got, base)
	}
}

func TestWrite_MakesTheBackupsDirectoryWhenItIsMissing(t *testing.T) {
	backups := filepath.Join(t.TempDir(), "nested", "backups")
	var dests []string
	stubBackupTo(t, &dests, nil)

	dest, err := snapshot.Write("/db/recall.db", backups, snapshot.ReparsePrefix, 2)
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if filepath.Dir(dest) != backups {
		t.Errorf("snapshot written to %q, want it inside %q", dest, backups)
	}
}

func TestWrite_ReportsAFailedVacuumAndWritesNothing(t *testing.T) {
	backups := t.TempDir()
	var dests []string
	stubBackupTo(t, &dests, os.ErrPermission)

	dest, err := snapshot.Write("/db/recall.db", backups, snapshot.AutoPrefix, 3)
	if err == nil {
		t.Fatalf("Write returned %q, want the VACUUM failure surfaced", dest)
	}
	if dest != "" {
		t.Errorf("failed Write returned path %q, want the empty string", dest)
	}
	if got := basenamesIn(t, backups); len(got) != 0 {
		t.Errorf("a failed Write left %v behind", got)
	}
}

func TestWrite_ReportsAnUnusableBackupsDirectory(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "backups")
	if err := os.WriteFile(blocker, []byte("i am a file"), 0o600); err != nil {
		t.Fatal(err)
	}
	var dests []string
	stubBackupTo(t, &dests, nil)

	if _, err := snapshot.Write("/db/recall.db", blocker, snapshot.AutoPrefix, 3); err == nil {
		t.Fatal("Write must fail when the backups path is not a directory")
	}
	if len(dests) != 0 {
		t.Errorf("VACUUM ran anyway: %v", dests)
	}
}

func TestRead_ReturnsSnapshotBytesAndLeavesNoTempFile(t *testing.T) {
	path := newRecallDB(t)

	data, err := snapshot.Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("Read produced no bytes")
	}
	if !bytes.HasPrefix(data, []byte("SQLite format 3\x00")) {
		t.Errorf("Read did not return a SQLite file; first bytes were %q", data[:min(16, len(data))])
	}

	leftovers, err := filepath.Glob(filepath.Join(filepath.Dir(path), "recall-backup-*.db"))
	if err != nil {
		t.Fatal(err)
	}
	if len(leftovers) != 0 {
		t.Errorf("Read left its scratch snapshot behind: %v", leftovers)
	}
}

func TestRead_ReportsAnUnwritableDatabaseDirectory(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-dir", "recall.db")

	if _, err := snapshot.Read(missing); err == nil {
		t.Fatal("Read must fail when it cannot stage a temp snapshot beside the DB")
	}
}
