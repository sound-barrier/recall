package db

import "fmt"

// The player's saved roster — the BattleTags they queue with, and the names
// they actually call those people.
//
// Deliberately NOT a foreign key for match_annotation_members. A teammate
// tagged before they were rostered has to keep working, and removing somebody
// from the roster must not erase them from the matches they played; the roster
// supplies display names and completions, nothing more. That is also why
// Clear() leaves it alone: a roster is a list of people, not match history.

// RosterMember is one saved teammate.
type RosterMember struct {
	// Tag is the identity — the BattleTag as it appears in a match's members
	// list, which is what a lookup joins on.
	Tag string `json:"tag"`
	// DisplayName is what the chip shows instead of the tag.
	DisplayName string `json:"display_name"`
	Note        string `json:"note,omitempty"`
	AddedAt     string `json:"added_at,omitempty"`
}

// RosterStore is the saved-roster surface. Small enough to be one interface,
// separate from the match-history families because nothing here is keyed on a
// match.
type RosterStore interface {
	// LoadRoster returns every saved teammate, ordered by display name so a
	// completion list reads alphabetically rather than by insertion.
	LoadRoster() ([]RosterMember, error)
	// SetRosterMember inserts or updates by Tag. AddedAt is stamped on first
	// insert and preserved across later edits.
	SetRosterMember(m RosterMember) error
	// DeleteRosterMember removes one tag. Removing a tag that was never
	// rostered is not an error — the caller's intent holds either way.
	DeleteRosterMember(tag string) error
}

func (s *SQLStore) LoadRoster() ([]RosterMember, error) {
	rows, err := s.db.Query(
		`SELECT tag, display_name, note, added_at FROM roster_members ORDER BY display_name, tag`)
	if err != nil {
		return nil, fmt.Errorf("load roster: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := []RosterMember{}
	for rows.Next() {
		var m RosterMember
		if err := rows.Scan(&m.Tag, &m.DisplayName, &m.Note, &m.AddedAt); err != nil {
			return nil, fmt.Errorf("scan roster: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *SQLStore) SetRosterMember(m RosterMember) error {
	// added_at stays out of the SET clause for the same reason parsed_at does:
	// an edit is not a re-add, and the day somebody joined the roster is worth
	// keeping.
	_, err := s.db.Exec(
		`INSERT INTO roster_members (tag, display_name, note, added_at)
		 VALUES (?, ?, ?, `+suppliedInstantOrNow+`)
		 ON CONFLICT(tag) DO UPDATE SET display_name = excluded.display_name, note = excluded.note`,
		m.Tag, m.DisplayName, m.Note, m.AddedAt)
	if err != nil {
		return fmt.Errorf("set roster member %q: %w", m.Tag, err)
	}
	return nil
}

func (s *SQLStore) DeleteRosterMember(tag string) error {
	if _, err := s.db.Exec(`DELETE FROM roster_members WHERE tag = ?`, tag); err != nil {
		return fmt.Errorf("delete roster member %q: %w", tag, err)
	}
	return nil
}
