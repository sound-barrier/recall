package app_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

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
		return nil
	}
	t.Cleanup(func() { *app.BackupToFunc = prev })
}

func TestReParseAll_TakesSafetySnapshotBeforeTheRun(t *testing.T) {
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
	if len(log) != 2 || !strings.HasPrefix(log[0], "backup:") || log[1] != "parse" {
		t.Fatalf("expected snapshot BEFORE the parse, got %v", log)
	}
	dest := strings.TrimPrefix(log[0], "backup:")
	if !strings.Contains(dest, "pre-reparse-") || filepath.Base(filepath.Dir(dest)) != "backups" {
		t.Errorf("snapshot dest %q should be backups/pre-reparse-<ts>.db", dest)
	}
}

func TestParseScreenshots_NormalRunNeverSnapshots(t *testing.T) {
	a, _ := newParseReadyApp(t)
	var log []string
	stubBackup(t, &log, false)
	stubParse(t, func(progress parser.ProgressFunc) error { return nil })
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if len(log) != 0 {
		t.Errorf("normal parse must not snapshot, got %v", log)
	}
}

func TestReParseAll_SnapshotFailureDoesNotBlockTheRun(t *testing.T) {
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
