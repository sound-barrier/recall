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
