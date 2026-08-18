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

// ErrNoPlayerHandle maps to 409 — a share arrived with a blank handle and
// this install has none remembered to fall back on. 409 rather than 400
// because the BODY is fine: a blank handle is a documented way to say "use
// the one from last time", and the refusal is about state, not shape. The
// same distinction ErrMomentEmpty and ErrEmptyAnnotation draw — and the one
// schemathesis's positive_data_acceptance check reads, since 400 there is a
// claim that schema-compliant data was malformed.
var ErrNoPlayerHandle = errors.New("no player handle to share under")

// CoachingSettings is the wire shape of the coaching settings row: the two
// identities, one per direction of the loop.
type CoachingSettings struct {
	CoachName    string `json:"coach_name"`
	PlayerHandle string `json:"player_handle"`
}

// GetCoachingSettings returns the coaching settings. An empty CoachName is
// the "not set yet" state the Export affordance disables on. PlayerHandle is
// the last handle shared under — shareIdentity has always fallen back to it,
// but nothing showed it, so the share dialog asked for it again every time.
func (a *App) GetCoachingSettings() CoachingSettings {
	snap := a.settingsSnapshot()
	return CoachingSettings{CoachName: snap.CoachName, PlayerHandle: snap.PlayerHandle}
}

// SetCoachingSettings persists both identities, trimmed. Passing "" for
// either clears it.
func (a *App) SetCoachingSettings(coachName, playerHandle string) (CoachingSettings, error) {
	coachName = strings.TrimSpace(coachName)
	playerHandle = strings.TrimSpace(playerHandle)
	for _, name := range []string{coachName, playerHandle} {
		if utf8.RuneCountInString(name) > maxCoachHandleRunes {
			return CoachingSettings{}, fmt.Errorf("%w: exceeds %d characters", ErrCoachNameInvalid, maxCoachHandleRunes)
		}
	}
	snap := a.mutateSettings(func(s *Settings) {
		s.CoachName = coachName
		s.PlayerHandle = playerHandle
	})
	if err := a.saveSettings(snap); err != nil {
		return CoachingSettings{}, err
	}
	return CoachingSettings{CoachName: snap.CoachName, PlayerHandle: snap.PlayerHandle}, nil
}

// shareIdentity resolves the identity a share-mode export stamps into the
// manifest. The stable player id is minted on the first share and kept
// forever; the handle defaults to the last one used, so a repeat share
// needs no re-typing. Both are persisted before the export so the id in a
// bundle already in someone else's hands is always the id on disk — which
// is why the handle is bounded HERE and not left to the packer: a handle
// the packer would reject must never be the one a later share remembers.
func (a *App) shareIdentity(player SharePlayer) (bundle.PlayerIdentity, error) {
	handle := strings.TrimSpace(player.Handle)
	if handle == "" {
		handle = a.settingsSnapshot().PlayerHandle
	}
	switch {
	case handle == "":
		return bundle.PlayerIdentity{}, fmt.Errorf("%w: set one in Settings \u2192 Coaching, or type one in the share dialog", ErrNoPlayerHandle)
	case utf8.RuneCountInString(handle) > maxCoachHandleRunes:
		return bundle.PlayerIdentity{}, fmt.Errorf("%w: handle exceeds %d characters", bundle.ErrPlayerIdentityInvalid, maxCoachHandleRunes)
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
