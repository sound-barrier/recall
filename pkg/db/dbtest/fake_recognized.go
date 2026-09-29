package dbtest

// Recognized-skip registries — the Fake analogs of SQLStore's
// all_heroes_screenshots and history_screenshots tables. Presence means the
// parser recognized a screen that stores no match data and the write path
// recorded it so the next parse run skips it (no re-OCR) — the same role
// Ignored plays for the Dismiss suppress list.

import "maps"

func (f *Fake) UpsertAllHeroesScreenshot(filename string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.AllHeroes = addRecognized(f.AllHeroes, filename)
	return nil
}

func (f *Fake) LoadAllHeroesFilenames() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return maps.Clone(nonNil(f.AllHeroes)), nil
}

func (f *Fake) UpsertHistoryScreenshot(filename string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.History = addRecognized(f.History, filename)
	return nil
}

func (f *Fake) LoadHistoryFilenames() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return maps.Clone(nonNil(f.History)), nil
}

func addRecognized(set map[string]bool, filename string) map[string]bool {
	if set == nil {
		set = map[string]bool{}
	}
	set[filename] = true
	return set
}

// nonNil keeps a Load on a never-written registry returning an empty map, as
// the SQL scan does, rather than maps.Clone's nil.
func nonNil(set map[string]bool) map[string]bool {
	if set == nil {
		return map[string]bool{}
	}
	return set
}
