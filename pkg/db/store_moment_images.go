package db

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// ErrUnsupportedImageType is returned for bytes the serving handler would
// refuse anyway. Storing something that can only be rejected at read time is
// a worse failure than refusing it here, where the caller still knows what
// they sent.
var ErrUnsupportedImageType = errors.New("unsupported image type")

// servableImageTypes mirrors the CHECK on moment_images.mime. Two lists, one
// vocabulary — the CHECK is the backstop, this is the readable refusal.
var servableImageTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
}

// ServableImageType reports whether the serving handler will hand these bytes
// back. Exported so the Fake refuses exactly what the SQLStore's CHECK does.
func ServableImageType(mime string) bool { return servableImageTypes[mime] }

// MomentImageDigest is the content address of a set of image bytes. Exported
// because the coach's archive names images by the same digest, and two
// spellings of "the same image" is exactly the drift this avoids.
func MomentImageDigest(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// PutMomentImage stores image bytes and returns their content address.
//
// Idempotent by construction: the same bytes are the same row, so a
// screenshot pinned to three moments is stored once. The store does the
// hashing rather than the caller for the same reason — one definition of
// identity, which the archive on the coach side also has to agree with.
func (s *SQLStore) PutMomentImage(raw []byte, mime string) (string, error) {
	if !servableImageTypes[mime] {
		return "", fmt.Errorf("%w: %s", ErrUnsupportedImageType, mime)
	}
	if len(raw) == 0 {
		return "", fmt.Errorf("%w: empty", ErrUnsupportedImageType)
	}
	sha := MomentImageDigest(raw)
	if _, err := s.db.Exec(
		`INSERT INTO moment_images (sha256, bytes, mime, byte_size)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(sha256) DO NOTHING`,
		sha, raw, mime, len(raw),
	); err != nil {
		return "", fmt.Errorf("put moment image: %w", err)
	}
	return sha, nil
}

// LoadMomentImage reads one image back. A digest nothing stored is `false`,
// not an error: a moment can outlive its picture (an archive that named one
// it did not carry, a prune that ran early), and that renders as a missing
// image rather than as a note nobody can open.
func (s *SQLStore) LoadMomentImage(sha string) (MomentImage, bool, error) {
	var img MomentImage
	err := s.db.QueryRow(
		`SELECT sha256, bytes, mime, byte_size, created_at FROM moment_images WHERE sha256 = ?`, sha,
	).Scan(&img.SHA256, &img.Bytes, &img.MIME, &img.ByteSize, &img.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return MomentImage{}, false, nil
	}
	if err != nil {
		return MomentImage{}, false, fmt.Errorf("load moment image: %w", err)
	}
	return img, true, nil
}

// momentImageReferrers is every column that can name a moment_images row.
// A prune consults all four: the player's own moments, the coach's while they
// write, the ones a player accepted, and a self-review sitting's. Missing one
// here deletes bytes a note still points at.
var momentImageReferrers = []string{
	"match_moments",
	"coach_note_moments",
	"match_coach_note_moments",
	"self_review_note_moments",
}

// PruneOrphanMomentImages deletes image rows nothing points at, and reports
// how many went.
//
// The collector for a deliberately un-foreign-keyed reference. Three of the
// four referring tables are CASCADE-deleted children of a note, so the rows
// that stop pointing at an image usually vanish without anyone asking this
// table's permission — which is the trade that keeps note deletion a single
// step. Callers run this after anything that can drop a moment.
func (s *SQLStore) PruneOrphanMomentImages() (int, error) {
	var where strings.Builder
	for _, t := range momentImageReferrers {
		// #nosec G202 -- table names come from a hard-coded slice, not user input.
		where.WriteString(` AND sha256 NOT IN (SELECT image_sha256 FROM ` + t + ` WHERE image_sha256 IS NOT NULL)`)
	}
	// #nosec G202 -- the clause above is built from a hard-coded slice.
	res, err := s.db.Exec(`DELETE FROM moment_images WHERE 1 = 1` + where.String())
	if err != nil {
		return 0, fmt.Errorf("prune moment images: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("prune moment images: %w", err)
	}
	return int(n), nil
}
