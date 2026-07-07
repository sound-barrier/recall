package app_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"recall/pkg/app"
	"recall/pkg/parser"
)

// Re-parse All rewrites every row from OCR, so it takes a silent
// VACUUM INTO safety snapshot BEFORE the run (keep the newest 2).
// Normal parses never snapshot, and a snapshot failure must not block
// the re-parse — it's belt-and-braces, not a gate.

func stubBackup(t *testing.T, log *[]string, fail bool) {
	t.Helper()
	prev := *app.BackupToFunc
	*app.BackupToFunc = func(src, dest string) error {
		*log = append(*log, "backup:"+dest)
		if fail {
			return os.ErrPermission
		}
		// Mimic VACUUM INTO: the destination file exists afterwards, so
		// due-ness checks that glob the backups dir see it.
		return os.WriteFile(dest, []byte("snapshot"), 0o600)
	}
	t.Cleanup(func() { *app.BackupToFunc = prev })
}

// preReparseEntries filters the recorder log down to pre-reparse
// snapshots — the auto-backup scheduler may legitimately add its own
// entry at the end of any run.
func preReparseEntries(log []string) []string {
	var out []string
	for _, l := range log {
		if strings.Contains(l, "pre-reparse-") {
			out = append(out, l)
		}
	}
	return out
}

func TestReParseAll_TakesSafetySnapshotBeforeTheRun(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a, _ := newParseReadyApp(t)
	var log []string
	stubBackup(t, &log, false)
	stubParse(t, func(progress parser.ProgressFunc) error {
		log = append(log, "parse")
		return nil
	})
	if err := a.ReParseAll(); err != nil {
		t.Fatalf("ReParseAll: %v", err)
	}
	pre := preReparseEntries(log)
	if len(pre) != 1 || len(log) < 2 || log[0] != pre[0] || log[1] != "parse" {
		t.Fatalf("expected exactly one pre-reparse snapshot BEFORE the parse, got %v", log)
	}
	dest := strings.TrimPrefix(pre[0], "backup:")
	if filepath.Base(filepath.Dir(dest)) != "backups" {
		t.Errorf("snapshot dest %q should live in backups/", dest)
	}
}

func TestParseScreenshots_NormalRunTakesNoPreReparseSnapshot(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a, _ := newParseReadyApp(t)
	var log []string
	stubBackup(t, &log, false)
	stubParse(t, func(progress parser.ProgressFunc) error { return nil })
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if pre := preReparseEntries(log); len(pre) != 0 {
		t.Errorf("normal parse must not take a pre-reparse snapshot, got %v", pre)
	}
}

func TestReParseAll_SnapshotFailureDoesNotBlockTheRun(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a, _ := newParseReadyApp(t)
	var log []string
	stubBackup(t, &log, true)
	ran := false
	stubParse(t, func(progress parser.ProgressFunc) error { ran = true; return nil })
	if err := a.ReParseAll(); err != nil {
		t.Fatalf("ReParseAll must survive a snapshot failure: %v", err)
	}
	if !ran {
		t.Error("the re-parse must still run after a failed snapshot")
	}
}

func TestPruneSnapshots_KeepsNewestN(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{
		"pre-reparse-20260701-100000.db",
		"pre-reparse-20260702-100000.db",
		"pre-reparse-20260703-100000.db",
		"auto-20260630-090000.db", // different prefix — untouched
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	app.PruneSnapshots(dir, "pre-reparse-", 2)
	left, _ := filepath.Glob(filepath.Join(dir, "*.db"))
	var names []string
	for _, f := range left {
		names = append(names, filepath.Base(f))
	}
	want := map[string]bool{
		"pre-reparse-20260702-100000.db": true,
		"pre-reparse-20260703-100000.db": true,
		"auto-20260630-090000.db":        true,
	}
	if len(names) != 3 {
		t.Fatalf("expected 3 files left, got %v", names)
	}
	for _, n := range names {
		if !want[n] {
			t.Errorf("unexpected survivor %q", n)
		}
	}
}

// ── Auto-backup scheduler ─────────────────────────────────────────

func TestAutoBackupStatus_DefaultsOnAndStaleWithoutSnapshots(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a, _ := newParseReadyApp(t)
	st := a.GetAutoBackupStatus()
	if st.IntervalDays != 7 {
		t.Errorf("unset interval must default to 7, got %d", st.IntervalDays)
	}
	if !st.Stale || st.LastBackupAt != "" {
		t.Errorf("no snapshots yet must read stale with no timestamp: %+v", st)
	}
}

func TestAutoBackupStatus_ReadsNewestSnapshotAndFreshness(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("RECALL_DATA_DIR", dir)
	a, _ := newParseReadyApp(t)
	backups := filepath.Join(dir, "backups")
	if err := os.MkdirAll(backups, 0o750); err != nil {
		t.Fatal(err)
	}
	freshTime := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	fresh := freshTime.Format("20060102-150405")
	for _, name := range []string{"auto-20260101-000000.db", "auto-" + fresh + ".db"} {
		if err := os.WriteFile(filepath.Join(backups, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	st := a.GetAutoBackupStatus()
	if st.Stale {
		t.Errorf("a 2h-old weekly snapshot is not stale: %+v", st)
	}
	if st.LastBackupAt != freshTime.Format(time.RFC3339) {
		t.Errorf("LastBackupAt = %q, want the NEWEST snapshot %q", st.LastBackupAt, freshTime.Format(time.RFC3339))
	}
}

func TestSetAutoBackupInterval_Validates(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a, _ := newParseReadyApp(t)
	for _, bad := range []int{0, -2, 366} {
		if err := a.SetAutoBackupInterval(bad); err == nil {
			t.Errorf("interval %d must be rejected", bad)
		}
	}
	if err := a.SetAutoBackupInterval(-1); err != nil {
		t.Errorf("-1 (off) must be accepted: %v", err)
	}
	if err := a.SetAutoBackupInterval(30); err != nil {
		t.Errorf("30 days must be accepted: %v", err)
	}
	if got := a.GetAutoBackupStatus().IntervalDays; got != 30 {
		t.Errorf("interval after set = %d, want 30", got)
	}
}

func TestMaybeAutoBackup_WritesWhenDue_SkipsWhenFreshOrOff(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("RECALL_DATA_DIR", dir)
	a, _ := newParseReadyApp(t)
	var log []string
	stubBackup(t, &log, false)

	app.MaybeAutoBackup(a) // due: nothing exists yet
	if len(log) != 1 || !strings.Contains(log[0], "auto-") {
		t.Fatalf("expected one auto snapshot, got %v", log)
	}

	app.MaybeAutoBackup(a) // fresh now — must skip
	if len(log) != 1 {
		t.Errorf("fresh snapshot must not re-back up, got %v", log)
	}

	if err := a.SetAutoBackupInterval(-1); err != nil {
		t.Fatal(err)
	}
	_ = os.RemoveAll(filepath.Join(dir, "backups"))
	app.MaybeAutoBackup(a) // off — must skip even though due
	if len(log) != 1 {
		t.Errorf("disabled scheduler must never back up, got %v", log)
	}
}
