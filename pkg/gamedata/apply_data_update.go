package gamedata

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"recall/pkg/applog"
	"recall/pkg/parser"
)

// Apply Game Data Update flow:
//
//  1. Download {heroes,maps,screenshot_sources,seasons}.yaml + their
//     .sha256 sidecars from the Pages-published main channel at
//     https://sound-barrier.github.io/recall/data/.
//  2. Verify each YAML against its sidecar (existing verifySha256).
//  3. Snapshot the existing on-disk files into memory so a partial
//     rename can revert. A file that cannot be read aborts here — an
//     un-snapshotted file has no restorable copy.
//  4. Stage every file as <file>.tmp under <RECALL_DATA_DIR>/data —
//     the four YAMLs AND manifest.json.
//  5. Rename the YAML .tmp files → final.
//  6. Rename manifest.json.tmp → manifest.json. This is the apply's
//     commit point: it runs last, so every fallible write is already
//     done and a manifest failure leaves the previous dataset and the
//     previous manifest both in place, with the apply retryable.
//  7. parser.Reload() — the atomic-pointer swap publishes the new
//     dataset to in-flight readers.
//
// Any failure before the data renames removes the staged .tmp files; a
// failed data rename also reverts from the in-memory snapshot. Every
// failure returns a typed sentinel for the HTTP handler to map to
// 422 / 500 / 502.

// Sentinel errors. Handlers errors.Is each into a status code (see
// registerSystemRoutes in pkg/cmd/server_system.go).
var (
	// ErrDataUpdateChecksum — SHA-256 sidecar verification failed on
	// at least one asset. Handler maps to 422.
	ErrDataUpdateChecksum = errors.New("data update: SHA-256 verification failed")

	// ErrDataUpdateMalformed — a fetched payload's checksum was valid but
	// its YAML does not parse. The sidecar only proves the bytes arrived
	// intact, not that upstream published a usable file. Handler maps to
	// 422 alongside ErrDataUpdateChecksum.
	ErrDataUpdateMalformed = errors.New("data update: malformed YAML payload")

	// ErrDataUpdateIO — disk I/O failed (mkdir, write, rename). Maps
	// to 500.
	ErrDataUpdateIO = errors.New("data update: I/O failure")

	// ErrDataUpdateMainFetchFailed — Pages-published from-main channel
	// is unreachable or the response is malformed (e.g. version.json
	// missing). Handler maps to 502 (Bad Gateway — Pages downstream
	// issue, distinct from ErrDataUpdateIO which is local disk).
	ErrDataUpdateMainFetchFailed = errors.New("data update: main fetch failed")
)

// ChecksumError names the asset whose SHA-256 sidecar verification failed. It
// unwraps to ErrDataUpdateChecksum so existing errors.Is callers keep their 422
// mapping, while the HTTP layer can errors.As it to surface the asset in the
// problem response's failed_assets extension member.
type ChecksumError struct{ Asset string }

func (e *ChecksumError) Error() string { return ErrDataUpdateChecksum.Error() + ": " + e.Asset }
func (e *ChecksumError) Unwrap() error { return ErrDataUpdateChecksum }

// DataUpdateResult is the success-path payload returned to the FE.
// Empty Added*/Removed* slices marshal as omitempty so the modal can
// show "No changes" when the apply was a no-op rebuild.
//
// AppliedCommit carries the 7-char short SHA from the Pages-published
// data/version.json the apply pulled from.
type DataUpdateResult struct {
	AppliedCommit  string   `json:"applied_commit"`
	AddedHeroes    []string `json:"added_heroes,omitempty"`
	RemovedHeroes  []string `json:"removed_heroes,omitempty"`
	AddedMaps      []string `json:"added_maps,omitempty"`
	RemovedMaps    []string `json:"removed_maps,omitempty"`
	AddedSources   []string `json:"added_sources,omitempty"`
	RemovedSources []string `json:"removed_sources,omitempty"`
	AddedSeasons   []string `json:"added_seasons,omitempty"`
	RemovedSeasons []string `json:"removed_seasons,omitempty"`
	ChangedSeasons []string `json:"changed_seasons,omitempty"`
}

// dataUpdateMu serializes ApplyGameDataUpdate calls so two concurrent
// browser tabs can't race on the rename + manifest write. The single
// mutex is fine because the call is rare (once a month per user).
var dataUpdateMu sync.Mutex

// RenameFunc is the test seam that lets apply_data_update_test.go
// simulate a partial-rename failure. Defaults to os.Rename in
// production; tests swap it for a wrapper that fails on the Nth call.
var RenameFunc = os.Rename

// ReadFileFunc is the test seam for the pre-apply snapshot read, mirroring
// RenameFunc. Defaults to os.ReadFile in production; tests swap it for a
// reader that fails on a file which exists but cannot be read.
var ReadFileFunc = os.ReadFile

// tmpSuffix names the staging sibling of every file the apply writes —
// <file>.tmp is written first, then renamed into place.
const tmpSuffix = ".tmp"

// dataYAMLFiles is the canonical list of asset names Apply Data
// Update writes. Order is the on-disk write order so the partial-
// failure rollback test can be deterministic.
var dataYAMLFiles = []string{
	"heroes.yaml",
	"maps.yaml",
	"screenshot_sources.yaml",
	"seasons.yaml",
}

// Apply downloads + verifies + applies the live game data from the
// Pages-published main channel into <baseDir>/data. Returns the diff
// vs the previous dataset on success; ErrDataUpdateMainFetchFailed if
// Pages is unreachable, ErrDataUpdateChecksum on sidecar mismatch,
// ErrDataUpdateIO on local disk failures. Safe for concurrent callers
// via dataUpdateMu.
func Apply(baseDir string) (DataUpdateResult, error) {
	dataUpdateMu.Lock()
	defer dataUpdateMu.Unlock()

	// One client for version.json + all roster assets — every GET in an
	// apply hits the same Pages host.
	client := NewUpdateClient()
	ver := fetchMainVersion(client)
	if ver.CommitSHA == "" {
		return DataUpdateResult{}, fmt.Errorf("%w: version.json unreachable", ErrDataUpdateMainFetchFailed)
	}

	verified, err := fetchAndVerifyMainAssets(client)
	if err != nil {
		return DataUpdateResult{}, err
	}

	short := shortenCommitSHA(ver.CommitSHA)
	manifest := DataManifest{
		AppliedSource:     "main",
		AppliedMainCommit: short,
		AppliedAt:         time.Now().UTC(),
	}
	added, err := commitVerifiedAssets(baseDir, verified, manifest)
	if err != nil {
		return DataUpdateResult{}, err
	}
	added.AppliedCommit = short
	return added, nil
}

// commitVerifiedAssets takes pre-fetched + pre-verified asset bytes and
// applies them: validate → snapshot → stage → rename assets → commit the
// manifest → parser.Reload → return the diff.
//
// Callers populate manifest.AppliedSource + AppliedReleaseTag /
// AppliedMainCommit + AppliedAt. The manifest's Files map is filled
// in here from verified.
func commitVerifiedAssets(baseDir string, verified map[string]verifiedAsset, manifest DataManifest) (DataUpdateResult, error) {
	if err := validateVerifiedAssets(verified); err != nil {
		return DataUpdateResult{}, err
	}
	dataDir := filepath.Join(baseDir, dataDirName)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return DataUpdateResult{}, fmt.Errorf("%w: mkdir data: %w", ErrDataUpdateIO, err)
	}
	snapshot, err := snapshotDataDir(dataDir)
	if err != nil {
		return DataUpdateResult{}, err
	}
	before := currentRosters()

	manifest.Files = manifestFiles(verified)
	staged := stagedApply{
		baseDir:  baseDir,
		dataDir:  dataDir,
		verified: verified,
		manifest: manifest,
		snapshot: snapshot,
	}
	if err := staged.run(); err != nil {
		return DataUpdateResult{}, err
	}

	// A Reload failure stays a warning: the apply itself succeeded — the
	// files on disk are the new dataset and the manifest truthfully records
	// them, so the next boot loads them. Every payload was parsed by
	// validateVerifiedAssets before any write, so reaching here means
	// something changed the files underneath us; failing the apply would
	// mean un-committing a commit that worked.
	if err := parser.Reload(); err != nil {
		applog.Subsystem("apply_data_update").Warn("parser.Reload returned errors after apply", "err", err)
	}
	return diffSince(before), nil
}

// validateVerifiedAssets rejects a checksum-valid-but-unparseable payload
// BEFORE anything is written: past the commit the manifest records the
// version as applied, while parser.Reload would silently fall back to
// embedded data with a permanent load-error banner.
func validateVerifiedAssets(verified map[string]verifiedAsset) error {
	for _, name := range dataYAMLFiles {
		if err := parser.ValidateDataYAML(name, verified[name].bytes); err != nil {
			return fmt.Errorf("%w: %s: %w", ErrDataUpdateMalformed, name, err)
		}
	}
	return nil
}

// manifestFiles records the post-write checksum + byte count of every asset
// the apply is about to commit.
func manifestFiles(verified map[string]verifiedAsset) map[string]ManifestFile {
	out := make(map[string]ManifestFile, len(dataYAMLFiles))
	for _, name := range dataYAMLFiles {
		v := verified[name]
		out[name] = ManifestFile{SHA256: v.sha256, Size: int64(len(v.bytes))}
	}
	return out
}

// loadedRosters is the parser's published state at one instant — the
// pre-apply half of the diff the FE renders as "what this update changed".
type loadedRosters struct {
	heroes  []string
	maps    []string
	sources []string
	seasons []parser.Season
}

// currentRosters snapshots what the parser serves right now.
func currentRosters() loadedRosters {
	return loadedRosters{
		heroes:  flattenRoster(parser.HeroesByRole()),
		maps:    flattenRoster(parser.MapsByGameMode()),
		sources: sourceNames(parser.Sources()),
		seasons: parser.Seasons(),
	}
}

// diffSince compares the rosters captured before the apply against what the
// parser serves now.
func diffSince(before loadedRosters) DataUpdateResult {
	var out DataUpdateResult
	out.AddedHeroes, out.RemovedHeroes = diffRosters(before.heroes, flattenRoster(parser.HeroesByRole()))
	out.AddedMaps, out.RemovedMaps = diffRosters(before.maps, flattenRoster(parser.MapsByGameMode()))
	out.AddedSources, out.RemovedSources = diffRosters(before.sources, sourceNames(parser.Sources()))
	out.AddedSeasons, out.RemovedSeasons, out.ChangedSeasons =
		diffSeasons(before.seasons, seasonMetasFromParser(parser.Seasons()))
	return out
}

// fetchAndVerifyMainAssets is the main-channel sibling of
// fetchAndVerifyAssets — same shape, different URL builder. The client
// must come from NewUpdateClient: the apply path enforces the same
// redirect-host allowlist + HTTPS guard the check path does, or a
// spoofed redirect could bounce the fetch to an arbitrary host.
func fetchAndVerifyMainAssets(client *http.Client) (map[string]verifiedAsset, error) {
	out := make(map[string]verifiedAsset, len(dataYAMLFiles))
	for _, name := range dataYAMLFiles {
		b, err := getBytes(client, MainAssetURL(name))
		if err != nil {
			return nil, fmt.Errorf("%w: fetch %s: %w", ErrDataUpdateMainFetchFailed, name, err)
		}
		sum, err := getBytes(client, MainAssetURL(name)+".sha256")
		if err != nil {
			return nil, fmt.Errorf("%w: fetch %s.sha256: %w", ErrDataUpdateMainFetchFailed, name, err)
		}
		if !verifySha256(b, sum) {
			return nil, &ChecksumError{Asset: name}
		}
		h := sha256.Sum256(b)
		out[name] = verifiedAsset{bytes: b, sha256: hex.EncodeToString(h[:])}
	}
	return out, nil
}

// verifiedAsset bundles the asset bytes + computed SHA-256 so the
// manifest write doesn't need to re-hash.
type verifiedAsset struct {
	bytes  []byte
	sha256 string
}

// snapshotDataDir reads the pre-apply file contents into memory so a partial
// rename can be reverted. An absent file is recorded as nil — restore reads
// nil as "this file did not exist before, remove it".
//
// A file that exists but cannot be read fails the whole apply instead: the
// snapshot is the rollback's only copy, so continuing would let a transient
// read error turn the next restore into a deleter of the user's live roster
// YAML. Aborting here costs an update; conflating the two costs the data.
func snapshotDataDir(dataDir string) (map[string][]byte, error) {
	out := make(map[string][]byte, len(dataYAMLFiles))
	for _, name := range dataYAMLFiles {
		b, err := ReadFileFunc(filepath.Join(dataDir, name))
		switch {
		case errors.Is(err, fs.ErrNotExist):
			out[name] = nil
		case err != nil:
			return nil, fmt.Errorf("%w: snapshot %s: %w", ErrDataUpdateIO, name, err)
		default:
			out[name] = b
		}
	}
	return out, nil
}

// stagedApply bundles the two-phase write's collaborators: the payloads to
// stage, the manifest recording them, and the pre-apply snapshot a failed
// data rename restores from.
type stagedApply struct {
	baseDir  string
	dataDir  string
	verified map[string]verifiedAsset
	manifest DataManifest
	snapshot map[string][]byte
}

// run stages every file, renames the assets, then renames the manifest LAST.
// The manifest rename is the apply's single commit point — every fallible
// write is already done by then, so a manifest failure leaves the old dataset
// under the old manifest and the whole apply retryable, with no good data to
// roll back.
func (s stagedApply) run() error {
	if err := s.stage(); err != nil {
		s.removeStaged()
		return err
	}
	if err := s.renameAssets(); err != nil {
		s.restore()
		s.removeStaged()
		return err
	}
	if err := s.commitManifest(); err != nil {
		s.removeStaged()
		return err
	}
	return nil
}

// stage writes every file the apply will commit — the assets and the
// manifest — to sibling .tmp paths. None of it is visible to a reader of the
// data dir yet.
func (s stagedApply) stage() error {
	if err := s.stageAssets(); err != nil {
		return err
	}
	return s.stageManifest()
}

func (s stagedApply) stageAssets() error {
	for _, name := range dataYAMLFiles {
		tmp := filepath.Join(s.dataDir, name+tmpSuffix)
		if err := os.WriteFile(tmp, s.verified[name].bytes, 0o600); err != nil {
			return fmt.Errorf("%w: write %s%s: %w", ErrDataUpdateIO, name, tmpSuffix, err)
		}
	}
	return nil
}

// stageManifest marshals + writes manifest.json.tmp. It runs BEFORE any asset
// rename so that a manifest the apply cannot even build never leaves new data
// behind under a stale manifest (which status reads as "not applied", making
// the UI re-offer the update forever).
func (s stagedApply) stageManifest() error {
	b, err := json.MarshalIndent(s.manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("%w: marshal manifest: %w", ErrDataUpdateIO, err)
	}
	if err := os.WriteFile(manifestPath(s.baseDir)+tmpSuffix, b, 0o600); err != nil {
		return fmt.Errorf("%w: write manifest%s: %w", ErrDataUpdateIO, tmpSuffix, err)
	}
	return nil
}

func (s stagedApply) renameAssets() error {
	for _, name := range dataYAMLFiles {
		tmp := filepath.Join(s.dataDir, name+tmpSuffix)
		final := filepath.Join(s.dataDir, name)
		if err := RenameFunc(tmp, final); err != nil {
			return fmt.Errorf("%w: rename %s%s: %w", ErrDataUpdateIO, name, tmpSuffix, err)
		}
	}
	return nil
}

// commitManifest renames the staged manifest over the live one — the single
// step that makes the apply "applied".
func (s stagedApply) commitManifest() error {
	path := manifestPath(s.baseDir)
	if err := RenameFunc(path+tmpSuffix, path); err != nil {
		return fmt.Errorf("%w: commit manifest: %w", ErrDataUpdateIO, err)
	}
	return nil
}

// restore puts each snapshotted file back. A nil entry means the file was
// absent before the apply, so it is removed.
func (s stagedApply) restore() {
	for name, b := range s.snapshot {
		final := filepath.Join(s.dataDir, name)
		if b == nil {
			_ = os.Remove(final)
			continue
		}
		_ = os.WriteFile(final, b, 0o600)
	}
}

// removeStaged drops every .tmp file the apply may have left behind,
// including the staged manifest.
func (s stagedApply) removeStaged() {
	for _, name := range dataYAMLFiles {
		_ = os.Remove(filepath.Join(s.dataDir, name+tmpSuffix))
	}
	_ = os.Remove(manifestPath(s.baseDir) + tmpSuffix)
}
