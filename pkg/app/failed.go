package app

import "fmt"

// FailedFile is the wire shape for one OCR-failure ledger row — the
// Unknown tab's "Failed to read" triage section. Error carries the most
// recent attempt's message verbatim; Attempts counts every failed run
// since FirstFailedAt.
//
// Two kinds of row live here. A file that FAILED to parse stored nothing,
// so it stays in the pending set and is re-attempted on every parse run
// (the ledger is visibility, not a skip list). A file that parsed but came
// back DEGRADED (parser.MatchResult.Warnings — an unreadable stat cell, a
// hero card that lost its timing) stored what it read and is therefore
// already out of the pending set: it is re-attempted only when the user
// asks, via Re-parse all screenshots. Either way the row clears when a
// later parse comes back clean, or when the user deletes the file forever.
type FailedFile struct {
	Filename      string `json:"filename"`
	Error         string `json:"error"`
	Attempts      int    `json:"attempts"`
	FirstFailedAt string `json:"first_failed_at"`
	LastFailedAt  string `json:"last_failed_at"`
}

// GetFailedFiles returns the OCR-failure ledger, most recently failed
// first. Wails-bound; server mode serves it at
// GET /api/v1/screenshots/failed.
func (a *App) GetFailedFiles() ([]FailedFile, error) {
	rows, err := a.store.ListFailedFiles()
	if err != nil {
		return nil, fmt.Errorf("list failed files: %w", err)
	}
	out := make([]FailedFile, len(rows))
	for i, r := range rows {
		out[i] = FailedFile{
			Filename:      r.Filename,
			Error:         r.Error,
			Attempts:      r.Attempts,
			FirstFailedAt: r.FirstFailedAt,
			LastFailedAt:  r.LastFailedAt,
		}
	}
	return out, nil
}
