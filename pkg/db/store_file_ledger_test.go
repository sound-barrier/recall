package db_test

import (
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// Every per-file table is keyed by (folder, filename). A filename is a
// basename, and two screenshots folders routinely hold same-named captures;
// keyed by the name alone, parking or unparking a file in one folder reached
// the other.

func twoFolders(t *testing.T, s db.Store) (a, b int64) {
	t.Helper()
	a, err := s.EnsureScreenshotsDir("/folder-a")
	mustNoErr(t, err)
	b, err = s.EnsureScreenshotsDir("/folder-b")
	mustNoErr(t, err)
	return a, b
}

func TestStoreContract_FailedFilesAreKeyedByFolder(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			a, b := twoFolders(t, s)
			for range 3 {
				mustNoErr(t, s.RecordFailedFile(db.FileRef{DirID: a, Filename: "x.png"}, db.FailureParseFailed, "boom"))
			}
			mustNoErr(t, s.RecordFailedFile(db.FileRef{DirID: b, Filename: "x.png"}, db.FailureParseFailed, "boom"))

			parkedB, err := s.LoadFailedFilenames(b, 3, parser.Generation)
			mustNoErr(t, err)
			if parkedB["x.png"] {
				t.Error("three failures in folder A parked the same name in folder B")
			}
			mustNoErr(t, s.RemoveFailedFile(db.FileRef{DirID: b, Filename: "x.png"}))
			parkedA, err := s.LoadFailedFilenames(a, 3, parser.Generation)
			mustNoErr(t, err)
			if !parkedA["x.png"] {
				t.Error("unparking in folder B unparked folder A's file")
			}
		})
	}
}

// A Tesseract outage is not a verdict on the file. Only a parse that ran and
// failed counts an attempt; an outage over the whole backlog must not park
// every file in it.
func TestStoreContract_AnOCROutageCountsNoAttempt(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			dir, _ := twoFolders(t, s)
			ref := db.FileRef{DirID: dir, Filename: "x.png"}
			for range 5 {
				mustNoErr(t, s.RecordFailedFile(ref, db.FailureOCRUnavailable, "tesseract not available"))
			}
			parked, err := s.LoadFailedFilenames(dir, 1, parser.Generation)
			mustNoErr(t, err)
			if parked["x.png"] {
				t.Error("an OCR outage counted an attempt")
			}
			rows, err := s.ListFailedFiles()
			mustNoErr(t, err)
			if len(rows) != 1 || rows[0].Kind != db.FailureOCRUnavailable || rows[0].Attempts != 0 {
				t.Errorf("rows = %+v, want one ocr_unavailable row with no attempts", rows)
			}
			mustNoErr(t, s.RecordFailedFile(ref, db.FailureParseFailed, "decode"))
			rows, err = s.ListFailedFiles()
			mustNoErr(t, err)
			if rows[0].Kind != db.FailureParseFailed || rows[0].Attempts != 1 {
				t.Errorf("after a real failure = %+v, want parse_failed with one attempt", rows[0])
			}
		})
	}
}

func TestStoreContract_RecognizedRegistriesAreKeyedByFolder(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			a, b := twoFolders(t, s)
			mustNoErr(t, s.UpsertAllHeroesScreenshot(db.FileRef{DirID: a, Filename: "x.png"}))
			mustNoErr(t, s.UpsertHistoryScreenshot(db.FileRef{DirID: a, Filename: "y.png"}))
			heroesB, err := s.LoadAllHeroesFilenames(b)
			mustNoErr(t, err)
			historyB, err := s.LoadHistoryFilenames(b)
			mustNoErr(t, err)
			if heroesB["x.png"] || historyB["y.png"] {
				t.Errorf("folder A's recognized screens skip folder B's: %v %v", heroesB, historyB)
			}
			heroesA, err := s.LoadAllHeroesFilenames(a)
			mustNoErr(t, err)
			if !heroesA["x.png"] {
				t.Error("folder A lost its own recognized screen")
			}
		})
	}
}

func TestStoreContract_IngestedFilesAreKeyedByFolder(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			a, b := twoFolders(t, s)
			original := db.FileRef{DirID: a, Filename: "x.png"}
			mustNoErr(t, s.UpsertIngestedFile(original, "hash-1", db.FileRef{}))
			mustNoErr(t, s.UpsertIngestedFile(db.FileRef{DirID: b, Filename: "x.png"}, "hash-2", db.FileRef{}))
			mustNoErr(t, s.UpsertIngestedFile(db.FileRef{DirID: b, Filename: "copy.png"}, "hash-1", original))

			got, err := s.LoadIngestedFiles()
			mustNoErr(t, err)
			if len(got) != 3 {
				t.Fatalf("registry = %+v, want three rows", got)
			}
			if got[db.FileRef{DirID: b, Filename: "x.png"}].ContentHash != "hash-2" {
				t.Error("folder B's x.png overwrote or lost folder A's")
			}
			if dup := got[db.FileRef{DirID: b, Filename: "copy.png"}]; dup.DuplicateOf != original {
				t.Errorf("copy = %+v, want a duplicate of folder A's x.png", dup)
			}
		})
	}
}
