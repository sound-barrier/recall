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
func (a *App) dedupNewFiles(dir string, parsed map[string]bool) {
	logger := applog.Subsystem("dedup")
	ingested, err := a.store.LoadIngestedFiles()
	if err != nil {
		logger.Error("load registry failed; skipping dedup", "err", err)
		return
	}
	// Standing duplicates are already in `parsed` — parsedSkipSet owns that
	// marking so the pending count sees the same set (standingDuplicates).
	byHash := make(map[string]string, len(ingested))
	for f, rec := range ingested {
		if rec.DuplicateOf == "" {
			byHash[rec.ContentHash] = f
		}
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		logger.Error("read dir failed; skipping dedup", "err", err)
		return
	}
	for _, e := range entries {
		if outsideDedupScope(e, parsed, ingested) {
			continue
		}
		a.registerIngestedImage(logger, dir, e.Name(), parsed, byHash)
	}
}

// outsideDedupScope reports whether a directory entry needs no dedup work:
// not an image, already in the skip set, or already registered on a prior run.
func outsideDedupScope(e os.DirEntry, parsed map[string]bool, ingested map[string]db.IngestedFile) bool {
	if e.IsDir() {
		return true
	}
	base := e.Name()
	ext := strings.ToLower(filepath.Ext(base))
	if ext != ".png" && ext != ".jpg" && ext != ".jpeg" {
		return true
	}
	if parsed[base] {
		return true
	}
	_, seen := ingested[base]
	return seen // original already registered on a prior run
}

// registerIngestedImage hashes one new image and records it: a byte-identical
// copy of a registered original joins the skip set as a duplicate; anything
// else registers as a fresh original future copies can match.
func (a *App) registerIngestedImage(logger *slog.Logger, dir, base string, parsed map[string]bool, byHash map[string]string) {
	hash, err := hashFile(filepath.Join(dir, base))
	if err != nil {
		logger.Error("hash failed", "file", base, "err", err)
		return
	}
	if canonical, dup := byHash[hash]; dup && canonical != base {
		if err := a.store.UpsertIngestedFile(base, hash, canonical); err != nil {
			logger.Error("record duplicate failed", "file", base, "err", err)
			return
		}
		parsed[base] = true
		logger.Info("byte-identical copy skipped", "file", base, "duplicate_of", canonical)
		return
	}
	if err := a.store.UpsertIngestedFile(base, hash, ""); err != nil {
		logger.Error("record original failed", "file", base, "err", err)
		return
	}
	byHash[hash] = base
}

// standingDuplicates returns the filenames the registry already knows are
// byte-identical copies of another ingested file. They skip OCR on every
// later run — including ReParseAll, where the canonical re-parses instead —
// and they carry no parent-table row, so LoadAllFilenames can't see them.
// Best-effort like the rest of the skip set: a registry read failure just
// means nothing is suppressed and the copies get re-OCR'd.
func (a *App) standingDuplicates() map[string]bool {
	ingested, err := a.store.LoadIngestedFiles()
	if err != nil {
		applog.Subsystem("dedup").Error("load registry failed; standing duplicates not skipped", "err", err)
		return nil
	}
	dupes := map[string]bool{}
	for f, rec := range ingested {
		if rec.DuplicateOf != "" {
			dupes[f] = true
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
