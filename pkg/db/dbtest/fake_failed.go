package dbtest

import (
	"fmt"
	"sort"
	"time"

	"recall/pkg/db"
	"recall/pkg/parser"
)

func (f *Fake) RecordFailedFile(file db.FileRef, kind db.FailureKind, errMsg string) error {
	if kind != db.FailureParseFailed && kind != db.FailureOCRUnavailable {
		return fmt.Errorf("dbtest: unknown failure kind %q", kind)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.FailedFiles == nil {
		f.FailedFiles = map[db.FileRef]db.FailedFileRow{}
	}
	file = fileRef(file)
	now := time.Now().UTC().Format(time.RFC3339)
	row, ok := f.FailedFiles[file]
	if !ok {
		row = db.FailedFileRow{Filename: file.Filename, ScreenshotsDirID: file.DirID, FirstFailedAt: now}
	}
	row.Kind = kind
	row.Error = errMsg
	// Only a parse that ran and failed counts; an OCR outage is not a
	// verdict on the file.
	if kind == db.FailureParseFailed {
		row.Attempts++
	}
	row.LastFailedAt = now
	row.ParserGeneration = parser.Generation
	f.FailedFiles[file] = row
	return nil
}

// LoadFailedFilenames mirrors SQLStore: one folder's filenames at or
// past minAttempts, recorded under the given parser generation.
func (f *Fake) LoadFailedFilenames(dirID int64, minAttempts, generation int) (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	dirID = fileRef(db.FileRef{DirID: dirID}).DirID
	out := map[string]bool{}
	for file, row := range f.FailedFiles {
		if file.DirID == dirID && row.Attempts >= minAttempts && row.ParserGeneration == generation {
			out[file.Filename] = true
		}
	}
	return out, nil
}

func (f *Fake) RemoveFailedFile(file db.FileRef) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.FailedFiles, fileRef(file))
	return nil
}

func (f *Fake) RemoveFailedFilesNamed(filename string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for file := range f.FailedFiles {
		if file.Filename == filename {
			delete(f.FailedFiles, file)
		}
	}
	return nil
}

// FailedFileNamed is a test convenience: the ledger row for filename in
// whichever folder holds it (tests use one folder per name).
func (f *Fake) FailedFileNamed(filename string) (db.FailedFileRow, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for file, row := range f.FailedFiles {
		if file.Filename == filename {
			return row, true
		}
	}
	return db.FailedFileRow{}, false
}

// ListFailedFiles returns rows sorted by LastFailedAt DESC then
// filename ASC — same ordering the SQLStore implementation uses.
func (f *Fake) ListFailedFiles() ([]db.FailedFileRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]db.FailedFileRow, 0, len(f.FailedFiles))
	for _, row := range f.FailedFiles {
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastFailedAt != out[j].LastFailedAt {
			return out[i].LastFailedAt > out[j].LastFailedAt
		}
		return out[i].Filename < out[j].Filename
	})
	return out, nil
}
