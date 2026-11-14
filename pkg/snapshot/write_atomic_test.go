package snapshot_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"recall/pkg/snapshot"
)

// A snapshot is written under a temporary name and renamed into place only
// once it is whole. VACUUM INTO used to write straight onto the final name,
// so an interrupted write left a partial file that read as the newest
// backup: no new one was taken for a whole interval, and Prune counted it
// toward AutoKeep, evicting a good one.
func TestWrite_AnInterruptedWriteLeavesNothingThatCounts(t *testing.T) {
	backups := t.TempDir()
	prev := snapshot.BackupToFunc
	snapshot.BackupToFunc = func(_, dest string) error {
		if err := os.WriteFile(dest, []byte("half a datab"), 0o600); err != nil {
			return err
		}
		return errors.New("process killed mid-VACUUM")
	}
	t.Cleanup(func() { snapshot.BackupToFunc = prev })

	if _, err := snapshot.Write("/db/recall.db", backups, snapshot.AutoPrefix, 3); err == nil {
		t.Fatal("Write succeeded through a failed VACUUM")
	}

	if _, ok := snapshot.Latest(backups, snapshot.AutoPrefix); ok {
		t.Error("a partial write reads as the newest backup")
	}
	if got := basenamesIn(t, backups); len(got) != 0 {
		t.Errorf("a partial write left %v under a snapshot name", got)
	}
}

// A temporary left by a write the process never finished (a crash, a kill)
// is swept, and is never counted as a snapshot meanwhile.
func TestSweepPartials_RemovesALeftoverTemporary(t *testing.T) {
	backups := t.TempDir()
	leftover := filepath.Join(backups, ".auto-20260101-000000-123.partial")
	touch(t, backups, filepath.Base(leftover), "auto-20260102-000000.db")

	snapshot.SweepPartials(backups)

	if _, err := os.Stat(leftover); !os.IsNotExist(err) {
		t.Errorf("leftover temporary still there: %v", err)
	}
	if _, err := os.Stat(filepath.Join(backups, "auto-20260102-000000.db")); err != nil {
		t.Errorf("the sweep took a real snapshot: %v", err)
	}
}

// Two writes in one second name the same file. The second is a newer state of
// the database, so it replaces the first rather than being reported as
// written while the file still holds the older one.
func TestWrite_ASecondWriteInTheSameSecondHoldsTheNewerState(t *testing.T) {
	backups := t.TempDir()
	content := "first"
	prev := snapshot.BackupToFunc
	snapshot.BackupToFunc = func(_, dest string) error { return os.WriteFile(dest, []byte(content), 0o600) }
	t.Cleanup(func() { snapshot.BackupToFunc = prev })

	at := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	prevNow := *snapshot.Now
	*snapshot.Now = func() time.Time { return at }
	t.Cleanup(func() { *snapshot.Now = prevNow })

	first, err := snapshot.Write("/db/recall.db", backups, snapshot.AutoPrefix, 3)
	mustNoErr(t, err)
	content = "second"
	second, err := snapshot.Write("/db/recall.db", backups, snapshot.AutoPrefix, 3)
	mustNoErr(t, err)
	if first != second {
		t.Fatalf("two writes in one second named %q and %q, want one file", first, second)
	}
	got, err := os.ReadFile(second) // #nosec G304 -- a test temp dir
	mustNoErr(t, err)
	if string(got) != "second" {
		t.Errorf("the same-second snapshot holds %q, want the newer state", got)
	}
}

func mustNoErr(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
