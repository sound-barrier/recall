package app

import (
	"log/slog"
	"os"
	"path/filepath"

	"recall/pkg/applog"
)

// Cross-profile screenshot ownership. A screenshot belongs to the first
// profile that parses it (the install-wide ledger is pkg/profiles/claims.go);
// these are the shell's hooks into it: claim on parse, skip what another
// profile owns, release on delete and dismiss, hand over on a move. Every
// hook is best-effort and a no-op when the ledger is nil (tests wired via
// NewWithStore), so ownership can cost a parse nothing worse than a skipped
// suppression.

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
