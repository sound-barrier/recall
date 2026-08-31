package dbtest

import (
	"sort"

	"recall/pkg/db"
)

// The coach's own sittings, mirrored. Same contract the SQL store answers:
// a row written at open, filed under a player later, stamped and frozen at
// end, and an unstamped row kept as an abandoned sitting.

func (f *Fake) StartCoachSession(row db.CoachSessionRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.CoachSessions == nil {
		f.CoachSessions = map[string]db.CoachSessionRow{}
	}
	if _, exists := f.CoachSessions[row.SessionID]; exists {
		return nil // ON CONFLICT DO NOTHING
	}
	if row.OpenedAt == "" {
		row.OpenedAt = nowRFC3339()
	}
	if row.Kind == "" {
		row.Kind = db.CoachKindPlayer
	}
	f.CoachSessions[row.SessionID] = row
	return nil
}

func (f *Fake) PointCoachSessionAt(sessionID string, playerRef int64, handle, kind string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	row, ok := f.CoachSessions[sessionID]
	if !ok {
		return nil
	}
	row.PlayerRef = playerRef
	row.Handle = handle
	if kind != "" {
		row.Kind = kind
	}
	f.CoachSessions[sessionID] = row
	return nil
}

func (f *Fake) EndCoachSession(sessionID string, focus []db.CoachSessionFocusRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	row, ok := f.CoachSessions[sessionID]
	if !ok {
		return nil
	}
	row.EndedAt = nowRFC3339()
	row.FocusItems = append([]db.CoachSessionFocusRow(nil), focus...)
	f.CoachSessions[sessionID] = row
	return nil
}

func (f *Fake) ListCoachSessions(playerRef int64) ([]db.CoachSessionRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []db.CoachSessionRow
	for _, row := range f.CoachSessions {
		if row.PlayerRef == playerRef {
			out = append(out, row)
		}
	}
	// Newest first, session id breaking the tie — the SQL store's ORDER BY,
	// and the Fake's clock is coarse enough that ties are the common case.
	sort.Slice(out, func(i, j int) bool {
		if out[i].OpenedAt != out[j].OpenedAt {
			return out[i].OpenedAt > out[j].OpenedAt
		}
		return out[i].SessionID > out[j].SessionID
	})
	return out, nil
}
