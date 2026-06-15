package dbtest

import (
	"maps"

	"recall/pkg/db"
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
