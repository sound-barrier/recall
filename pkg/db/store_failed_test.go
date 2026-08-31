package db_test

import (
	"testing"

	"recall/pkg/db"
)

func TestSQLStore_RecordFailedFile_UpsertIncrementsAttempts(t *testing.T) {
	s := openMemory(t)

	mustNoErr(t, s.RecordFailedFile("bad.png", 1, "decoding image: png: invalid format"))
	first := onlyFailedFile(t, s)
	assertInitialFailedRecord(t, first)

	mustNoErr(t, s.RecordFailedFile("bad.png", 1, "tesseract failed: exit status 1"))
	second := onlyFailedFile(t, s) // upsert must not add a row
	if second.Attempts != 2 {
		t.Errorf("attempts = %d, want 2", second.Attempts)
	}
	if second.Error != "tesseract failed: exit status 1" {
		t.Errorf("error not refreshed: %q", second.Error)
	}
	if second.FirstFailedAt != first.FirstFailedAt {
		t.Errorf("first_failed_at must be preserved: %q -> %q", first.FirstFailedAt, second.FirstFailedAt)
	}
}

// onlyFailedFile returns the ledger's single row, failing when the count
// strays from exactly one.
func onlyFailedFile(t *testing.T, s *db.SQLStore) db.FailedFileRow {
	t.Helper()
	rows, err := s.ListFailedFiles()
	mustNoErr(t, err)
	if len(rows) != 1 {
		t.Fatalf("want exactly 1 ledger row, got %d", len(rows))
	}
	return rows[0]
}

// assertInitialFailedRecord pins the first record's fields and the
// server-stamped timestamps.
func assertInitialFailedRecord(t *testing.T, first db.FailedFileRow) {
	t.Helper()
	if first.Filename != "bad.png" || first.Attempts != 1 {
		t.Errorf("first record = %+v, want bad.png attempts=1", first)
	}
	if first.Error != "decoding image: png: invalid format" {
		t.Errorf("error = %q", first.Error)
	}
	if first.FirstFailedAt == "" || first.LastFailedAt == "" {
		t.Errorf("timestamps unset: %+v", first)
	}
}

func TestSQLStore_RemoveFailedFile_Idempotent(t *testing.T) {
	s := openMemory(t)
	if err := s.RecordFailedFile("gone.png", 1, "boom"); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := s.RemoveFailedFile("gone.png"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := s.RemoveFailedFile("gone.png"); err != nil {
		t.Fatalf("second remove must be a no-op: %v", err)
	}
	rows, err := s.ListFailedFiles()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("want empty ledger, got %v", rows)
	}
}

func TestSQLStore_ListFailedFiles_EmptyIsNonNil(t *testing.T) {
	s := openMemory(t)
	rows, err := s.ListFailedFiles()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if rows == nil {
		t.Fatal("want non-nil empty slice")
	}
}

func TestSQLStore_Clear_WipesFailedFiles(t *testing.T) {
	s := openMemory(t)
	if err := s.RecordFailedFile("bad.png", 1, "boom"); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := s.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	rows, err := s.ListFailedFiles()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("Clear must wipe failed_files, got %v", rows)
	}
}

// A screenshots_dirs row referenced ONLY by a failed_files row must survive
// the startup GC — otherwise the prune's DELETE violates the ledger's
// ON DELETE RESTRICT foreign key and store open fails.
func TestSQLStore_PruneScreenshotsDirs_KeepsFailedOnlyDir(t *testing.T) {
	s := openMemory(t)
	dirID, err := s.EnsureScreenshotsDir("/screens/alt")
	if err != nil {
		t.Fatalf("ensure dir: %v", err)
	}
	if err := s.RecordFailedFile("bad.png", dirID, "boom"); err != nil {
		t.Fatalf("record: %v", err)
	}
	if _, err := s.PruneScreenshotsDirs(); err != nil {
		t.Fatalf("prune: %v", err)
	}
	path, err := s.LookupScreenshotsDir(dirID)
	if err != nil || path != "/screens/alt" {
		t.Errorf("dir referenced by failed_files must survive prune: path=%q err=%v", path, err)
	}
	rows, err := s.ListFailedFiles()
	if err != nil || len(rows) != 1 {
		t.Fatalf("ledger row must survive: rows=%v err=%v", rows, err)
	}
	if rows[0].ScreenshotsDirID != dirID {
		t.Errorf("dir id = %d, want %d", rows[0].ScreenshotsDirID, dirID)
	}
}

// seedFailures records n failures for filename under dirID.
func seedFailures(t *testing.T, s db.Store, filename string, dirID int64, n int) {
	t.Helper()
	for range n {
		if err := s.RecordFailedFile(filename, dirID, "boom"); err != nil {
			t.Fatalf("record %s: %v", filename, err)
		}
	}
}

// mustEnsureDir is EnsureScreenshotsDir with the error folded into t.
func mustEnsureDir(t *testing.T, s db.Store, path string) int64 {
	t.Helper()
	id, err := s.EnsureScreenshotsDir(path)
	if err != nil {
		t.Fatalf("ensure dir %s: %v", path, err)
	}
	return id
}

// The parked-set loader: the skip set asks for one folder's filenames at
// or past the attempt cap, and both implementations must draw both lines
// — the cap and the dir scope — identically. filename is a basename, so
// a failure recorded while a DIFFERENT folder was watched must not park
// a same-named capture in this one.
func TestStoreContract_LoadFailedFilenames_FiltersByDirAndMinAttempts(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			dirID := mustEnsureDir(t, s, "/screens/main")
			otherID := mustEnsureDir(t, s, "/screens/other")
			seedFailures(t, s, "once.png", dirID, 1)
			seedFailures(t, s, "thrice.png", dirID, 3)
			seedFailures(t, s, "elsewhere.png", otherID, 3)

			got, err := s.LoadFailedFilenames(dirID, 3)
			if err != nil {
				t.Fatalf("LoadFailedFilenames: %v", err)
			}
			if got["once.png"] || got["elsewhere.png"] || !got["thrice.png"] || len(got) != 1 {
				t.Errorf("LoadFailedFilenames(dir, 3) = %v, want exactly thrice.png", got)
			}
		})
	}
}
