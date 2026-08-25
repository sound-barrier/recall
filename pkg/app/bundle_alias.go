package app

import (
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"strings"

	"recall/pkg/bundle"
	"recall/pkg/db"
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
// ErrShareNeedsReplayCode refuses a share whose matches carry no replay
// code: a coach reviews by WATCHING the replay, and a bundle they cannot
// load hands them nothing to review. Plain exports (backups) and the
// player's own self-review sittings are unaffected — nothing is watched
// remotely there.
var ErrShareNeedsReplayCode = errors.New("share needs a replay code on every match")

func (a *App) ExportShareBundle(opts ExportBundleOptions, player SharePlayer) ([]byte, error) {
	identity, err := a.shareIdentity(player)
	if err != nil {
		return nil, err
	}
	if err := a.assertShareReplayCodes(opts.MatchKeys); err != nil {
		return nil, err
	}
	opts.Player = &identity
	return a.exportBundle(opts)
}

// assertShareReplayCodes checks every selected match carries a replay code,
// and says how many do not — the dialog mirrors this check so a user
// normally never reaches the 409.
func (a *App) assertShareReplayCodes(matchKeys []string) error {
	annotations, err := a.store.LoadAnnotations()
	if err != nil {
		return fmt.Errorf("load annotations for share: %w", err)
	}
	missing := 0
	for _, key := range matchKeys {
		if strings.TrimSpace(annotations[key].ReplayCode) == "" {
			missing++
		}
	}
	if missing > 0 {
		return fmt.Errorf("%w: %d of %d selected matches have none", ErrShareNeedsReplayCode, missing, len(matchKeys))
	}
	return nil
}

// RecordShareReceipt writes the sent-ledger row for a share that actually
// LEFT — called at the boundary that knows it did, not at build time: the
// server handler once the bytes are handed to the browser (path unknowable
// there), and the Wails saver once the file is on disk (path known). A
// receipt written at build time outlived a canceled save dialog. The handle
// recorded is the RESOLVED one — a blank input falls back to the persisted
// handle exactly as the bundle's manifest did. Failing to write the receipt
// is a warning, never an eaten share.
func (a *App) RecordShareReceipt(player SharePlayer, savedPath string, matchKeys []string) {
	identity, err := a.shareIdentity(player)
	if err != nil {
		slog.Warn("share receipt not recorded", "error", err)
		return
	}
	if _, err := a.store.RecordShareExport(identity.Handle, player.Message, savedPath, matchKeys); err != nil {
		slog.Warn("share receipt not recorded", "error", err)
	}
}

// ListShareExports reads the sent ledger, newest first — the Reviews tab's
// "Sent" strip.
func (a *App) ListShareExports() ([]db.ShareExport, error) {
	return a.store.ListShareExports()
}

// ListCoachPlayers reads the roster — every player this user has coached,
// most recently touched first. The Reviews tab's 03 section.
func (a *App) ListCoachPlayers() ([]db.CoachPlayerSummary, error) {
	return a.store.LoadCoachPlayers()
}

// ListCoachPlayerNotes reads every note ever written about one coached
// identity, newest first — the dossier's "Read every note". The roster is
// the existence check: it is tiny, and reusing it keeps the store surface
// unchanged. db.ErrCoachPlayerUnknown for a ref the roster does not carry.
func (a *App) ListCoachPlayerNotes(playerRef int64) ([]db.CoachNote, error) {
	roster, err := a.store.LoadCoachPlayers()
	if err != nil {
		return nil, err
	}
	if !slices.ContainsFunc(roster, func(p db.CoachPlayerSummary) bool { return p.ID == playerRef }) {
		return nil, db.ErrCoachPlayerUnknown
	}
	byKey, err := a.store.LoadCoachNotes(playerRef)
	if err != nil {
		return nil, err
	}
	notes := slices.Collect(maps.Values(byKey))
	slices.SortFunc(notes, func(x, y db.CoachNote) int {
		if c := strings.Compare(y.UpdatedAt, x.UpdatedAt); c != 0 {
			return c
		}
		return strings.Compare(x.MatchKey, y.MatchKey)
	})
	return notes, nil
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
