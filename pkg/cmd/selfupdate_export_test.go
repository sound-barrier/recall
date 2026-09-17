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

// ErrUpdateRefused is the sentinel every refusal of a release wraps.
var ErrUpdateRefused = errUpdateRefused

// NewSelfUpdateConfig builds the production updater configuration around a
// caller's client and release key, so a test can route that client to a fake
// GitHub and pin a throwaway key in place of the real one.
var NewSelfUpdateConfig = newSelfUpdateConfig

// NewSelfUpdateHTTPClient builds the production self-update client with every
// timeout divided by speedup, so a test can run minutes of a slow link in a
// second of wall clock. A speedup of 1 is the production client.
func NewSelfUpdateHTTPClient(speedup int) *http.Client {
	scale := time.Duration(speedup)
	production := selfUpdateClientTimeouts
	return newSelfUpdateHTTPClient(selfUpdateTimeouts{
		dial:           production.dial / scale,
		tlsHandshake:   production.tlsHandshake / scale,
		responseHeader: production.responseHeader / scale,
		transfer:       production.transfer / scale,
	})
}
