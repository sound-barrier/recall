package app

import (
	"fmt"

	"recall/pkg/bundle"
)

// The export/import/validate bundle pipeline lives in pkg/bundle
// (carved out per the decomposition plan). These aliases keep the
// wire types, pkg/cmd's ErrImportMalformed 400-vs-409 split, and the
// Wails binding surface byte-identical; the shell injects the store,
// the aggregated records, the screenshots dir, and the version.

type (
	ExportBundleOptions = bundle.ExportBundleOptions
	ImportSummary       = bundle.ImportSummary
	BundleIssue         = bundle.Issue
	BundleDataV2        = bundle.DataV2
	BundleManifestV1    = bundle.ManifestV1
)

var ErrImportMalformed = bundle.ErrImportMalformed

// BundleIssue.Kind vocabulary — re-exported so ValidateBundle
// consumers (tests, cmd/bug-finder) keep their comparisons.
const (
	IssueMissingManifest         = bundle.IssueMissingManifest
	IssueMissingData             = bundle.IssueMissingData
	IssueWrongManifestSchema     = bundle.IssueWrongManifestSchema
	IssueWrongDataSchema         = bundle.IssueWrongDataSchema
	IssueMatchCountMismatch      = bundle.IssueMatchCountMismatch
	IssueScreenshotCountMismatch = bundle.IssueScreenshotCountMismatch
	IssueManifestMissingFile     = bundle.IssueManifestMissingFile
	IssueOrphanScreenshotFile    = bundle.IssueOrphanScreenshotFile
	IssueManifestKeyNotInData    = bundle.IssueManifestKeyNotInData
	IssueDataFileNotInManifest   = bundle.IssueDataFileNotInManifest
	IssueScreenshotsDirsLeak     = bundle.IssueScreenshotsDirsLeak
)

// BundleSchemaV1 is the manifest.json schema identifier.
const BundleSchemaV1 = bundle.BundleSchemaV1

// MatchImportResult is the Wails LoadMatchImportFromFile return: the dialog
// path the user picked (empty on cancel) plus the outcome, so the UI can
// report "Added N, skipped M" — or open the return sheet — without a second
// round-trip. The outcome is embedded so both transports carry one shape.
type MatchImportResult struct {
	Path string `json:"path"`
	ImportOutcome
}

// SharePlayer is the identity a player attaches when they export a bundle
// FOR a coach: the handle the coach sees pre-filled, and an optional note
// to them. The stable player id is not here — the App mints and persists
// that itself, so a share can't claim to be somebody else.
type SharePlayer struct {
	Handle  string `json:"handle"`
	Message string `json:"message,omitempty"`
}

// ExportBundle assembles the selection-aware .zip. Wails-bound; the
// HTTP twin is POST /api/v1/exports/bundle.
//
// Never share mode: identity is minted, not accepted, so the Player field
// is cleared no matter what the caller passed. ExportShareBundle is the
// only way to put a player in a manifest.
func (a *App) ExportBundle(opts ExportBundleOptions) ([]byte, error) {
	opts.Player = nil
	return a.exportBundle(opts)
}

// ExportShareBundle assembles the bundle a player hands a coach: the same
// selection, plus an identity in the manifest. The stable player id is
// minted on the first share and persisted in Settings, so every later
// share is recognizably the same player and the coach's notes follow them
// even after a handle change. The confirmed handle is persisted too — it
// is what a returning notes file is matched against.
func (a *App) ExportShareBundle(opts ExportBundleOptions, player SharePlayer) ([]byte, error) {
	identity, err := a.shareIdentity(player)
	if err != nil {
		return nil, err
	}
	opts.Player = &identity
	return a.exportBundle(opts)
}

// exportBundle is the shared aggregate-then-pack tail of both export modes.
func (a *App) exportBundle(opts ExportBundleOptions) ([]byte, error) {
	recs, err := a.GetMatchResults()
	if err != nil {
		return nil, fmt.Errorf("export bundle: aggregate: %w", err)
	}
	return bundle.Export(a.store, opts, recs, a.settingsSnapshot().ScreenshotsDir, Version)
}

// ValidateBundle inspects a bundle without importing it — the
// cmd/bug-finder consistency probe's entry point.
func ValidateBundle(zipBytes []byte) ([]BundleIssue, error) {
	return bundle.Validate(zipBytes)
}
