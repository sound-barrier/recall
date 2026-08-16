package app

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"recall/pkg/bundle"
	"recall/pkg/coach"
)

// The two identities coaching needs, both persisted in Settings: the name
// this user signs notes with as a COACH, and the id + handle they are known
// by as a PLAYER.

// ErrCoachNameInvalid maps to 400 — the coach name is longer than a name
// can be. Empty is legal: it means "not set yet", and export refuses on
// coach.ErrCoachNameRequired instead.
var ErrCoachNameInvalid = errors.New("invalid coach name")

// CoachingSettings is the wire shape of the coaching settings row.
type CoachingSettings struct {
	CoachName string `json:"coach_name"`
}

// GetCoachingSettings returns the coaching settings. An empty CoachName is
// the "not set yet" state the Export affordance disables on.
func (a *App) GetCoachingSettings() CoachingSettings {
	return CoachingSettings{CoachName: a.settingsSnapshot().CoachName}
}

// SetCoachingSettings persists the name this user signs notes with,
// trimmed. Passing "" clears it.
func (a *App) SetCoachingSettings(coachName string) (CoachingSettings, error) {
	coachName = strings.TrimSpace(coachName)
	if utf8.RuneCountInString(coachName) > maxCoachHandleRunes {
		return CoachingSettings{}, fmt.Errorf("%w: exceeds %d characters", ErrCoachNameInvalid, maxCoachHandleRunes)
	}
	snap := a.mutateSettings(func(s *Settings) { s.CoachName = coachName })
	if err := a.saveSettings(snap); err != nil {
		return CoachingSettings{}, err
	}
	return CoachingSettings{CoachName: snap.CoachName}, nil
}

// shareIdentity resolves the identity a share-mode export stamps into the
// manifest. The stable player id is minted on the first share and kept
// forever; the handle defaults to the last one used, so a repeat share
// needs no re-typing. Both are persisted before the export so the id in a
// bundle already in someone else's hands is always the id on disk.
func (a *App) shareIdentity(player SharePlayer) (bundle.PlayerIdentity, error) {
	handle := strings.TrimSpace(player.Handle)
	if handle == "" {
		handle = a.settingsSnapshot().PlayerHandle
	}
	if handle == "" {
		return bundle.PlayerIdentity{}, fmt.Errorf("%w: a handle is required to share with a coach", bundle.ErrPlayerIdentityInvalid)
	}
	snap := a.mutateSettings(func(s *Settings) {
		if s.PlayerID == "" {
			s.PlayerID = coach.NewID()
		}
		s.PlayerHandle = handle
	})
	if err := a.saveSettings(snap); err != nil {
		return bundle.PlayerIdentity{}, err
	}
	return bundle.PlayerIdentity{ID: snap.PlayerID, Handle: handle, Message: player.Message}, nil
}
