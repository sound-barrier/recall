package dbtest

// Reclassification hygiene — the Fake analog of SQLStore's
// DeleteScreenshotSiblings. Mirrors its contract: drop filename from every
// screenshot surface except keepType's, including the AllHeroes skip set.

import (
	"slices"

	"recall/pkg/db"
)

func (f *Fake) DeleteScreenshotSiblings(filename, keepType string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	oldKeys := map[string]bool{}
	collect := func(key string) { oldKeys[key] = true }
	if keepType != "summary" {
		f.Summaries = deleteByFilename(f.Summaries, filename, collect)
	}
	if keepType != "teams" {
		f.Teams = deleteByFilename(f.Teams, filename, collect)
	}
	if keepType != "personal" {
		f.Personals = deleteByFilename(f.Personals, filename, collect)
	}
	if keepType != "rank" {
		f.Ranks = deleteByFilename(f.Ranks, filename, collect)
	}
	if keepType != "unknown" {
		f.Unknowns = deleteByFilename(f.Unknowns, filename, collect)
	}
	if keepType != "all_heroes" {
		delete(f.AllHeroes, filename)
	}
	f.scrubDeadKeyCandidatesLocked(oldKeys)
	return nil
}

// scrubDeadKeyCandidatesLocked mirrors SQLStore: candidates referencing
// a key with no remaining parent rows must go (HardDeleteMatch's
// dead-key invariant). Caller holds f.mu.
func (f *Fake) scrubDeadKeyCandidatesLocked(oldKeys map[string]bool) {
	for key := range oldKeys {
		if f.matchKeyHasRowsLocked(key) {
			continue
		}
		for pending, cands := range f.Ambiguous {
			kept := slices.DeleteFunc(cands, func(c db.AmbiguousCandidate) bool { return c.MatchKey == key })
			if len(kept) == 0 {
				delete(f.Ambiguous, pending)
			} else {
				f.Ambiguous[pending] = kept
			}
		}
	}
}

func (f *Fake) matchKeyHasRowsLocked(key string) bool {
	return hasMatchKey(f.Summaries, key) ||
		hasMatchKey(f.Teams, key) ||
		hasMatchKey(f.Personals, key) ||
		hasMatchKey(f.Ranks, key) ||
		hasMatchKey(f.Unknowns, key)
}
