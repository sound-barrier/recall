package app

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"

	"recall/pkg/applog"
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
	byHash := make(map[string]string, len(ingested))
	for f, rec := range ingested {
		if rec.DuplicateOf == "" {
			byHash[rec.ContentHash] = f
		} else {
			// Standing duplicates stay skipped on every later run —
			// including ReParseAll, where the canonical re-parses.
			parsed[f] = true
		}
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		logger.Error("read dir failed; skipping dedup", "err", err)
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		base := e.Name()
		ext := strings.ToLower(filepath.Ext(base))
		if ext != ".png" && ext != ".jpg" && ext != ".jpeg" {
			continue
		}
		if parsed[base] {
			continue
		}
		if _, seen := ingested[base]; seen {
			continue // original already registered on a prior run
		}
		hash, err := hashFile(filepath.Join(dir, base))
		if err != nil {
			logger.Error("hash failed", "file", base, "err", err)
			continue
		}
		canonical, dup := byHash[hash]
		if dup && canonical != base {
			if err := a.store.UpsertIngestedFile(base, hash, canonical); err != nil {
				logger.Error("record duplicate failed", "file", base, "err", err)
				continue
			}
			parsed[base] = true
			logger.Info("byte-identical copy skipped", "file", base, "duplicate_of", canonical)
			continue
		}
		if err := a.store.UpsertIngestedFile(base, hash, ""); err != nil {
			logger.Error("record original failed", "file", base, "err", err)
			continue
		}
		byHash[hash] = base
	}
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
