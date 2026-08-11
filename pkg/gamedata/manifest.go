package gamedata

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"recall/pkg/applog"
)

// DataManifest records the release-tag or main commit the user's
// most recent Apply Data Update call pulled from + the SHA-256 of
// each file written. Lives at <baseDir>/data/manifest.json. A missing
// manifest means the install is running on embedded data only.
//
// AppliedSource discriminates between the two channels:
//   - "release" (or "" for manifests written before this field
//     existed) — AppliedReleaseTag carries the tag.
//   - "main" — AppliedMainCommit carries the 7-char short commit SHA
//     pulled from Pages-published data/version.json.
type DataManifest struct {
	AppliedSource     string                  `json:"applied_source,omitempty"`
	AppliedReleaseTag string                  `json:"applied_release_tag,omitempty"`
	AppliedMainCommit string                  `json:"applied_main_commit,omitempty"`
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
	manifestFilename = "manifest.json"
	dataDirName      = "data"
)

// manifestPath returns <baseDir>/data/manifest.json.
func manifestPath(baseDir string) string {
	return filepath.Join(baseDir, dataDirName, manifestFilename)
}

// LoadManifest reads the persisted data-manifest file. A missing file
// returns a zero-value manifest with no error — same shape callers
// already handle for "running on embedded data".
func LoadManifest(baseDir string) (DataManifest, error) {
	b, err := os.ReadFile(manifestPath(baseDir)) // #nosec G304 -- baseDir is the install root, not user input
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return DataManifest{}, nil
		}
		return DataManifest{}, fmt.Errorf("read manifest: %w", err)
	}
	var m DataManifest
	if err := json.Unmarshal(b, &m); err != nil {
		applog.Subsystem("manifest").Warn("corrupt JSON, treating as missing", "err", err)
		return DataManifest{}, nil
	}
	return m, nil
}

// SaveManifest writes the data-manifest under <baseDir>/data/manifest.json.
// NOT atomic — a plain os.WriteFile, so a crash mid-write leaves a truncated
// manifest. That is why the apply path no longer calls it: commitVerifiedAssets
// stages manifest.json.tmp and renames it LAST, making the rename its commit
// point. What remains here is the manifest WRITER used to seed a known state
// in tests, paired with LoadManifest.
func SaveManifest(baseDir string, m DataManifest) error {
	dir := filepath.Join(baseDir, dataDirName)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("mkdir data: %w", err)
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}
	return os.WriteFile(manifestPath(baseDir), b, 0o600)
}
