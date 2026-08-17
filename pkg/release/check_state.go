package release

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

// CheckState records when the user last successfully ran the update
// check. Lives at <baseDir>/check_state.json, install-global (NOT
// per-profile) — the question "have I checked in a while?" is about
// the install, not the active profile. Profile switches must not reset
// the banner cycle.
type CheckState struct {
	LastCheckedAt time.Time `json:"last_checked_at"`
}

const checkStateFilename = "check_state.json"

// checkStatePath returns <baseDir>/check_state.json.
func checkStatePath(baseDir string) string {
	return filepath.Join(baseDir, checkStateFilename)
}

// LoadCheckState reads the persisted check-state file under baseDir. A
// missing or unreadable file returns a zero-value CheckState with no
// error — the "never checked" branch the banner needs to display.
func LoadCheckState(baseDir string) (CheckState, error) {
	b, err := os.ReadFile(checkStatePath(baseDir))
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
		applog.Subsystem("check_state").Warn("corrupt JSON, treating as missing", "err", err)
		return CheckState{}, nil
	}
	return s, nil
}

// SaveCheckState writes the check-state file under baseDir atomically.
// mkdir+0o700 + chmod-0o600 mirror the settings.json pattern.
func SaveCheckState(baseDir string, s CheckState) error {
	if err := os.MkdirAll(baseDir, 0o700); err != nil {
		return fmt.Errorf("mkdir base: %w", err)
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal check_state: %w", err)
	}
	return os.WriteFile(checkStatePath(baseDir), b, 0o600)
}

// TouchLastChecked is the one-line "I just checked" call site, used by
// Check after a successful release-API response.
func TouchLastChecked(baseDir string, now time.Time) error {
	return SaveCheckState(baseDir, CheckState{LastCheckedAt: now.UTC()})
}
