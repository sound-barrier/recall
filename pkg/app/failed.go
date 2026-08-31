package app

import (
	"fmt"

	"recall/pkg/matchedit"
)

// parkedAttemptCap is how many failed parse attempts a file gets before
// normal runs stop retrying it (it is PARKED — skipped by the run and
// gone from the pending count, visible in the Failed section with a
// Retry). Attempts count once per run, and a deterministic failure fails
// identically forever; 3 is the smallest cap that forgives two
// independent transient events (the watcher firing on a half-written
// file, a tesseract hiccup) without retrying a corrupt file for the rest
// of time. Re-parse All bypasses the cap; Retry deletes the ledger row,
// which resets it.
const parkedAttemptCap = 3

// FailedFile is the wire shape for one OCR-failure ledger row — the
// Unknown tab's "Failed to read" triage section. Error carries the most
// recent attempt's message verbatim; Attempts counts every failed run
// since FirstFailedAt.
//
// Two kinds of row live here. A file that FAILED to parse stored nothing,
// so it stays in the pending set and is re-attempted — until it reaches
// parkedAttemptCap and parks (Parked = true; a normal run skips it, an
// explicit Re-parse All or Retry re-attempts it). A file that parsed but
// came back DEGRADED (parser.MatchResult.Warnings — an unreadable stat
// cell, a hero card that lost its timing) stored what it read and is
// therefore already out of the pending set whatever its attempt count:
// it is never Parked, and re-attempts only via Re-parse all screenshots.
// Either way the row clears when a later parse comes back clean, or when
// the user dismisses the file.
type FailedFile struct {
	Filename      string `json:"filename"`
	Error         string `json:"error"`
	Attempts      int    `json:"attempts"`
	Parked        bool   `json:"parked"`
	FirstFailedAt string `json:"first_failed_at"`
	LastFailedAt  string `json:"last_failed_at"`
}

// RetryFailedFile deletes filename's failure row — the Retry on a
// parked card. The row IS the attempt count, so deleting it resets the
// cap; a PARKED (unstored) file re-enters the pending count and the
// next run on the spot, while a stored file (degraded, or the ambiguity
// leg) merely loses its triage entry — it stays in the skip set until a
// Re-parse All, which is why the UI offers Retry only on parked rows.
// Idempotent on absent rows; write-gated like every other mutation
// while a coach session holds the DB read-only.
func (a *App) RetryFailedFile(filename string) error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	if filename == "" {
		return matchedit.ErrIgnoreFilenameRequired
	}
	if err := a.store.RemoveFailedFile(filename); err != nil {
		return fmt.Errorf("remove failed file %s: %w", filename, err)
	}
	return nil
}

// GetFailedFiles returns the OCR-failure ledger, most recently failed
// first. Wails-bound; server mode serves it at
// GET /api/v1/screenshots/failed.
func (a *App) GetFailedFiles() ([]FailedFile, error) {
	rows, err := a.store.ListFailedFiles()
	if err != nil {
		return nil, fmt.Errorf("list failed files: %w", err)
	}
	// Parked is derived, not stored: at the cap AND stored nothing in
	// the ROW'S OWN dir — a degraded row has parent rows there, so it
	// never reads as parked, while a same-named capture stored under a
	// different folder is a different screenshot and masks nothing.
	storedByDir := map[int64]map[string]bool{}
	out := make([]FailedFile, len(rows))
	for i, r := range rows {
		stored, ok := storedByDir[r.ScreenshotsDirID]
		if !ok {
			var err error
			stored, err = a.store.LoadFilenamesForDir(r.ScreenshotsDirID)
			if err != nil {
				return nil, fmt.Errorf("load stored filenames: %w", err)
			}
			storedByDir[r.ScreenshotsDirID] = stored
		}
		out[i] = FailedFile{
			Filename:      r.Filename,
			Error:         r.Error,
			Attempts:      r.Attempts,
			Parked:        r.Attempts >= parkedAttemptCap && !stored[r.Filename],
			FirstFailedAt: r.FirstFailedAt,
			LastFailedAt:  r.LastFailedAt,
		}
	}
	return out, nil
}
