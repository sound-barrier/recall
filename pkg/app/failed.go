package app

import "fmt"

// FailedFile is the wire shape for one OCR-failure ledger row — the
// Unknown tab's "Failed to read" triage section. Error carries the most
// recent attempt's message verbatim; Attempts counts every failed run
// since FirstFailedAt. Failed files are re-attempted on every parse run
// (the ledger is visibility, not a skip list), so the list shrinks only
// when a file finally parses or the user deletes it forever.
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
