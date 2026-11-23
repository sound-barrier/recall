package dbtest

// The per-file ledgers, keyed by (folder, filename) as the SQL store keys
// them: the OCR-failure ledger, the recognized-skip registries, and the
// content-hash registry's cascade on a hard delete.

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
	file = file.Filed()
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
	dirID = db.FileRef{DirID: dirID}.Filed().DirID
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
	delete(f.FailedFiles, file.Filed())
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

// Recognized-skip registries — the Fake analogs of SQLStore's
// all_heroes_screenshots and history_screenshots tables. Presence means the
// parser recognized a screen that stores no match data and the write path
// recorded it so the next parse run skips it (no re-OCR) — the same role
// Ignored plays for the Dismiss suppress list.

func (f *Fake) UpsertAllHeroesScreenshot(file db.FileRef) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.AllHeroes = addRecognized(f.AllHeroes, file)
	return nil
}

func (f *Fake) LoadAllHeroesFilenames(dirID int64) (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return namesInFolder(f.AllHeroes, dirID), nil
}

func (f *Fake) UpsertHistoryScreenshot(file db.FileRef) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.History = addRecognized(f.History, file)
	return nil
}

func (f *Fake) LoadHistoryFilenames(dirID int64) (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return namesInFolder(f.History, dirID), nil
}

// DeleteUnknownScreenshot mirrors SQLStore: the file's Unknown row and its own
// pending candidates go, plus the candidates of any key that row alone backed;
// typed rows stay.
func (f *Fake) DeleteUnknownScreenshot(filename string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	retired := map[db.FileRef]bool{}
	for _, r := range f.Unknowns {
		if r.Filename == filename {
			retired[rowFile(r)] = true
		}
	}
	f.forgetEvidenceLocked(func(file db.FileRef) bool { return retired[file] })
	oldKeys := map[string]bool{}
	f.Unknowns = deleteByFilename(f.Unknowns, filename, func(key string) { oldKeys[key] = true })
	delete(f.Ambiguous, filename)
	f.scrubDeadKeyCandidatesLocked(oldKeys)
	return nil
}

func addRecognized(set map[db.FileRef]bool, file db.FileRef) map[db.FileRef]bool {
	if set == nil {
		set = map[db.FileRef]bool{}
	}
	set[file.Filed()] = true
	return set
}

// namesInFolder is one folder's names from a registry, empty (never nil)
// when it holds none, as the SQL scan returns.
func namesInFolder(set map[db.FileRef]bool, dirID int64) map[string]bool {
	dirID = db.FileRef{DirID: dirID}.Filed().DirID
	out := map[string]bool{}
	for file := range set {
		if file.DirID == dirID {
			out[file.Filename] = true
		}
	}
	return out
}

// forgetNamed drops a name from a registry in every folder.
func forgetNamed(set map[db.FileRef]bool, filename string) {
	for file := range set {
		if file.Filename == filename {
			delete(set, file)
		}
	}
}

// forgetIngestedFiles mirrors the SQL store: the deleted match's own files
// leave the dedup registry, and ingested_files.duplicate_of ON DELETE CASCADE
// takes every byte-identical copy of one with them. The Fake keeps no engine,
// so the cascade is spelled out.
func (f *Fake) forgetIngestedFiles(doomed map[db.FileRef]bool) {
	for file := range doomed {
		delete(f.IngestedFiles, file)
	}
	for file, rec := range f.IngestedFiles {
		if doomed[rec.DuplicateOf] {
			delete(f.IngestedFiles, file)
		}
	}
}

// filesOfKeyLocked is every (folder, filename) a parent row of matchKey
// holds. Callers hold f.mu.
func (f *Fake) filesOfKeyLocked(matchKey string) map[db.FileRef]bool {
	out := map[db.FileRef]bool{}
	collectFilesByKey(f.Summaries, matchKey, out)
	collectFilesByKey(f.Teams, matchKey, out)
	collectFilesByKey(f.Personals, matchKey, out)
	collectFilesByKey(f.Ranks, matchKey, out)
	collectFilesByKey(f.Unknowns, matchKey, out)
	return out
}
