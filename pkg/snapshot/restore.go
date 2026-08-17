package snapshot

import (
	"errors"
	"fmt"
	"os"

	"recall/pkg/db"
)

// ErrRestoreInvalid marks a restore payload that isn't a usable Recall
// database snapshot (not SQLite, corrupt, or missing the schema). The HTTP
// layer maps it to 422.
var ErrRestoreInvalid = errors.New("restore: not a valid Recall database")

// StageRestore writes payload to a temp file in dir and validates it. Callers
// pass the directory holding the live DB, so the file lands on the same
// filesystem and the caller's later rename is atomic. A file that isn't a
// usable Recall DB is rejected as ErrRestoreInvalid before any destructive
// step runs; on success the staged path is returned and the caller owns
// removing it unless it renames it into place.
func StageRestore(payload []byte, dir string) (string, error) {
	tmp, err := os.CreateTemp(dir, "recall-restore-*.db")
	if err != nil {
		return "", fmt.Errorf("restore: temp: %w", err)
	}
	name := tmp.Name()
	if _, err := tmp.Write(payload); err != nil {
		_ = tmp.Close()
		_ = os.Remove(name)
		return "", fmt.Errorf("restore: write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return "", fmt.Errorf("restore: close temp: %w", err)
	}
	if err := db.ValidateBackupFile(name); err != nil {
		_ = os.Remove(name)
		if errors.Is(err, db.ErrInvalidBackup) {
			return "", fmt.Errorf("%w: %w", ErrRestoreInvalid, err)
		}
		return "", err
	}
	return name, nil
}
