package app

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"recall/pkg/applog"
	"recall/pkg/db"
)

// Content-hash dedup pre-scan. Before the OCR loop runs, every new
// image in the screenshots dir is SHA-256'd against the ingested_files
// registry: a byte-identical copy of an already-ingested file (Steam +
// system-shortcut double-saves are the canonical case) is recorded as
// a duplicate and added to the skip set, so it costs zero Tesseract
// time and never becomes a second row. Originals are registered so
// future copies of THEM match. Best-effort throughout — any error is
// logged and the parse proceeds; the worst case is an un-deduped OCR
// pass, which is exactly the pre-feature behavior.
func (a *App) dedupNewFiles(dir string, dirID int64, parsed map[string]bool) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return
	}
	defer release()
	logger := applog.Subsystem("dedup")
	ingested, err := store.LoadIngestedFiles()
	if err != nil {
		logger.Error("load registry failed; skipping dedup", "err", err)
		return
	}
	// Standing duplicates are already in `parsed` — parsedSkipSet owns that
	// marking so the pending count sees the same set (standingDuplicates).
	byHash := make(map[string]db.FileRef, len(ingested))
	for f, rec := range ingested {
		if !rec.IsDuplicate() {
			byHash[rec.ContentHash] = f
		}
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		logger.Error("read dir failed; skipping dedup", "err", err)
		return
	}
	for _, e := range entries {
		file := db.FileRef{DirID: dirID, Filename: e.Name()}
		if outsideDedupScope(e, file, parsed, ingested) {
			continue
		}
		a.registerIngestedImage(logger, dir, file, parsed, byHash)
	}
}

// outsideDedupScope reports whether a directory entry needs no dedup work:
// not an image, already in the skip set, or already registered on a prior run.
func outsideDedupScope(e os.DirEntry, file db.FileRef, parsed map[string]bool, ingested map[db.FileRef]db.IngestedFile) bool {
	if !isImageEntry(e) || parsed[file.Filename] {
		return true
	}
	_, seen := ingested[file]
	return seen // original already registered on a prior run
}

// isImageEntry reports whether a directory entry is a screenshot candidate.
func isImageEntry(e os.DirEntry) bool {
	if e.IsDir() {
		return false
	}
	ext := strings.ToLower(filepath.Ext(e.Name()))
	return ext == ".png" || ext == ".jpg" || ext == ".jpeg"
}

// registerIngestedImage hashes one new image and records it: a byte-identical
// copy of a registered original joins the skip set as a duplicate; anything
// else registers as a fresh original future copies can match.
func (a *App) registerIngestedImage(logger *slog.Logger, dir string, file db.FileRef, parsed map[string]bool, byHash map[string]db.FileRef) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return
	}
	defer release()
	base := file.Filename
	hash, err := hashFile(filepath.Join(dir, base))
	if err != nil {
		logger.Error("hash failed", "file", base, "err", err)
		return
	}
	if canonical, dup := byHash[hash]; dup && canonical != file {
		if err := store.UpsertIngestedFile(file, hash, canonical); err != nil {
			logger.Error("record duplicate failed", "file", base, "err", err)
			return
		}
		parsed[base] = true
		logger.Info("byte-identical copy skipped", "file", base, "duplicate_of", canonical.Filename)
		return
	}
	if !a.claimScreenshot(hash, base) {
		parsed[base] = true
		logger.Info("screenshot owned by another profile skipped", "file", base)
		return
	}
	if err := store.UpsertIngestedFile(file, hash, db.FileRef{}); err != nil {
		logger.Error("record original failed", "file", base, "err", err)
		return
	}
	byHash[hash] = file
}

// standingDuplicates returns the filenames in one folder the registry already knows are
// byte-identical copies of another ingested file. They skip OCR on every
// later run — including ReParseAll, where the canonical re-parses instead —
// and they carry no parent-table row, so LoadAllFilenames can't see them.
// Best-effort like the rest of the skip set: a registry read failure just
// means nothing is suppressed and the copies get re-OCR'd.
func (a *App) standingDuplicates(dirID int64) map[string]bool {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return nil
	}
	defer release()
	ingested, err := store.LoadIngestedFiles()
	if err != nil {
		applog.Subsystem("dedup").Error("load registry failed; standing duplicates not skipped", "err", err)
		return nil
	}
	dupes := map[string]bool{}
	for f, rec := range ingested {
		if f.DirID == dirID && rec.IsDuplicate() {
			dupes[f.Filename] = true
		}
	}
	return dupes
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path) // #nosec G304 -- path is <validated screenshots dir>/<dir entry>
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
