package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
)

// Multiple profiles — main + alt accounts each with their own
// settings + SQLite DB. The profile manager owns the on-disk layout:
//
//	<base>/                  ← was the per-install data dir
//	├── profiles.json         {"active_profile":"main","profiles":[…]}
//	└── profiles/
//	    ├── main/
//	    │   ├── settings.json
//	    │   └── db/recall.db
//	    └── alt/
//	        ├── settings.json
//	        └── db/recall.db
//
// LoadProfiles auto-migrates a pre-profile layout (settings.json and/or
// db/ directly at <base>/) into profiles/main/ on first call. Fresh
// installs get an empty profiles/main/ + profiles.json with main as
// active.

// Sentinel errors — HTTP handlers errors.Is these to map 4xx codes.
var (
	ErrInvalidProfileName = errors.New("invalid profile name")
	ErrProfileExists      = errors.New("profile already exists")
	ErrProfileNotFound    = errors.New("profile not found")
	ErrProfileActive      = errors.New("cannot delete active profile")
)

// DefaultProfileName is the name assigned on first-run / migration.
// "main" matches the FEATURES.md wording and reads as "the primary
// account" in the masthead chip.
const DefaultProfileName = "main"

// profileNameRe constrains profile names to a filesystem-safe subset.
// Must start with an alphanumeric (so leading dot / underscore can
// never coincide with hidden files or filesystem-meaningful tokens);
// remaining characters add hyphen and underscore. Max 40 to keep the
// chip label readable. Path separators rejected by construction.
var profileNameRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$`)

// Profiles tracks the set of known profile names + which one is
// active, persisting both to <base>/profiles.json. Concurrency-safe
// via the embedded RWMutex: tests fan reads through Active/List
// freely; writes (Create / Activate / Delete) take the write lock.
type Profiles struct {
	baseDir string
	mu      sync.RWMutex
	active  string
	list    []string
}

// profilesFile is the on-disk envelope. Kept private so callers go
// through the Profiles type for mutation.
type profilesFile struct {
	Active   string   `json:"active_profile"`
	Profiles []string `json:"profiles"`
}

// LoadProfiles opens (and if necessary initializes) the profile state
// under baseDir. Safe to call repeatedly — idempotent on a steady
// state, migrates exactly once on first call against a pre-profile
// layout, creates the default profile on fresh installs.
func LoadProfiles(baseDir string) (*Profiles, error) {
	p := &Profiles{baseDir: baseDir}
	if err := p.load(); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *Profiles) load() error {
	if err := os.MkdirAll(p.baseDir, 0o700); err != nil {
		return fmt.Errorf("profiles: ensure base dir: %w", err)
	}

	raw, err := os.ReadFile(p.metaPath())
	switch {
	case err == nil:
		var f profilesFile
		if jerr := json.Unmarshal(raw, &f); jerr != nil {
			return fmt.Errorf("profiles: parse profiles.json: %w", jerr)
		}
		p.active = f.Active
		p.list = append(p.list[:0], f.Profiles...)
		sort.Strings(p.list)
		// Defence against a hand-edited profiles.json whose active is
		// not in the list — fall back to the first listed profile, or
		// the default name if list is empty.
		if !containsProfile(p.list, p.active) {
			if len(p.list) > 0 {
				p.active = p.list[0]
			} else {
				p.active = DefaultProfileName
				p.list = []string{DefaultProfileName}
			}
		}
		return p.ensureDir(p.active)
	case errors.Is(err, os.ErrNotExist):
		// Fresh install OR pre-profile layout. Decide by probing for
		// pre-profile artifacts.
		return p.initOrMigrate()
	default:
		return fmt.Errorf("profiles: read profiles.json: %w", err)
	}
}

// initOrMigrate runs on the no-profiles-json branch. If the base dir
// already containsProfile a settings.json or db/ from the pre-profile layout,
// move them into profiles/main/; otherwise just stand up an empty
// profiles/main/. Either way the default profile becomes active and
// profiles.json is written.
func (p *Profiles) initOrMigrate() error {
	p.active = DefaultProfileName
	p.list = []string{DefaultProfileName}
	if err := p.ensureDir(p.active); err != nil {
		return err
	}

	// Migrate pre-profile artifacts if present.
	oldSettings := filepath.Join(p.baseDir, "settings.json")
	if _, statErr := os.Stat(oldSettings); statErr == nil {
		dst := filepath.Join(p.ProfileDir(p.active), "settings.json")
		if err := os.Rename(oldSettings, dst); err != nil {
			return fmt.Errorf("profiles: migrate settings.json: %w", err)
		}
	}
	oldDB := filepath.Join(p.baseDir, "db")
	if info, statErr := os.Stat(oldDB); statErr == nil && info.IsDir() {
		dst := filepath.Join(p.ProfileDir(p.active), "db")
		if err := os.Rename(oldDB, dst); err != nil {
			return fmt.Errorf("profiles: migrate db dir: %w", err)
		}
	}

	return p.save()
}

func (p *Profiles) metaPath() string {
	return filepath.Join(p.baseDir, "profiles.json")
}

// ProfileDir returns the absolute directory for a named profile,
// whether or not it currently exists on disk.
func (p *Profiles) ProfileDir(name string) string {
	return filepath.Join(p.baseDir, "profiles", name)
}

// ActiveDir returns the active profile's directory — the path the
// App's settings + DB live under for this launch.
func (p *Profiles) ActiveDir() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.ProfileDir(p.active)
}

// BaseDir returns the install-wide base directory.
func (p *Profiles) BaseDir() string { return p.baseDir }

// Active returns the active profile name.
func (p *Profiles) Active() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.active
}

// List returns the sorted slice of known profile names. Returned
// slice is a copy — safe to mutate by the caller.
func (p *Profiles) List() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]string, len(p.list))
	copy(out, p.list)
	return out
}

// Create stages a new profile: validates the name, ensures the dir
// exists, adds to the list, persists. Does NOT activate — callers
// that want create-then-switch sequence Activate themselves.
func (p *Profiles) Create(name string) error {
	if err := validateProfileName(name); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if containsProfile(p.list, name) {
		return fmt.Errorf("%w: %q", ErrProfileExists, name)
	}
	if err := p.ensureDir(name); err != nil {
		return err
	}
	p.list = append(p.list, name)
	sort.Strings(p.list)
	return p.save()
}

// Activate switches the active profile. The actual DB / settings
// swap happens at the App layer — the manager just records the new
// active name.
func (p *Profiles) Activate(name string) error {
	if err := validateProfileName(name); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !containsProfile(p.list, name) {
		return fmt.Errorf("%w: %q", ErrProfileNotFound, name)
	}
	p.active = name
	return p.save()
}

// Delete drops the profile from the list AND removes its directory
// tree. The active profile cannot be deleted — callers must Activate
// a different profile first.
func (p *Profiles) Delete(name string) error {
	if err := validateProfileName(name); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !containsProfile(p.list, name) {
		return fmt.Errorf("%w: %q", ErrProfileNotFound, name)
	}
	if name == p.active {
		return fmt.Errorf("%w: %q", ErrProfileActive, name)
	}
	if err := os.RemoveAll(p.ProfileDir(name)); err != nil {
		return fmt.Errorf("profiles: remove %q dir: %w", name, err)
	}
	p.list = removeString(p.list, name)
	return p.save()
}

func (p *Profiles) ensureDir(name string) error {
	if err := os.MkdirAll(p.ProfileDir(name), 0o700); err != nil {
		return fmt.Errorf("profiles: ensure %q dir: %w", name, err)
	}
	return nil
}

func (p *Profiles) save() error {
	enc, err := json.MarshalIndent(profilesFile{
		Active:   p.active,
		Profiles: append([]string(nil), p.list...),
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("profiles: marshal: %w", err)
	}
	return os.WriteFile(p.metaPath(), enc, 0o600)
}

func validateProfileName(name string) error {
	if !profileNameRe.MatchString(name) {
		return fmt.Errorf("%w: %q", ErrInvalidProfileName, name)
	}
	return nil
}

func containsProfile(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func removeString(s []string, v string) []string {
	out := s[:0]
	for _, x := range s {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}
