package profiles

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"recall/pkg/db"
)

// SeedClaims gives the claims ledger every screenshot the install's profiles
// already hold, the first time the ledger is used, so a profile created after
// an upgrade does not re-import what an older profile already parsed. It opens
// each profile's database only while seeding is still due; a profile that has
// never opened a database contributes nothing. folderOf names a profile's
// screenshots folder, where screenshots parsed before the content-hash
// registry existed are hashed from disk.
func SeedClaims(p *Profiles, c *Claims, folderOf func(profile string) string) error {
	_, err := c.SeedOnce(func() ([]SeedClaim, error) {
		var existing []SeedClaim
		for _, name := range p.List() {
			dbPath := filepath.Join(p.ProfileDir(name), "db", "recall.db")
			held, err := heldScreenshots(dbPath, name, folderOf(name))
			if err != nil {
				return nil, err
			}
			existing = append(existing, held...)
		}
		return existing, nil
	})
	return err
}

// heldScreenshots lists the screenshots one profile's database holds: every
// original in the content-hash registry, plus parsed screenshots in folder
// that predate the registry and so carry no entry (hashed from disk, with no
// known ingest time).
func heldScreenshots(dbPath, profile, folder string) ([]SeedClaim, error) {
	if _, err := os.Stat(dbPath); errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	store, err := db.NewSQLStore(dbPath)
	if err != nil {
		return nil, fmt.Errorf("open %s's database: %w", profile, err)
	}
	defer func() { _ = store.Close() }()
	ingested, err := store.LoadIngestedFiles()
	if err != nil {
		return nil, fmt.Errorf("read %s's screenshots: %w", profile, err)
	}
	held := make([]SeedClaim, 0, len(ingested))
	for filename, rec := range ingested {
		if rec.DuplicateOf == "" {
			held = append(held, SeedClaim{
				Hash: rec.ContentHash, Profile: profile, Filename: filename, IngestedAt: rec.FirstSeenAt,
			})
		}
	}
	unregistered, err := unregisteredScreenshots(store, ingested, profile, folder)
	if err != nil {
		return nil, err
	}
	return append(held, unregistered...), nil
}

// unregisteredScreenshots hashes the parsed screenshots in folder that the
// content-hash registry has never seen. A file no longer on disk is skipped:
// with no bytes there is nothing another profile could re-import.
func unregisteredScreenshots(store db.Store, ingested map[string]db.IngestedFile, profile, folder string) ([]SeedClaim, error) {
	if folder == "" {
		return nil, nil
	}
	dirID, err := store.EnsureScreenshotsDir(folder)
	if err != nil {
		return nil, fmt.Errorf("resolve %s's screenshots folder: %w", profile, err)
	}
	parsed, err := store.LoadFilenamesForDir(dirID)
	if err != nil {
		return nil, fmt.Errorf("read %s's parsed screenshots: %w", profile, err)
	}
	var claims []SeedClaim
	for filename := range parsed {
		if _, registered := ingested[filename]; registered {
			continue
		}
		hash, err := hashScreenshot(filepath.Join(folder, filename))
		if err != nil {
			continue
		}
		claims = append(claims, SeedClaim{Hash: hash, Profile: profile, Filename: filename})
	}
	return claims, nil
}

func hashScreenshot(path string) (string, error) {
	f, err := os.Open(path) // #nosec G304 -- <profile's configured screenshots folder>/<a filename its database stored>
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
