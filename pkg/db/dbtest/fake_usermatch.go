package dbtest

import (
	"maps"
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
)

// User match-data override layer — the Fake mirrors the SQLStore as a single
// map keyed by match_key. Tests seed it directly (f.UserMatchData[...]) or via
// UpsertUserMatchData; the aggregator reads it through LoadAllUserMatchData.

func (f *Fake) UpsertUserMatchData(d db.UserMatchData) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.UserMatchData == nil {
		f.UserMatchData = map[string]db.UserMatchData{}
	}
	// Mirror SQLStore's updated_at: the restore's instant when it carries one,
	// the clock when it doesn't.
	d.UpdatedAt = suppliedInstantOrNow(d.UpdatedAt)
	// Mirror the store: the canonical instant is filled from the wall clock
	// the same write carries, and a supplied one is never second-guessed.
	if d.PlayedAtUTC == nil && d.Date != nil && d.FinishedAt != nil {
		if t, ok := match.LocalWallClockToUTC(*d.Date, *d.FinishedAt, time.Local); ok {
			utc := t.UTC().Format("2006-01-02T15:04:05Z")
			d.PlayedAtUTC = &utc
		}
	}
	f.UserMatchData[d.MatchKey] = d
	return nil
}

func (f *Fake) DeleteUserMatchData(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.UserMatchData, matchKey)
	return nil
}

func (f *Fake) LoadAllUserMatchData() (map[string]db.UserMatchData, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.UserMatchData, len(f.UserMatchData))
	maps.Copy(out, f.UserMatchData)
	return out, nil
}

func (f *Fake) MatchKeyExists(matchKey string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.UserMatchData[matchKey]; ok {
		return true, nil
	}
	return anyMatchKey(f.Summaries, matchKey, func(r db.SummaryRow) string { return r.MatchKey }) ||
		anyMatchKey(f.Teams, matchKey, func(r db.TeamsRow) string { return r.MatchKey }) ||
		anyMatchKey(f.Personals, matchKey, func(r db.PersonalRow) string { return r.MatchKey }) ||
		anyMatchKey(f.Ranks, matchKey, func(r db.RankRow) string { return r.MatchKey }) ||
		anyMatchKey(f.Unknowns, matchKey, func(r db.UnknownRow) string { return r.MatchKey }), nil
}

func anyMatchKey[T any](rows []T, key string, matchKeyOf func(T) string) bool {
	for _, r := range rows {
		if matchKeyOf(r) == key {
			return true
		}
	}
	return false
}
