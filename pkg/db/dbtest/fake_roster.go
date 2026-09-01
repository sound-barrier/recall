package dbtest

import (
	"cmp"
	"slices"
	"time"

	"recall/pkg/db"
)

// The saved roster, in memory. Same contract as the SQL store: the tag is the
// identity, LoadRoster is ordered by display name, AddedAt survives an edit,
// and Clear leaves the whole family alone — a roster is a list of people, not
// match history.

func (f *Fake) LoadRoster() ([]db.RosterMember, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := slices.Clone(f.Roster)
	slices.SortFunc(out, func(a, b db.RosterMember) int {
		if c := cmp.Compare(a.DisplayName, b.DisplayName); c != 0 {
			return c
		}
		return cmp.Compare(a.Tag, b.Tag)
	})
	return out, nil
}

func (f *Fake) SetRosterMember(m db.RosterMember) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, existing := range f.Roster {
		if existing.Tag != m.Tag {
			continue
		}
		// An edit is not a re-add: the day they joined the roster is kept,
		// exactly as the SQL store leaves added_at out of its SET clause.
		m.AddedAt = existing.AddedAt
		f.Roster[i] = m
		return nil
	}
	if m.AddedAt == "" {
		m.AddedAt = time.Now().UTC().Format("2006-01-02T15:04:05Z")
	}
	f.Roster = append(f.Roster, m)
	return nil
}

func (f *Fake) DeleteRosterMember(tag string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Roster = slices.DeleteFunc(f.Roster, func(m db.RosterMember) bool { return m.Tag == tag })
	return nil
}
