package dbtest

import (
	"slices"
	"time"

	"recall/pkg/db"
)

// The sent ledger, in memory. Same contract as the SQL store: append with
// the keys in order, list newest first.

func (f *Fake) RecordShareExport(handle, message, savedPath string, matchKeys []string) (db.ShareExport, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.shareExportSeq++
	e := db.ShareExport{
		ID:         f.shareExportSeq,
		Handle:     handle,
		Message:    message,
		ExportedAt: time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		SavedPath:  savedPath,
		MatchKeys:  append([]string(nil), matchKeys...),
	}
	f.shareExports = append(f.shareExports, e)
	return cloneShareExport(e), nil
}

func (f *Fake) ListShareExports() ([]db.ShareExport, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]db.ShareExport, 0, len(f.shareExports))
	for _, v := range slices.Backward(f.shareExports) {
		out = append(out, cloneShareExport(v))
	}
	return out, nil
}

func cloneShareExport(e db.ShareExport) db.ShareExport {
	e.MatchKeys = append([]string(nil), e.MatchKeys...)
	return e
}
