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
	BundleIssue         = bundle.BundleIssue
	BundleDataV2        = bundle.BundleDataV2
	BundleManifestV1    = bundle.BundleManifestV1
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
// path the user picked (empty on cancel) plus the merge counts so the UI can
// report "Added N, skipped M" without a second round-trip.
type MatchImportResult struct {
	Path     string `json:"path"`
	Imported int    `json:"imported"`
	Skipped  int    `json:"skipped"`
}

// ExportBundle assembles the selection-aware .zip. Wails-bound; the
// HTTP twin is POST /api/v1/exports/bundle.
func (a *App) ExportBundle(opts ExportBundleOptions) ([]byte, error) {
	recs, err := a.GetMatchResults()
	if err != nil {
		return nil, fmt.Errorf("export bundle: aggregate: %w", err)
	}
	return bundle.Export(a.store, opts, recs, a.settingsSnapshot().ScreenshotsDir, Version)
}

// ImportMatches MERGES a bundle's matches into the live DB
// (skip-existing). Wails-bound; the HTTP twin is POST /api/v1/imports.
func (a *App) ImportMatches(payload []byte) (ImportSummary, error) {
	if err := a.assertActiveMutable(); err != nil {
		return ImportSummary{}, err
	}
	return bundle.Import(a.store, payload)
}

// ValidateBundle inspects a bundle without importing it — the
// cmd/bug-finder consistency probe's entry point.
func ValidateBundle(zipBytes []byte) ([]BundleIssue, error) {
	return bundle.Validate(zipBytes)
}
