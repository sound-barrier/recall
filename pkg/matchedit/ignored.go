package matchedit

import (
	"errors"
	"fmt"

	"recall/pkg/db"
)

// ErrIgnoreFilenameRequired is the typed sentinel HTTP handlers
// errors.Is against to map "missing filename in URL" to a 400.
var ErrIgnoreFilenameRequired = errors.New("filename is required")

// IgnoreScreenshot adds `filename` to the suppress-list backing the
// Unknown tab's Dismiss affordance. Future parse runs skip any file
// whose name matches; the file on disk is untouched, and the Settings
// "Manage ignored files" panel can restore it.
//
// Only the file's OWN contribution leaves the corpus. Its rows across
// the screenshot tables go (DeleteScreenshotRows), and any match key
// those rows were the last backing of is fully hard-deleted so no
// sidecar — annotation, review, hidden flag — strands on a dead key.
// A match with sibling screenshots survives minus this file: dismissing
// one bad screenshot of a good match must not delete the match, and
// must not unregister the siblings' dedup rows (which would re-OCR
// them on the next run and resurrect the match — the bug the previous
// wipe-every-key-the-filename-touches contract shipped).
//
// Idempotent: ignoring an already-ignored filename refreshes the
// timestamp; a filename with no rows anywhere just joins the list.
func IgnoreScreenshot(s db.Store, filename string) error {
	if filename == "" {
		return ErrIgnoreFilenameRequired
	}
	if err := s.AddIgnoredScreenshot(filename); err != nil {
		return fmt.Errorf("add ignored screenshot: %w", err)
	}
	// An ignored file is skipped on every future run, so a standing
	// OCR-failure row would sit in the triage list forever — clear it.
	if err := s.RemoveFailedFile(filename); err != nil {
		return fmt.Errorf("clear failed-file row for %s: %w", filename, err)
	}
	orphans, err := s.DeleteScreenshotRows(filename)
	if err != nil {
		return fmt.Errorf("delete screenshot rows for %s: %w", filename, err)
	}
	for _, key := range orphans {
		if err := s.HardDeleteMatch(key); err != nil {
			return fmt.Errorf("hard delete match for %s: %w", key, err)
		}
	}
	return nil
}

// UnignoreScreenshot removes `filename` from the suppress-list so
// the next parse re-ingests it. Idempotent on absent filenames.
// Surfaced for completeness; no UI affordance ships in PR 4 (debug /
// future "show ignored" panel).
func UnignoreScreenshot(s db.Store, filename string) error {
	if filename == "" {
		return ErrIgnoreFilenameRequired
	}
	return s.RemoveIgnoredScreenshot(filename)
}

// IgnoredScreenshot is the wire shape returned by ListIgnoredScreenshots.
// `Filename` is the raw filename the suppress-list keys on; `IgnoredAt`
// is the server-assigned timestamp the Settings panel renders so users
// can tell recent ignores from old ones.
type IgnoredScreenshot struct {
	Filename  string `json:"filename"`
	IgnoredAt string `json:"ignored_at"`
}

// ListIgnoredScreenshots returns the suppress-list with timestamps,
// sorted most-recently-ignored first. Backs the Settings "Manage
// ignored files" panel.
func ListIgnoredScreenshots(s db.Store) ([]IgnoredScreenshot, error) {
	rows, err := s.ListIgnoredScreenshots()
	if err != nil {
		return nil, fmt.Errorf("list ignored screenshots: %w", err)
	}
	out := make([]IgnoredScreenshot, len(rows))
	for i, r := range rows {
		out[i] = IgnoredScreenshot{Filename: r.Filename, IgnoredAt: r.IgnoredAt}
	}
	return out, nil
}

// ClearIgnoredScreenshots truncates the suppress-list — the bulk
// "Re-enable all" action on the Settings panel. After the call, the
// next Parse run will re-discover every previously-ignored file from
// disk (the on-disk files never moved). Idempotent on an empty list.
func ClearIgnoredScreenshots(s db.Store) error {
	if err := s.ClearIgnoredScreenshots(); err != nil {
		return fmt.Errorf("clear ignored screenshots: %w", err)
	}
	return nil
}
