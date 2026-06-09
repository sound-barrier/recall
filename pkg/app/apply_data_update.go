package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"recall/pkg/parser"
)

// Apply Game Data Update flow:
//
//  1. Download {heroes,maps,screenshot_sources}.yaml + their .sha256
//     sidecars from the Pages-published main channel at
//     https://sound-barrier.github.io/recall/data/.
//  2. Verify each YAML against its sidecar (existing verifySha256).
//  3. Snapshot the existing on-disk files (if any) into memory so a
//     partial-write failure can revert.
//  4. Write each YAML as <file>.tmp under <RECALL_DATA_DIR>/data.
//  5. Rename all .tmp → final.
//  6. parser.Reload() — the atomic-pointer swap publishes the new
//     dataset to in-flight readers.
//  7. SaveManifest() so subsequent CheckForUpdate calls show the
//     applied commit.
//
// Any failure rolls back from the in-memory snapshot, removes any
// remaining .tmp files, and returns a typed sentinel for the HTTP
// handler to map to 422 / 500 / 502.

// Sentinel errors. Handlers errors.Is each into a status code (see
// registerSystemRoutes in pkg/cmd/server_system.go).
var (
	// ErrDataUpdateChecksum — SHA-256 sidecar verification failed on
	// at least one asset. Handler maps to 422.
	ErrDataUpdateChecksum = errors.New("data update: SHA-256 verification failed")

	// ErrDataUpdateIO — disk I/O failed (mkdir, write, rename). Maps
	// to 500.
	ErrDataUpdateIO = errors.New("data update: I/O failure")

	// ErrDataUpdateMainFetchFailed — Pages-published from-main channel
	// is unreachable or the response is malformed (e.g. version.json
	// missing). Handler maps to 502 (Bad Gateway — Pages downstream
	// issue, distinct from ErrDataUpdateIO which is local disk).
	ErrDataUpdateMainFetchFailed = errors.New("data update: main fetch failed")
)

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
}

// dataUpdateMu serializes ApplyGameDataUpdate calls so two concurrent
// browser tabs can't race on the rename + manifest write. The single
// mutex is fine because the call is rare (once a month per user).
var dataUpdateMu sync.Mutex

// renameFunc is the test seam that lets apply_data_update_test.go
// simulate a partial-rename failure. Defaults to os.Rename in
// production; tests swap it for a wrapper that fails on the Nth call.
var renameFunc = os.Rename

// dataYAMLFiles is the canonical list of asset names Apply Data
// Update writes. Order is the on-disk write order so the partial-
// failure rollback test can be deterministic.
var dataYAMLFiles = []string{
	"heroes.yaml",
	"maps.yaml",
	"screenshot_sources.yaml",
}

// ApplyGameDataUpdate downloads + verifies + applies the live game
// data from the Pages-published main channel. Returns the diff vs
// the previous dataset on success; ErrDataUpdateMainFetchFailed if
// Pages is unreachable, ErrDataUpdateChecksum on sidecar mismatch,
// ErrDataUpdateIO on local disk failures. Safe for concurrent callers
// via dataUpdateMu.
func (a *App) ApplyGameDataUpdate() (DataUpdateResult, error) {
	dataUpdateMu.Lock()
	defer dataUpdateMu.Unlock()

	ver := fetchMainVersion()
	if ver.CommitSHA == "" {
		return DataUpdateResult{}, fmt.Errorf("%w: version.json unreachable", ErrDataUpdateMainFetchFailed)
	}

	verified, err := fetchAndVerifyMainAssets()
	if err != nil {
		return DataUpdateResult{}, err
	}

	short := shortenCommitSHA(ver.CommitSHA)
	manifest := DataManifest{
		AppliedSource:     "main",
		AppliedMainCommit: short,
		AppliedAt:         time.Now().UTC(),
		Files:             map[string]ManifestFile{},
	}
	added, err := commitVerifiedAssets(verified, manifest)
	if err != nil {
		return DataUpdateResult{}, err
	}
	added.AppliedCommit = short
	return added, nil
}

// commitVerifiedAssets takes pre-fetched + pre-verified asset bytes
// and applies them: snapshot → write+rename → parser.Reload → write
// manifest → return diff. Shared between ApplyDataUpdate and
// ApplyMainDataUpdate so both channels share rollback semantics.
//
// Callers populate manifest.AppliedSource + AppliedReleaseTag /
// AppliedMainCommit + AppliedAt. The manifest's Files map is filled
// in here from verified.
func commitVerifiedAssets(verified map[string]verifiedAsset, manifest DataManifest) (DataUpdateResult, error) {
	dataDir := filepath.Join(appBaseDir(), dataDirName)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return DataUpdateResult{}, fmt.Errorf("%w: mkdir data: %v", ErrDataUpdateIO, err)
	}
	snapshot := snapshotDataDir(dataDir)

	prevHeroes := flattenRoster(parser.HeroesByRole())
	prevMaps := flattenRoster(parser.MapsByType())
	prevSources := sourceNames(parser.Sources())

	if err := writeAndRename(dataDir, verified); err != nil {
		restoreSnapshot(dataDir, snapshot)
		removeTmpFiles(dataDir)
		return DataUpdateResult{}, err
	}

	if err := parser.Reload(); err != nil {
		log.Printf("apply_data_update: parser.Reload returned errors after apply: %v", err)
	}

	for _, name := range dataYAMLFiles {
		v := verified[name]
		manifest.Files[name] = ManifestFile{SHA256: v.sha256, Size: int64(len(v.bytes))}
	}
	if err := SaveManifest(manifest); err != nil {
		return DataUpdateResult{}, fmt.Errorf("%w: write manifest: %v", ErrDataUpdateIO, err)
	}

	addedHeroes, removedHeroes := diffRosters(prevHeroes, flattenRoster(parser.HeroesByRole()))
	addedMaps, removedMaps := diffRosters(prevMaps, flattenRoster(parser.MapsByType()))
	addedSources, removedSources := diffRosters(prevSources, sourceNames(parser.Sources()))

	return DataUpdateResult{
		AddedHeroes:    addedHeroes,
		RemovedHeroes:  removedHeroes,
		AddedMaps:      addedMaps,
		RemovedMaps:    removedMaps,
		AddedSources:   addedSources,
		RemovedSources: removedSources,
	}, nil
}

// fetchAndVerifyMainAssets is the main-channel sibling of
// fetchAndVerifyAssets — same shape, different URL builder.
func fetchAndVerifyMainAssets() (map[string]verifiedAsset, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	out := make(map[string]verifiedAsset, len(dataYAMLFiles))
	for _, name := range dataYAMLFiles {
		b, err := getBytes(client, mainAssetURL(name))
		if err != nil {
			return nil, fmt.Errorf("%w: fetch %s: %v", ErrDataUpdateMainFetchFailed, name, err)
		}
		sum, err := getBytes(client, mainAssetURL(name)+".sha256")
		if err != nil {
			return nil, fmt.Errorf("%w: fetch %s.sha256: %v", ErrDataUpdateMainFetchFailed, name, err)
		}
		if !verifySha256(b, sum) {
			return nil, fmt.Errorf("%w: %s", ErrDataUpdateChecksum, name)
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

// snapshotDataDir reads any pre-apply file contents into memory so
// writeAndRename can revert on partial failure. A missing file is
// recorded as nil — restoreSnapshot interprets nil as "remove file".
func snapshotDataDir(dataDir string) map[string][]byte {
	out := make(map[string][]byte, len(dataYAMLFiles))
	for _, name := range dataYAMLFiles {
		// #nosec G304 -- `name` ranges over dataYAMLFiles, a hardcoded
		// package-level list of asset basenames. `dataDir` is the
		// install-global <RECALL_DATA_DIR>/data path. No user input
		// reaches this filepath.
		b, err := os.ReadFile(filepath.Join(dataDir, name))
		if err != nil {
			out[name] = nil
			continue
		}
		out[name] = b
	}
	return out
}

// writeAndRename writes each verified asset to <dataDir>/<name>.tmp
// then renames .tmp → final. If any rename fails the caller is
// responsible for rollback — this function does not clean up.
func writeAndRename(dataDir string, verified map[string]verifiedAsset) error {
	for _, name := range dataYAMLFiles {
		tmp := filepath.Join(dataDir, name+".tmp")
		if err := os.WriteFile(tmp, verified[name].bytes, 0o600); err != nil {
			return fmt.Errorf("%w: write %s.tmp: %v", ErrDataUpdateIO, name, err)
		}
	}
	for _, name := range dataYAMLFiles {
		tmp := filepath.Join(dataDir, name+".tmp")
		final := filepath.Join(dataDir, name)
		if err := renameFunc(tmp, final); err != nil {
			return fmt.Errorf("%w: rename %s.tmp: %v", ErrDataUpdateIO, name, err)
		}
	}
	return nil
}

// restoreSnapshot puts each captured pre-apply file back. nil entries
// (file didn't exist before) are removed from disk if present.
func restoreSnapshot(dataDir string, snapshot map[string][]byte) {
	for name, b := range snapshot {
		final := filepath.Join(dataDir, name)
		if b == nil {
			_ = os.Remove(final)
			continue
		}
		_ = os.WriteFile(final, b, 0o600)
	}
}

// removeTmpFiles drops every <dataDir>/<name>.tmp file. Used after a
// rename failure to clear leftover state.
func removeTmpFiles(dataDir string) {
	for _, name := range dataYAMLFiles {
		_ = os.Remove(filepath.Join(dataDir, name+".tmp"))
	}
}
