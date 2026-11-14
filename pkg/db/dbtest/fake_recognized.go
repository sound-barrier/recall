package dbtest

// Recognized-skip registries — the Fake analogs of SQLStore's
// all_heroes_screenshots and history_screenshots tables. Presence means the
// parser recognized a screen that stores no match data and the write path
// recorded it so the next parse run skips it (no re-OCR) — the same role
// Ignored plays for the Dismiss suppress list.

import "recall/pkg/db"

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
	set[fileRef(file)] = true
	return set
}

// namesInFolder is one folder's names from a registry, empty (never nil)
// when it holds none, as the SQL scan returns.
func namesInFolder(set map[db.FileRef]bool, dirID int64) map[string]bool {
	dirID = fileRef(db.FileRef{DirID: dirID}).DirID
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
