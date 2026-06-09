package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"recall/pkg/parser"
)

// Apply Data Update flow:
//
//  1. Re-fetch GitHub Releases /latest, confirm the FE-passed tag
//     still matches (otherwise a release landed between check and
//     apply — return 409).
//  2. Download <release>/recall-<v>-{heroes,maps,screenshot_sources}.yaml
//     and their .sha256 sidecars.
//  3. Verify each YAML against its sidecar (existing verifySha256).
//  4. Snapshot the existing on-disk files (if any) into memory so a
//     partial-write failure can revert.
//  5. Write each YAML as <file>.tmp under <RECALL_DATA_DIR>/data.
//  6. Rename all .tmp → final.
//  7. parser.Reload() — the atomic-pointer swap publishes the new
//     dataset to in-flight readers.
//  8. SaveManifest() so subsequent CheckForUpdate calls show the
//     applied tag.
//
// Any failure rolls back from the in-memory snapshot, removes any
// remaining .tmp files, and returns a typed sentinel for the HTTP
// handler to map to 400 / 409 / 422 / 500.

// Sentinel errors. Handlers errors.Is each into a status code (see
// registerSystemRoutes in pkg/cmd/server_system.go).
var (
	// ErrDataUpdateTagMismatch — FE passed an empty / malformed tag.
	// Handler maps to 400.
	ErrDataUpdateTagMismatch = errors.New("data update: tag missing or malformed")

	// ErrDataUpdateChecksum — SHA-256 sidecar verification failed on
	// at least one asset. Handler maps to 422.
	ErrDataUpdateChecksum = errors.New("data update: SHA-256 verification failed")

	// ErrDataUpdateReleaseMoved — GitHub's /latest moved between the
	// frontend's last check and this apply call. Handler maps to 409
	// + the FE retries the check.
	ErrDataUpdateReleaseMoved = errors.New("data update: release moved since check")

	// ErrDataUpdateIO — disk I/O failed (mkdir, write, rename). Maps
	// to 500.
	ErrDataUpdateIO = errors.New("data update: I/O failure")
)

// DataUpdateResult is the success-path payload returned to the FE.
// Empty Added*/Removed* slices marshal as omitempty so the modal can
// show "No changes" when the tag bump was a docs/code-only release.
type DataUpdateResult struct {
	AppliedTag     string   `json:"applied_tag"`
	AddedHeroes    []string `json:"added_heroes,omitempty"`
	RemovedHeroes  []string `json:"removed_heroes,omitempty"`
	AddedMaps      []string `json:"added_maps,omitempty"`
	RemovedMaps    []string `json:"removed_maps,omitempty"`
	AddedSources   []string `json:"added_sources,omitempty"`
	RemovedSources []string `json:"removed_sources,omitempty"`
}

// dataUpdateMu serializes ApplyDataUpdate calls so two concurrent
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

// ApplyDataUpdate downloads + verifies + applies the reference data
// from release `tag`. Returns the diff vs the previous dataset on
// success; a typed sentinel error on any failure. Safe for concurrent
// callers — dataUpdateMu serializes everything.
func (a *App) ApplyDataUpdate(tag string) (DataUpdateResult, error) {
	tag = strings.TrimSpace(strings.TrimPrefix(tag, "v"))
	if tag == "" {
		return DataUpdateResult{}, ErrDataUpdateTagMismatch
	}

	dataUpdateMu.Lock()
	defer dataUpdateMu.Unlock()

	// Release-race check: re-fetch /latest, confirm the FE-shown
	// tag still matches what's actually published.
	if err := confirmReleaseTag(tag); err != nil {
		return DataUpdateResult{}, err
	}

	// Fetch + verify all three assets up-front. If any fails, bail
	// before we've touched the filesystem.
	verified, err := fetchAndVerifyAssets(tag)
	if err != nil {
		return DataUpdateResult{}, err
	}

	// Snapshot existing files for rollback. nil entries are fine —
	// they mean "no file existed at this path before".
	dataDir := filepath.Join(appBaseDir(), dataDirName)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return DataUpdateResult{}, fmt.Errorf("%w: mkdir data: %v", ErrDataUpdateIO, err)
	}
	snapshot := snapshotDataDir(dataDir)

	// Snapshot the parser's current rosters BEFORE the swap so the
	// returned diff describes what's actually changing for the user.
	prevHeroes := flattenRoster(parser.HeroesByRole())
	prevMaps := flattenRoster(parser.MapsByType())
	prevSources := sourceNames(parser.Sources())

	// Write all .tmp files first, then rename in sequence. Rename
	// failures roll back by restoring snapshots + removing .tmp.
	if err := writeAndRename(dataDir, verified); err != nil {
		restoreSnapshot(dataDir, snapshot)
		removeTmpFiles(dataDir)
		return DataUpdateResult{}, err
	}

	// Atomic-swap the parser's dataset. Reload errors are
	// non-fatal — embedded fallback still keeps the parser usable —
	// but we log them so the operator can spot a malformed asset
	// that survived SHA verification (e.g. valid YAML but a missing
	// required role). Still write the manifest so the new tag is
	// reflected; the FE LoadError() surface flags the partial-load.
	if err := parser.Reload(); err != nil {
		log.Printf("apply_data_update: parser.Reload returned errors after apply: %v", err)
	}

	manifest := DataManifest{
		AppliedReleaseTag: tag,
		AppliedAt:         time.Now().UTC(),
		Files:             map[string]ManifestFile{},
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
		AppliedTag:     tag,
		AddedHeroes:    addedHeroes,
		RemovedHeroes:  removedHeroes,
		AddedMaps:      addedMaps,
		RemovedMaps:    removedMaps,
		AddedSources:   addedSources,
		RemovedSources: removedSources,
	}, nil
}

// confirmReleaseTag re-fetches GitHub /latest and asserts the
// just-shown tag still matches. Returns ErrDataUpdateReleaseMoved if
// it doesn't.
func confirmReleaseTag(want string) error {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(releasesURL)
	if err != nil {
		return fmt.Errorf("%w: releases fetch: %v", ErrDataUpdateIO, err)
	}
	defer func() { _ = resp.Body.Close() }()
	var release struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return fmt.Errorf("%w: releases decode: %v", ErrDataUpdateIO, err)
	}
	got := strings.TrimPrefix(release.TagName, "v")
	if got == "" {
		return fmt.Errorf("%w: empty tag in releases response", ErrDataUpdateIO)
	}
	if got != want {
		return fmt.Errorf("%w: latest=%q passed=%q", ErrDataUpdateReleaseMoved, got, want)
	}
	return nil
}

// verifiedAsset bundles the asset bytes + computed SHA-256 so the
// manifest write doesn't need to re-hash.
type verifiedAsset struct {
	bytes  []byte
	sha256 string
}

// fetchAndVerifyAssets downloads each of dataYAMLFiles + its .sha256
// sidecar, verifies, and returns the bytes keyed by filename.
// Returns ErrDataUpdateChecksum if any sidecar fails to verify, or
// ErrDataUpdateIO if any fetch errors.
func fetchAndVerifyAssets(tag string) (map[string]verifiedAsset, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	out := make(map[string]verifiedAsset, len(dataYAMLFiles))
	for _, name := range dataYAMLFiles {
		b, err := getBytes(client, releaseAssetURL(tag, name))
		if err != nil {
			return nil, fmt.Errorf("%w: fetch %s: %v", ErrDataUpdateIO, name, err)
		}
		sum, err := getBytes(client, releaseAssetURL(tag, name)+".sha256")
		if err != nil {
			return nil, fmt.Errorf("%w: fetch %s.sha256: %v", ErrDataUpdateIO, name, err)
		}
		if !verifySha256(b, sum) {
			return nil, fmt.Errorf("%w: %s", ErrDataUpdateChecksum, name)
		}
		h := sha256.Sum256(b)
		out[name] = verifiedAsset{bytes: b, sha256: hex.EncodeToString(h[:])}
	}
	return out, nil
}

// snapshotDataDir reads any pre-apply file contents into memory so
// writeAndRename can revert on partial failure. A missing file is
// recorded as nil — restoreSnapshot interprets nil as "remove file".
func snapshotDataDir(dataDir string) map[string][]byte {
	out := make(map[string][]byte, len(dataYAMLFiles))
	for _, name := range dataYAMLFiles {
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
