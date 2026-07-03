//go:build !serveronly

package cmd

// Test-only exposure of the self-updater's pure internals to the external
// cmd_test package. RecallAssetMatcher is the release-asset picker; DirWritable
// is the install-writability probe. Both are build-tagged to match
// selfupdate.go (Wails build only) and widen no real API.
var (
	RecallAssetMatcher = recallAssetMatcher
	DirWritable        = dirWritable
)
