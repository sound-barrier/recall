//go:build !serveronly

package cmd

import (
	"net/http"
	"time"
)

// Test-only exposure of the self-updater's pure internals to the external
// cmd_test package. RecallAssetMatcher is the release-asset picker; DirWritable
// is the install-writability probe. Both are build-tagged to match
// selfupdate.go (Wails build only) and widen no real API.
var (
	RecallAssetMatcher = recallAssetMatcher
	DirWritable        = dirWritable
)

// NewSelfUpdateConfig builds the production updater configuration around a
// caller's client, so a test can route that client to a fake GitHub.
var NewSelfUpdateConfig = newSelfUpdateConfig

// NewSelfUpdateHTTPClient builds the production self-update client with every
// timeout divided by speedup, so a test can run minutes of a slow link in a
// second of wall clock. A speedup of 1 is the production client.
func NewSelfUpdateHTTPClient(speedup int) *http.Client {
	scale := time.Duration(speedup)
	return newSelfUpdateHTTPClient(selfUpdateTimeouts{
		total: selfUpdateClientTimeouts.total / scale,
	})
}
