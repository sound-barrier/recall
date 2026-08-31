package db_test

import (
	"testing"
)

// Clear deletes failed_files BEFORE screenshots_dirs on purpose: the ledger's
// screenshots_dir_id FK is ON DELETE RESTRICT, so a dir row a failed file
// still references cannot be removed. Sorting that delete list alphabetically
// — the obvious tidy-up — makes Clear fail outright with a constraint error on
// any database that has ever recorded an OCR failure.
func TestSQLStore_Clear_DeletesFailedFilesBeforeTheirScreenshotsDir(t *testing.T) {
	s := openMemory(t)
	dirID, err := s.EnsureScreenshotsDir("/shots")
	if err != nil {
		t.Fatalf("EnsureScreenshotsDir: %v", err)
	}
	if err := s.RecordFailedFile("broken.png", dirID, "tesseract exited 1"); err != nil {
		t.Fatalf("RecordFailedFile: %v", err)
	}

	if err := s.Clear(); err != nil {
		t.Fatalf("Clear with a failed file referencing a screenshots dir: %v", err)
	}

	rows, err := s.ListFailedFiles()
	if err != nil {
		t.Fatalf("ListFailedFiles: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("failed-file ledger survived Clear: %+v", rows)
	}
	if path, _ := s.LookupScreenshotsDir(dirID); path != "" {
		t.Errorf("screenshots dir %d survived Clear as %q", dirID, path)
	}
}
