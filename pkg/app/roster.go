package app

import (
	"errors"
	"fmt"
	"strings"

	"recall/pkg/db"
)

// The player's saved roster: the BattleTags they queue with, and the names
// they actually call those people.
//
// A tagged teammate is free text and stays free text — the roster supplies
// display names and completions, and un-rostering somebody must not erase them
// from the matches they played. That is the whole contract; there is no join.

// ErrRosterTagEmpty is returned when a save carries no tag. The tag is the
// identity, so a blank one has nothing to be.
var ErrRosterTagEmpty = errors.New("roster: a teammate needs a tag")

// Roster returns every saved teammate, ordered by display name.
func (a *App) Roster() ([]db.RosterMember, error) {
	members, err := a.store.LoadRoster()
	if err != nil {
		return nil, fmt.Errorf("roster: load: %w", err)
	}
	return members, nil
}

// SaveRosterMember adds or renames one teammate. The display name defaults to
// the tag, because a roster entry with no name shows nothing where the chip
// used to show something.
func (a *App) SaveRosterMember(m db.RosterMember) error {
	// The one lock: while a coach session is open the app is looking at
	// somebody else's history, and this list is the player's own.
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	m.Tag = strings.TrimSpace(m.Tag)
	if m.Tag == "" {
		return ErrRosterTagEmpty
	}
	m.DisplayName = strings.TrimSpace(m.DisplayName)
	if m.DisplayName == "" {
		m.DisplayName = m.Tag
	}
	m.Note = strings.TrimSpace(m.Note)
	if err := a.store.SetRosterMember(m); err != nil {
		return fmt.Errorf("roster: save %q: %w", m.Tag, err)
	}
	return nil
}

// RemoveRosterMember drops one teammate from the roster. The matches they were
// tagged on keep the tag — this list is a lookup, not a foreign key.
func (a *App) RemoveRosterMember(tag string) error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	if err := a.store.DeleteRosterMember(strings.TrimSpace(tag)); err != nil {
		return fmt.Errorf("roster: remove %q: %w", tag, err)
	}
	return nil
}
