package release

import "recall/pkg/gamedata"

// Test seams for the external test package. Only what the tests actually need
// is re-exported here; the package's surface is otherwise unchanged.

// SetFetchGameDataStatus swaps the main-channel probe for the duration of a
// test and restores it on cleanup.
func SetFetchGameDataStatus(t interface{ Cleanup(func()) }, fn func(string) gamedata.Status) {
	prev := fetchGameDataStatus
	fetchGameDataStatus = fn
	t.Cleanup(func() { fetchGameDataStatus = prev })
}
