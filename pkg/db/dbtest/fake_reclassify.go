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
	if keepType != "summary" {
		f.Summaries = slices.DeleteFunc(f.Summaries, func(r db.SummaryRow) bool { return r.Filename == filename })
	}
	if keepType != "teams" {
		f.Teams = slices.DeleteFunc(f.Teams, func(r db.TeamsRow) bool { return r.Filename == filename })
	}
	if keepType != "personal" {
		f.Personals = slices.DeleteFunc(f.Personals, func(r db.PersonalRow) bool { return r.Filename == filename })
	}
	if keepType != "rank" {
		f.Ranks = slices.DeleteFunc(f.Ranks, func(r db.RankRow) bool { return r.Filename == filename })
	}
	if keepType != "unknown" {
		f.Unknowns = slices.DeleteFunc(f.Unknowns, func(r db.UnknownRow) bool { return r.Filename == filename })
	}
	if keepType != "all_heroes" {
		delete(f.AllHeroes, filename)
	}
	return nil
}
