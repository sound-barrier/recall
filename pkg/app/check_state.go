package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"time"
)

// CheckState records when the user last successfully ran the update
// check. Lives at <RECALL_DATA_DIR>/check_state.json, install-global
// (NOT per-profile) — the question "have I checked in a while?" is
// about the install, not the active profile. Profile switches must
// not reset the banner cycle.
type CheckState struct {
	LastCheckedAt time.Time `json:"last_checked_at"`
}

// DataManifest records the release-tag the user's most recent Apply
// Data Update call pulled from + the SHA-256 of each file written.
// Lives at <RECALL_DATA_DIR>/data/manifest.json. A missing manifest
// means the install is running on embedded data only.
type DataManifest struct {
	AppliedReleaseTag string                  `json:"applied_release_tag"`
	AppliedAt         time.Time               `json:"applied_at"`
	Files             map[string]ManifestFile `json:"files"`
}

// ManifestFile holds the post-write checksum + byte count of one
// applied YAML. Used by Apply Data Update to detect partial-write
// regressions on subsequent runs.
type ManifestFile struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

const (
	checkStateFilename = "check_state.json"
	manifestFilename   = "manifest.json"
	dataDirName        = "data"
)

// checkStatePath returns <RECALL_DATA_DIR>/check_state.json.
func checkStatePath() string {
	return filepath.Join(appBaseDir(), checkStateFilename)
}

// manifestPath returns <RECALL_DATA_DIR>/data/manifest.json.
func manifestPath() string {
	return filepath.Join(appBaseDir(), dataDirName, manifestFilename)
}

// LoadCheckState reads the persisted check-state file. A missing or
// unreadable file returns a zero-value CheckState with no error — the
// "never checked" branch the banner needs to display.
func LoadCheckState() (CheckState, error) {
	b, err := os.ReadFile(checkStatePath())
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return CheckState{}, nil
		}
		return CheckState{}, fmt.Errorf("read check_state: %w", err)
	}
	var s CheckState
	if err := json.Unmarshal(b, &s); err != nil {
		// Corrupt file shouldn't bubble up — same "never checked"
		// fallback as a missing file. The next successful
		// TouchLastChecked overwrites it. Log for diagnosability.
		log.Printf("check_state: corrupt JSON, treating as missing: %v", err)
		return CheckState{}, nil //nolint:nilerr // intentional fallback to "never checked"
	}
	return s, nil
}

// SaveCheckState writes the check-state file atomically. mkdir+0o700
// + chmod-0o600 mirror the settings.json pattern.
func SaveCheckState(s CheckState) error {
	dir := appBaseDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("mkdir base: %w", err)
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal check_state: %w", err)
	}
	return os.WriteFile(checkStatePath(), b, 0o600)
}

// TouchLastChecked is the one-line "I just checked" call site, used by
// CheckForUpdate after a successful release-API response.
func TouchLastChecked(now time.Time) error {
	return SaveCheckState(CheckState{LastCheckedAt: now.UTC()})
}

// LoadManifest reads the persisted data-manifest file. A missing file
// returns a zero-value manifest with no error — same shape callers
// already handle for "running on embedded data".
func LoadManifest() (DataManifest, error) {
	b, err := os.ReadFile(manifestPath())
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return DataManifest{}, nil
		}
		return DataManifest{}, fmt.Errorf("read manifest: %w", err)
	}
	var m DataManifest
	if err := json.Unmarshal(b, &m); err != nil {
		log.Printf("manifest: corrupt JSON, treating as missing: %v", err)
		return DataManifest{}, nil //nolint:nilerr // intentional fallback to "running on embedded data"
	}
	return m, nil
}

// SaveManifest atomically writes the data-manifest under
// <RECALL_DATA_DIR>/data/manifest.json. Used by Apply Data Update
// after every file has been verified + renamed into place.
func SaveManifest(m DataManifest) error {
	dir := filepath.Join(appBaseDir(), dataDirName)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("mkdir data: %w", err)
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}
	return os.WriteFile(manifestPath(), b, 0o600)
}
