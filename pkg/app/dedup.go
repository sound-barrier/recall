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
	base := e.Name()
	if !isImageEntry(e) || parsed[base] {
		return true
	}
	_, seen := ingested[base]
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
	if !a.claimScreenshot(hash, base) {
		parsed[base] = true
		logger.Info("screenshot owned by another profile skipped", "file", base)
		return
	}
	if err := a.store.UpsertIngestedFile(base, hash, ""); err != nil {
		logger.Error("record original failed", "file", base, "err", err)
		return
	}
	byHash[hash] = base
}

// claimScreenshot records the active profile as the owner of a screenshot
// it is about to parse, and reports whether the active profile owns it.
// claimedElsewhere has already filtered out what other profiles own, so a
// false here is the narrow case of a claim landing in between. Best-effort
// like the rest of dedup: a ledger error lets the parse proceed.
func (a *App) claimScreenshot(hash, base string) bool {
	if a.claims == nil || a.profiles == nil {
		return true
	}
	active := a.profiles.Active()
	owner, err := a.claims.Claim(hash, active, base)
	if err != nil {
		applog.Subsystem("claims").Error("claim failed; parsing anyway", "file", base, "err", err)
		return true
	}
	return owner == active
}

// registeredHashes snapshots the content-hash registry's originals,
// filename -> hash. nil on a read failure.
func (a *App) registeredHashes() map[string]string {
	ingested, err := a.store.LoadIngestedFiles()
	if err != nil {
		applog.Subsystem("claims").Error("load registry failed", "err", err)
		return nil
	}
	hashes := make(map[string]string, len(ingested))
	for f, rec := range ingested {
		if rec.DuplicateOf == "" {
			hashes[f] = rec.ContentHash
		}
	}
	return hashes
}

// forgottenSince returns the screenshots registered in before that the
// registry no longer holds, filename -> hash. A hard delete or a move's
// source-side delete drops exactly the affected matches' files, so this is
// what they owned.
func (a *App) forgottenSince(before map[string]string) map[string]string {
	if len(before) == 0 {
		return nil
	}
	after := a.registeredHashes()
	if after == nil {
		return nil
	}
	gone := map[string]string{}
	for f, hash := range before {
		if _, kept := after[f]; !kept {
			gone[f] = hash
		}
	}
	return gone
}

// releaseForgotten frees the claims on the screenshots a hard delete took.
func (a *App) releaseForgotten(before map[string]string) {
	if a.claims == nil || a.profiles == nil {
		return
	}
	for f, hash := range a.forgottenSince(before) {
		a.releaseClaim(hash, f)
	}
}

// transferForgotten hands target the claims on the screenshots a move took
// from this profile.
func (a *App) transferForgotten(before map[string]string, target string) {
	if a.claims == nil {
		return
	}
	for f, hash := range a.forgottenSince(before) {
		if err := a.claims.Transfer(hash, target, f); err != nil {
			applog.Subsystem("claims").Error("transfer claim failed", "file", f, "target", target, "err", err)
		}
	}
}

// releaseScreenshot frees the active profile's claim on one screenshot,
// found by its registered hash or, for a file the registry never saw, by
// hashing it in the screenshots folder.
func (a *App) releaseScreenshot(filename string, registered map[string]string) {
	if a.claims == nil || a.profiles == nil {
		return
	}
	hash, ok := registered[filename]
	if !ok {
		dir := a.settingsSnapshot().ScreenshotsDir
		if dir == "" {
			return
		}
		h, err := hashFile(filepath.Join(dir, filepath.Base(filename)))
		if err != nil {
			return
		}
		hash = h
	}
	a.releaseClaim(hash, filename)
}

func (a *App) releaseClaim(hash, filename string) {
	if err := a.claims.Release(hash, a.profiles.Active()); err != nil {
		applog.Subsystem("claims").Error("release claim failed", "file", filename, "err", err)
	}
}

// claimedElsewhere returns the images in dir that another profile already
// owns, matched by content hash so a renamed copy still counts. own is the
// set of filenames this profile already holds rows for: those stay this
// profile's even when another profile holds the same bytes (duplicates that
// predate the ledger are left as they are). Each file is hashed once per
// profile and cached as a sighting; with no foreign claims at all (a single
// profile) nothing is hashed. Best-effort: a ledger or read error suppresses
// nothing.
func (a *App) claimedElsewhere(dir string, own map[string]bool) map[string]bool {
	if a.claims == nil || a.profiles == nil {
		return nil
	}
	logger := applog.Subsystem("claims")
	active := a.profiles.Active()
	foreign, seen := a.foreignClaims(logger, active)
	if len(foreign) == 0 {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	elsewhere := map[string]bool{}
	for _, e := range entries {
		if !isImageEntry(e) || own[e.Name()] {
			continue
		}
		if hash := a.sightedHash(logger, active, filepath.Join(dir, e.Name()), seen); foreign[hash] {
			elsewhere[e.Name()] = true
		}
	}
	return elsewhere
}

// foreignClaims loads the hashes other profiles own and the active
// profile's cached sightings. Both are nil on a ledger error, which
// suppresses nothing.
func (a *App) foreignClaims(logger *slog.Logger, active string) (foreign map[string]bool, seen map[string]string) {
	foreign, err := a.claims.OwnedByOthers(active)
	if err != nil {
		logger.Error("load foreign claims failed; nothing suppressed", "err", err)
		return nil, nil
	}
	if len(foreign) == 0 {
		return nil, nil
	}
	seen, err = a.claims.Sightings(active)
	if err != nil {
		logger.Error("load sightings failed; nothing suppressed", "err", err)
		return nil, nil
	}
	return foreign, seen
}

// sightedHash returns the cached hash of path for the active profile,
// hashing and caching it on first sight. "" on a read failure.
func (a *App) sightedHash(logger *slog.Logger, active, path string, seen map[string]string) string {
	if hash, ok := seen[path]; ok {
		return hash
	}
	hash, err := hashFile(path)
	if err != nil {
		logger.Error("hash failed", "file", filepath.Base(path), "err", err)
		return ""
	}
	if err := a.claims.RecordSighting(active, path, hash); err != nil {
		logger.Error("record sighting failed", "file", filepath.Base(path), "err", err)
	}
	return hash
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
