package db_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/db"
)

// NewSQLStore's whole body re-runs on every launch against a database that
// already has history. These pin what the second open must NOT do.

// openFileStore opens a file-backed store and closes it at test end.
func openFileStore(t *testing.T, path string) *db.SQLStore {
	t.Helper()
	s, err := db.NewSQLStore(path)
	if err != nil {
		t.Fatalf("NewSQLStore(%s): %v", path, err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// seedTwoDirs writes a screenshot against one screenshots dir and an OCR
// failure against another, then returns both ids.
func seedTwoDirs(t *testing.T, s *db.SQLStore) (shots, failures int64) {
	t.Helper()
	shots, err := s.EnsureScreenshotsDir("/shots")
	if err != nil {
		t.Fatalf("EnsureScreenshotsDir: %v", err)
	}
	failures, err = s.EnsureScreenshotsDir("/failures")
	if err != nil {
		t.Fatalf("EnsureScreenshotsDir: %v", err)
	}
	mustNoErr(t, s.UpsertSummary(db.SummaryRow{
		Filename: "a.png", MatchKey: "match-2026-01-01T12-00-00",
		ScreenshotsDirID: shots, Map: "rialto",
	}))
	mustNoErr(t, s.RecordFailedFile("broken.png", failures, "tesseract exited 1"))
	return shots, failures
}

// Re-opening an existing database re-applies the schema, re-checks the
// additive columns, and garbage-collects unreferenced screenshots_dirs rows.
// None of that may touch live data. The failure-ledger dir is the sharp edge:
// nothing in the screenshot tables references it, so a prune that forgot
// failed_files would try to delete a RESTRICT-protected row and NewSQLStore
// would return an error instead of opening — the app dead on launch, with the
// user's history intact but unreachable.
func TestNewSQLStore_ReopenKeepsRowsAndReferencedDirs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recall.db")
	first := openFileStore(t, path)
	shots, failures := seedTwoDirs(t, first)
	if err := first.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	second := openFileStore(t, path)

	snap, err := second.LoadAll()
	mustNoErr(t, err)
	if len(snap.Summaries) != 1 || snap.Summaries[0].Map != "rialto" {
		t.Fatalf("summaries after reopen = %+v, want the seeded row", snap.Summaries)
	}
	if got, _ := second.LookupScreenshotsDir(shots); got != "/shots" {
		t.Errorf("referenced screenshots dir = %q, want /shots", got)
	}
	if got, _ := second.LookupScreenshotsDir(failures); got != "/failures" {
		t.Errorf("failure-ledger dir = %q, want /failures (pruned while still referenced)", got)
	}
	if rows, _ := second.ListFailedFiles(); len(rows) != 1 {
		t.Errorf("failed-file ledger after reopen = %+v, want the seeded row", rows)
	}
}

// The open-time GC only reclaims dirs nothing references. A dir left behind by
// a deleted match must go — they accumulate forever otherwise, since the FK is
// RESTRICT and nothing else ever removes one.
func TestNewSQLStore_ReopenReclaimsOrphanedScreenshotsDirs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recall.db")
	first := openFileStore(t, path)
	orphan, err := first.EnsureScreenshotsDir("/old-watch-folder")
	if err != nil {
		t.Fatalf("EnsureScreenshotsDir: %v", err)
	}
	mustNoErr(t, first.UpsertSummary(db.SummaryRow{
		Filename: "a.png", MatchKey: "match-2026-01-01T12-00-00", ScreenshotsDirID: orphan,
	}))
	mustNoErr(t, first.HardDeleteMatch("match-2026-01-01T12-00-00"))
	if err := first.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	second := openFileStore(t, path)

	if got, _ := second.LookupScreenshotsDir(orphan); got != "" {
		t.Errorf("orphaned screenshots dir survived the open-time prune as %q", got)
	}
}

// Pointing the store at a file that isn't a SQLite database must fail closed,
// with the driver's diagnostic intact — this is what a user sees after
// restoring the wrong file over their database, and it's the string they paste
// into a bug report.
func TestNewSQLStore_RejectsAFileThatIsNotADatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recall.db")
	if err := os.WriteFile(path, []byte("PK\x03\x04 definitely a zip archive\n"), 0o600); err != nil {
		t.Fatalf("write decoy: %v", err)
	}
	store, err := db.NewSQLStore(path)
	if err == nil {
		_ = store.Close()
		t.Fatal("NewSQLStore accepted a non-database file")
	}
	if !strings.Contains(err.Error(), "not a database") {
		t.Errorf("error = %q, want it to say the file is not a database", err)
	}
}
