package dbtest

// All-Heroes recognized-skip list — the Fake analog of the SQLStore's
// all_heroes_screenshots table. Presence in AllHeroes means the parser
// recognized the PERSONAL "All Heroes" aggregate view for that filename and the
// write path recorded it so the next parse run skips it (no re-OCR) — the same
// role Ignored plays for the "Delete forever" suppress list.

func (f *Fake) UpsertAllHeroesScreenshot(filename string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.AllHeroes == nil {
		f.AllHeroes = map[string]bool{}
	}
	f.AllHeroes[filename] = true
	return nil
}

func (f *Fake) LoadAllHeroesFilenames() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]bool, len(f.AllHeroes))
	for k, v := range f.AllHeroes {
		out[k] = v
	}
	return out, nil
}
