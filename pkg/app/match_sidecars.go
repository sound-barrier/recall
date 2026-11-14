package app

import (
	"recall/pkg/applog"
	"recall/pkg/db"
	"recall/pkg/matchedit"
)

// The per-match sidecar surface: annotation, review, queue, play mode,
// visibility, and the ignored-screenshot suppress list. Every rule these
// writes obey — input validation, the unknown-key guard, the store call —
// lives in pkg/matchedit. What stays here is the orchestration the leaf
// cannot see: design rule 1's coaching-session write gate, which every
// mutating method enters through useStoreForWrite and holds until the
// write is done (coach_gate_test.go enumerates them).

// SetMatchAnnotation upserts a per-match annotation. Upsert-only: an
// all-empty input is rejected with ErrEmptyAnnotation rather than
// silently deleting, so the API verb states intent (clearing is
// DeleteMatchAnnotation).
func (a *App) SetMatchAnnotation(in AnnotationInput) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.SetAnnotation(store, in)
}

// DeleteMatchAnnotation removes a match's annotation row entirely
// (members and tags cascade away with it). Idempotent.
func (a *App) DeleteMatchAnnotation(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.DeleteAnnotation(store, matchKey)
}

// SetMatchReview tags a match as reviewed by the user themselves
// ('self') or by a coach ('coach'). Idempotent; a different reviewer
// overwrites. Use ClearMatchReview to revert to "not reviewed".
func (a *App) SetMatchReview(matchKey, reviewedBy string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.SetReview(store, matchKey, reviewedBy)
}

// ClearMatchReview removes the review-status tag. Idempotent.
func (a *App) ClearMatchReview(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.ClearReview(store, matchKey)
}

// SetMatchQueue tags a match as having been played in role queue (5v5)
// or open queue (6v6). Idempotent; a different value overwrites. Use
// ClearMatchQueue to revert to "queue not set".
func (a *App) SetMatchQueue(matchKey, queueType string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.SetQueue(store, matchKey, queueType)
}

// ClearMatchQueue removes the queue-type tag. Idempotent.
func (a *App) ClearMatchQueue(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.ClearQueue(store, matchKey)
}

// BulkSetMatchQueue applies the same queue_type to every key in the
// slice in one transaction. queueType="" clears the rows.
func (a *App) BulkSetMatchQueue(matchKeys []string, queueType string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.BulkSetQueue(store, matchKeys, queueType)
}

// SetMatchPlayMode overrides the parser's play-mode read for a specific
// match. Idempotent; a different value overwrites. Use
// ClearMatchPlayMode to revert to "follow the parser".
func (a *App) SetMatchPlayMode(matchKey, playMode string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.SetPlayMode(store, matchKey, playMode)
}

// ClearMatchPlayMode removes the override row. Idempotent.
func (a *App) ClearMatchPlayMode(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.ClearPlayMode(store, matchKey)
}

// BulkSetMatchPlayMode applies the same play_mode to every key in the
// slice in one transaction. playMode="" clears the rows.
func (a *App) BulkSetMatchPlayMode(matchKeys []string, playMode string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.BulkSetPlayMode(store, matchKeys, playMode)
}

// HideMatch soft-deletes a match. The screenshot rows are untouched, so
// a re-parse still skips them; the aggregator sets Record.Hidden on the
// next read and the default filter drops the row. Idempotent.
func (a *App) HideMatch(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.Hide(store, matchKey)
}

// UnhideMatch removes the soft-delete flag. Idempotent.
func (a *App) UnhideMatch(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.Unhide(store, matchKey)
}

// AcknowledgeReferenceGap dismisses a match's reference-data-gap
// warning on the Unknown tab — the match stays; only the warning hides,
// restorably. Idempotent.
func (a *App) AcknowledgeReferenceGap(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.AcknowledgeReferenceGap(store, matchKey)
}

// UnacknowledgeReferenceGap restores the warning. Idempotent.
func (a *App) UnacknowledgeReferenceGap(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.UnacknowledgeReferenceGap(store, matchKey)
}

// PinMatch stars a match — the list renders pinned matches in a leading
// section above the date groups. Idempotent.
func (a *App) PinMatch(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.Pin(store, matchKey)
}

// UnpinMatch removes the star. Idempotent.
func (a *App) UnpinMatch(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.Unpin(store, matchKey)
}

// HardDeleteMatch wipes every row keyed on matchKey from the database and
// releases this profile's claims on its screenshots. Surfaced by the Hidden drawer's Delete affordance — the user has
// already archived the match and explicitly confirmed. Idempotent.
func (a *App) HardDeleteMatch(matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	registered := a.registeredHashes()
	if err := matchedit.HardDelete(store, matchKey); err != nil {
		return err
	}
	// Its screenshots are no longer this profile's: another may parse them.
	a.releaseForgotten(registered)
	// The match took its moments with it; their frames are now unreferenced.
	a.collectOrphanFrames()
	return nil
}

// IgnoreScreenshot adds filename to the suppress-list backing the
// Unknown tab's Dismiss affordance, releases this profile's claim on it so
// another profile may parse it, and removes the file's own rows —
// a match this was the last screenshot of disappears now (sidecars
// wiped), while one with sibling screenshots survives minus this file.
// Idempotent.
func (a *App) IgnoreScreenshot(filename string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	registered := a.registeredHashes()
	if err := matchedit.IgnoreScreenshot(store, filename); err != nil {
		return err
	}
	// Dismissed here means free for another profile to parse.
	a.releaseScreenshot(filename, registered)
	// A match this was the last screenshot of is gone now, sidecars and all —
	// including moments whose frames nothing points at any more.
	a.collectOrphanFrames()
	return nil
}

// UnignoreScreenshot removes filename from the suppress-list so the next
// parse re-ingests it. Idempotent on absent filenames.
func (a *App) UnignoreScreenshot(filename string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.UnignoreScreenshot(store, filename)
}

// GetIgnoredScreenshots returns the suppress-list with timestamps,
// most-recently-ignored first. A read, so no session gate: a coach
// reviewing a loaned corpus can still see what it suppresses.
func (a *App) GetIgnoredScreenshots() ([]IgnoredScreenshot, error) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return nil, leaseErr
	}
	defer release()
	return matchedit.ListIgnoredScreenshots(store)
}

// ClearIgnoredScreenshots truncates the suppress-list — the bulk
// "Re-enable all" action on the Settings panel. Idempotent.
func (a *App) ClearIgnoredScreenshots() error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	return matchedit.ClearIgnoredScreenshots(store)
}

// SetMatchMoment saves one of the player's own timestamped moments —
// a self-review that can point at seconds the way a coach's review can.
// An empty momentID mints a new one.
func (a *App) SetMatchMoment(matchKey, momentID string, in matchedit.MomentInput) (db.MatchMoment, error) {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return db.MatchMoment{}, leaseErr
	}
	defer release()
	saved, err := matchedit.SetMoment(store, matchKey, momentID, in)
	if err != nil {
		return db.MatchMoment{}, err
	}
	// A moment can REPLACE its frame, which strands the one it had. Swapping a
	// picture three times would otherwise leave two dead images per moment.
	a.collectOrphanFrames()
	return saved, nil
}

// DeleteMatchMoment removes one of the player's moments. Idempotent.
func (a *App) DeleteMatchMoment(matchKey, momentID string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	if err := store.DeleteMatchMoment(matchKey, momentID); err != nil {
		return err
	}
	// The picture it pointed at may now be unreferenced. Collected here rather
	// than by a refcount because a moment is not the only thing that can stop
	// pointing at an image — a coach note taking its moments with it does the
	// same, through a cascade this layer never sees. A failed sweep is not a
	// failed delete: the moment IS gone, and the bytes are collected on the
	// next one.
	a.collectOrphanFrames()
	return nil
}

// collectOrphanFrames sweeps up attachment bytes nothing points at any more.
//
// Called from every path that can drop or replace a moment — deleting one,
// deleting the match under it, and suppressing the last screenshot a match
// had. A failed sweep is never a failed operation: the thing the caller asked
// for HAS happened, and the bytes are collected on the next one.
func (a *App) collectOrphanFrames() {
	if _, err := a.PruneMomentImages(); err != nil {
		applog.Subsystem("matches").Warn("could not collect unreferenced moment images", "err", err)
	}
}
