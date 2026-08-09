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
		f.Summaries = slices.DeleteFunc(f.Summaries, func(r db.SummaryRow) bool {
			if r.Filename == filename {
				collect(r.MatchKey)
				return true
			}
			return false
		})
	}
	if keepType != "teams" {
		f.Teams = slices.DeleteFunc(f.Teams, func(r db.TeamsRow) bool {
			if r.Filename == filename {
				collect(r.MatchKey)
				return true
			}
			return false
		})
	}
	if keepType != "personal" {
		f.Personals = slices.DeleteFunc(f.Personals, func(r db.PersonalRow) bool {
			if r.Filename == filename {
				collect(r.MatchKey)
				return true
			}
			return false
		})
	}
	if keepType != "rank" {
		f.Ranks = slices.DeleteFunc(f.Ranks, func(r db.RankRow) bool {
			if r.Filename == filename {
				collect(r.MatchKey)
				return true
			}
			return false
		})
	}
	if keepType != "unknown" {
		f.Unknowns = slices.DeleteFunc(f.Unknowns, func(r db.UnknownRow) bool {
			if r.Filename == filename {
				collect(r.MatchKey)
				return true
			}
			return false
		})
	}
	if keepType != "all_heroes" {
		delete(f.AllHeroes, filename)
	}
	// Mirror SQLStore: candidates referencing a key with no remaining
	// parent rows must go (HardDeleteMatch's dead-key invariant).
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
	return nil
}

func (f *Fake) matchKeyHasRowsLocked(key string) bool {
	for _, r := range f.Summaries {
		if r.MatchKey == key {
			return true
		}
	}
	for _, r := range f.Teams {
		if r.MatchKey == key {
			return true
		}
	}
	for _, r := range f.Personals {
		if r.MatchKey == key {
			return true
		}
	}
	for _, r := range f.Ranks {
		if r.MatchKey == key {
			return true
		}
	}
	for _, r := range f.Unknowns {
		if r.MatchKey == key {
			return true
		}
	}
	return false
}
