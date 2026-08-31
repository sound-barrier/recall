package dbtest

import (
	"sort"
	"time"

	"recall/pkg/db"
)

func (f *Fake) RecordFailedFile(filename string, dirID int64, errMsg string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.FailedFiles == nil {
		f.FailedFiles = map[string]db.FailedFileRow{}
	}
	now := time.Now().UTC().Format(time.RFC3339)
	row, ok := f.FailedFiles[filename]
	if !ok {
		row = db.FailedFileRow{Filename: filename, FirstFailedAt: now}
	}
	row.ScreenshotsDirID = dirID
	row.Error = errMsg
	row.Attempts++
	row.LastFailedAt = now
	f.FailedFiles[filename] = row
	return nil
}

// LoadFailedFilenames mirrors SQLStore: filenames at or past minAttempts.
func (f *Fake) LoadFailedFilenames(minAttempts int) (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]bool{}
	for name, row := range f.FailedFiles {
		if row.Attempts >= minAttempts {
			out[name] = true
		}
	}
	return out, nil
}

func (f *Fake) RemoveFailedFile(filename string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.FailedFiles, filename)
	return nil
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
