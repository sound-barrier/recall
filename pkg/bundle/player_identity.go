package bundle

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// ErrPlayerIdentityInvalid wraps every rejection of a share-mode identity:
// a blank or oversized handle, an oversized message, or an id that isn't a
// UUID. Export refuses to build the bundle rather than ship an identity the
// coach side can't key notes on.
var ErrPlayerIdentityInvalid = errors.New("export bundle: invalid player identity")

// PlayerIdentity is who a shared bundle is about, written into the manifest
// by a "share with a coach" export. ID is the stable UUID the player's
// settings mint once — the coach side keys its notes on it; Handle is the
// display name the coach sees pre-filled and may correct; Message is the
// player's optional note to the coach ("mostly Ana this week").
type PlayerIdentity struct {
	ID      string `json:"id,omitempty"`
	Handle  string `json:"handle"`
	Message string `json:"message,omitempty"`
}

const (
	maxPlayerHandleRunes  = 64
	maxPlayerMessageRunes = 2000
)

// normalizePlayerIdentity trims the handle and validates every field,
// returning the copy Export writes into the manifest.
func normalizePlayerIdentity(p PlayerIdentity) (PlayerIdentity, error) {
	p.Handle = strings.TrimSpace(p.Handle)
	switch {
	case p.Handle == "":
		return PlayerIdentity{}, fmt.Errorf("%w: handle is required", ErrPlayerIdentityInvalid)
	case utf8.RuneCountInString(p.Handle) > maxPlayerHandleRunes:
		return PlayerIdentity{}, fmt.Errorf("%w: handle exceeds %d characters", ErrPlayerIdentityInvalid, maxPlayerHandleRunes)
	case utf8.RuneCountInString(p.Message) > maxPlayerMessageRunes:
		return PlayerIdentity{}, fmt.Errorf("%w: message exceeds %d characters", ErrPlayerIdentityInvalid, maxPlayerMessageRunes)
	case p.ID != "" && !isUUIDShaped(p.ID):
		return PlayerIdentity{}, fmt.Errorf("%w: id %q is not a UUID", ErrPlayerIdentityInvalid, p.ID)
	}
	return p, nil
}

// isUUIDShaped reports whether s is the canonical 8-4-4-4-12 hex form
// (case-insensitive). Shape only — the version/variant bits are not checked,
// because the id is an opaque key, not something this side ever mints.
func isUUIDShaped(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !isHexRune(r) {
				return false
			}
		}
	}
	return true
}

func isHexRune(r rune) bool {
	return ('0' <= r && r <= '9') || ('a' <= r && r <= 'f') || ('A' <= r && r <= 'F')
}
