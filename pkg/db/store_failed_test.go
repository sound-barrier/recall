package db_test

import "testing"

func TestSQLStore_RecordFailedFile_UpsertIncrementsAttempts(t *testing.T) {
	s := openMemory(t)

	if err := s.RecordFailedFile("bad.png", 1, "decoding image: png: invalid format"); err != nil {
		t.Fatalf("record: %v", err)
	}
	rows, err := s.ListFailedFiles()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
	first := rows[0]
	if first.Filename != "bad.png" || first.Attempts != 1 {
		t.Errorf("first record = %+v, want bad.png attempts=1", first)
	}
	if first.Error != "decoding image: png: invalid format" {
		t.Errorf("error = %q", first.Error)
	}
	if first.FirstFailedAt == "" || first.LastFailedAt == "" {
		t.Errorf("timestamps unset: %+v", first)
	}

	if err := s.RecordFailedFile("bad.png", 1, "tesseract failed: exit status 1"); err != nil {
		t.Fatalf("re-record: %v", err)
	}
	rows, err = s.ListFailedFiles()
	if err != nil {
		t.Fatalf("list after upsert: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("upsert must not add a row, got %d", len(rows))
	}
	second := rows[0]
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
