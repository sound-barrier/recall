package app

import "recall/pkg/profiles"

// The profile manager + cross-profile move engine live in
// pkg/profiles (carved out per the decomposition plan). These aliases
// keep pkg/cmd's sentinel mappings, cmd/seed-dev's manager usage, and
// every *App method signature byte-identical.

// Profiles is the per-installation profile manager.
type Profiles = profiles.Profiles

// DefaultProfileName is the fresh-install profile every un-renamed
// install runs as.
const DefaultProfileName = profiles.DefaultProfileName

var (
	ErrInvalidProfileName = profiles.ErrInvalidProfileName
	ErrProfileExists      = profiles.ErrProfileExists
	ErrProfileNotFound    = profiles.ErrProfileNotFound
	ErrProfileActive      = profiles.ErrProfileActive
	ErrMoveTargetIsActive = profiles.ErrMoveTargetIsActive
	ErrProfileImmutable   = profiles.ErrProfileImmutable
)

// LoadProfiles opens (or initializes) the profile manager rooted at
// baseDir. Kept at package level for cmd/seed-dev and the Startup
// wiring.
func LoadProfiles(baseDir string) (*Profiles, error) { return profiles.LoadProfiles(baseDir) }
