package gamedata

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"recall/pkg/parser"
)

// Recovered says what Recover found an interrupted apply had left, and what
// it did about it.
type Recovered string

const (
	// RecoveredNothing — no apply was interrupted.
	RecoveredNothing Recovered = "nothing"
	// RecoveredForward — the apply had staged its manifest, every file it
	// names was on disk and whole, and the apply was finished.
	RecoveredForward Recovered = "forward"
	// RecoveredBack — the staging was dropped: either nothing had been
	// renamed yet, or the files did not match the staged manifest and could
	// not be committed under it. The old manifest stays, so the dataset reads
	// as not applied and the next apply replaces it whole.
	RecoveredBack Recovered = "back"
)

// Recover resolves what a process that died mid-apply left in the data
// directory, deterministically, before anything reads it. The apply's own
// order decides which way it goes: assets are staged (and synced), then the
// manifest is staged, then the assets are renamed, then the manifest. So a
// staged manifest means every asset was written whole, and the apply can be
// rolled forward once each file checks against it; no staged manifest means
// nothing was renamed, and the staging is simply dropped.
func Recover(baseDir string) (Recovered, error) {
	dataUpdateMu.Lock()
	defer dataUpdateMu.Unlock()
	dataDir := filepath.Join(baseDir, dataDirName)
	staged, err := readStagedManifest(baseDir)
	if errors.Is(err, fs.ErrNotExist) {
		return dropStaging(baseDir, dataDir)
	}
	if err != nil {
		return discard(baseDir, dataDir, err)
	}
	if err := checkAgainst(dataDir, staged); err != nil {
		return discard(baseDir, dataDir, err)
	}
	if err := rollForward(baseDir, dataDir); err != nil {
		return discard(baseDir, dataDir, err)
	}
	if err := parser.Reload(); err != nil {
		return RecoveredForward, fmt.Errorf("%w: reload after recovery: %w", ErrDataUpdateIO, err)
	}
	return RecoveredForward, nil
}

func readStagedManifest(baseDir string) (DataManifest, error) {
	b, err := os.ReadFile(manifestPath(baseDir) + tmpSuffix) // #nosec G304 -- the install root's own staging file
	if err != nil {
		return DataManifest{}, err
	}
	var m DataManifest
	if err := json.Unmarshal(b, &m); err != nil {
		return DataManifest{}, fmt.Errorf("staged manifest: %w", err)
	}
	return m, nil
}

// stagedOrLive is where an asset of an interrupted apply now lives: still at
// its staging name, or already renamed into place.
func stagedOrLive(dataDir, name string) string {
	tmp := filepath.Join(dataDir, name+tmpSuffix)
	if _, err := os.Stat(tmp); err == nil {
		return tmp
	}
	return filepath.Join(dataDir, name)
}

// checkAgainst verifies every asset the staged manifest names against its
// checksum, wherever it now lives.
func checkAgainst(dataDir string, staged DataManifest) error {
	for _, name := range dataYAMLFiles {
		want, ok := staged.Files[name]
		if !ok {
			return fmt.Errorf("staged manifest does not name %s", name)
		}
		b, err := os.ReadFile(stagedOrLive(dataDir, name)) // #nosec G304 -- a fixed asset name in the install's data dir
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != want.SHA256 {
			return fmt.Errorf("%s does not match the staged manifest", name)
		}
	}
	return nil
}

// rollForward finishes the renames and commits the manifest, in the apply's
// own order.
func rollForward(baseDir, dataDir string) error {
	for _, name := range dataYAMLFiles {
		tmp := filepath.Join(dataDir, name+tmpSuffix)
		if err := RenameFunc(tmp, filepath.Join(dataDir, name)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("rename %s: %w", name, err)
		}
	}
	path := manifestPath(baseDir)
	if err := RenameFunc(path+tmpSuffix, path); err != nil {
		return fmt.Errorf("commit manifest: %w", err)
	}
	return nil
}

// dropStaging removes asset staging left by an apply that died before it
// staged its manifest — before anything was renamed.
func dropStaging(baseDir, dataDir string) (Recovered, error) {
	if !anyStaged(dataDir) {
		return RecoveredNothing, nil
	}
	removeStagedIn(baseDir, dataDir)
	return RecoveredBack, nil
}

// discard drops a staging that cannot be committed and reports why.
func discard(baseDir, dataDir string, cause error) (Recovered, error) {
	removeStagedIn(baseDir, dataDir)
	return RecoveredBack, fmt.Errorf("%w: interrupted apply could not be finished: %w", ErrDataUpdateIO, cause)
}

func anyStaged(dataDir string) bool {
	for _, name := range dataYAMLFiles {
		if _, err := os.Stat(filepath.Join(dataDir, name+tmpSuffix)); err == nil {
			return true
		}
	}
	return false
}

func removeStagedIn(baseDir, dataDir string) {
	stagedApply{baseDir: baseDir, dataDir: dataDir}.removeStaged()
}

// writeSynced writes path and syncs it to disk before returning.
func writeSynced(path string, b []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600) // #nosec G304 -- a staging path in the install's data dir
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}
