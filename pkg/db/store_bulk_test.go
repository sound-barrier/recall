package db_test

import (
	"reflect"
	"sort"
	"testing"

	"recall/pkg/db"
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

func TestSQLStore_LookupMatchKeysForFilename_CollectsAndDedupsAcrossTables(t *testing.T) {
	s := openMemory(t)
	mustUpsert := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	// One filename can appear in several parent tables. Two rows share a
	// key (must collapse to one); a third row under the same filename
	// carries a different key (must be kept). filename is UNIQUE *per
	// table*, so the same name across summary/teams/unknown is legal.
	mustUpsert(s.UpsertSummary(db.SummaryRow{Filename: "shot.png", MatchKey: "match-x"}))
	mustUpsert(s.UpsertUnknown(db.UnknownRow{Filename: "shot.png", MatchKey: "match-x"}))
	mustUpsert(s.UpsertTeams(db.TeamsRow{Filename: "shot.png", MatchKey: "match-y"}))
	mustUpsert(s.UpsertSummary(db.SummaryRow{Filename: "other.png", MatchKey: "match-z"}))

	keys, err := s.LookupMatchKeysForFilename("shot.png")
	if err != nil {
		t.Fatalf("LookupMatchKeysForFilename: %v", err)
	}
	sort.Strings(keys)
	if want := []string{"match-x", "match-y"}; !reflect.DeepEqual(keys, want) {
		t.Errorf("got %v, want %v", keys, want)
	}
}

func TestSQLStore_LookupMatchKeysForFilename_AbsentReturnsEmpty(t *testing.T) {
	s := openMemory(t)
	keys, err := s.LookupMatchKeysForFilename("nope.png")
	if err != nil {
		t.Fatalf("LookupMatchKeysForFilename: %v", err)
	}
	if len(keys) != 0 {
		t.Errorf("absent filename: want empty slice, got %v", keys)
	}
}
