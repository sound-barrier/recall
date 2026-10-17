package profiles

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
)

// Claims is the install-wide ledger of which profile owns which screenshot.
// Profiles keep separate databases, and most of them watch the same Overwatch
// folder, so without a shared record every profile would re-import every
// screenshot another profile already parsed. A screenshot is identified by the
// SHA-256 of its bytes, so a rename or a second path to the same file is still
// the same claim. It lives at <base>/claims.db, beside profiles.json.
type Claims struct {
	db *sql.DB
}

// SeedClaim is one existing screenshot found in a profile's database when the
// ledger is first created.
type SeedClaim struct {
	Hash       string
	Profile    string
	Filename   string
	IngestedAt string
}

const claimsSchema = `
CREATE TABLE IF NOT EXISTS claims (
  content_hash TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  filename TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;
CREATE INDEX IF NOT EXISTS claims_profile ON claims (profile);
CREATE TABLE IF NOT EXISTS claims_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;`

const seededKey = "seeded"

// OpenClaims opens (creating if needed) the claims ledger under baseDir.
func OpenClaims(baseDir string) (*Claims, error) {
	dsn := filepath.Join(baseDir, "claims.db") +
		"?_pragma=busy_timeout(5000)&_pragma=journal_mode(wal)&_pragma=synchronous(normal)"
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open claims ledger: %w", err)
	}
	if _, err := d.Exec(claimsSchema); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("create claims schema: %w", err)
	}
	return &Claims{db: d}, nil
}

// Close releases the ledger's database handle.
func (c *Claims) Close() error { return c.db.Close() }

// Claim records profile as the owner of hash unless another profile already
// owns it, and returns whoever owns it afterwards.
func (c *Claims) Claim(hash, profile, filename string) (string, error) {
	if _, err := c.db.Exec(
		`INSERT INTO claims (content_hash, profile, filename) VALUES (?, ?, ?)
		 ON CONFLICT (content_hash) DO NOTHING`, hash, profile, filename); err != nil {
		return "", fmt.Errorf("claim %s: %w", filename, err)
	}
	return c.OwnerOf(hash)
}

// OwnerOf returns the profile that owns hash, or "" when nobody does.
func (c *Claims) OwnerOf(hash string) (string, error) {
	var owner string
	err := c.db.QueryRow(`SELECT profile FROM claims WHERE content_hash = ?`, hash).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("look up claim: %w", err)
	}
	return owner, nil
}

// Release drops profile's claim on hash. A claim held by another profile is
// left alone, so a profile can only give away what it owns.
func (c *Claims) Release(hash, profile string) error {
	if _, err := c.db.Exec(
		`DELETE FROM claims WHERE content_hash = ? AND profile = ?`, hash, profile); err != nil {
		return fmt.Errorf("release claim: %w", err)
	}
	return nil
}

// Transfer makes profile the owner of hash, whoever owned it before.
func (c *Claims) Transfer(hash, profile, filename string) error {
	if _, err := c.db.Exec(
		`INSERT INTO claims (content_hash, profile, filename) VALUES (?, ?, ?)
		 ON CONFLICT (content_hash) DO UPDATE SET profile = excluded.profile,
		   filename = excluded.filename,
		   claimed_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		hash, profile, filename); err != nil {
		return fmt.Errorf("transfer claim on %s: %w", filename, err)
	}
	return nil
}

// OwnedByOthers returns every hash claimed by a profile other than profile.
func (c *Claims) OwnedByOthers(profile string) (map[string]bool, error) {
	rows, err := c.db.Query(`SELECT content_hash FROM claims WHERE profile <> ?`, profile)
	if err != nil {
		return nil, fmt.Errorf("list foreign claims: %w", err)
	}
	defer func() { _ = rows.Close() }()
	owned := make(map[string]bool)
	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			return nil, fmt.Errorf("scan foreign claim: %w", err)
		}
		owned[hash] = true
	}
	return owned, rows.Err()
}

// RenameProfile moves every claim held by old to newName.
func (c *Claims) RenameProfile(old, newName string) error {
	if _, err := c.db.Exec(`UPDATE claims SET profile = ? WHERE profile = ?`, newName, old); err != nil {
		return fmt.Errorf("rename claims %s -> %s: %w", old, newName, err)
	}
	return nil
}

// SeedOnce imports the screenshots profiles already hold, the first time the
// ledger is used. A hash several profiles hold goes to the earliest ingest;
// the duplicates themselves stay where they are. It reports whether it seeded.
func (c *Claims) SeedOnce(existing []SeedClaim) (bool, error) {
	tx, err := c.db.Begin()
	if err != nil {
		return false, fmt.Errorf("begin claims seed: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.Exec(`INSERT INTO claims_meta (key, value) VALUES (?, '1')
		ON CONFLICT (key) DO NOTHING`, seededKey)
	if err != nil {
		return false, fmt.Errorf("mark claims seeded: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return false, nil
	}

	ordered := append([]SeedClaim(nil), existing...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].IngestedAt < ordered[j].IngestedAt })
	for _, s := range ordered {
		if _, err := tx.Exec(`INSERT INTO claims (content_hash, profile, filename) VALUES (?, ?, ?)
			ON CONFLICT (content_hash) DO NOTHING`, s.Hash, s.Profile, s.Filename); err != nil {
			return false, fmt.Errorf("seed claim %s: %w", s.Filename, err)
		}
	}
	return true, tx.Commit()
}
