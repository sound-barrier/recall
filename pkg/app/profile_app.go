package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"recall/pkg/applog"
	"recall/pkg/db"
	"recall/pkg/parser"
)

// ProfilesResponse is the wire shape for GET /api/v1/profiles and the
// Wails GetProfiles binding. One ergonomic object so the frontend
// doesn't need two round-trips for "what's active" + "what exists."
type ProfilesResponse struct {
	Active   string   `json:"active"`
	Profiles []string `json:"profiles"`
	// Immutable lists the read-only profiles (the tour's "test" sample). The
	// frontend disables the new-match IMPORT affordances (parse / import /
	// restore / manual-add / move-in) on these; small edits stay enabled.
	Immutable []string `json:"immutable"`
}

// assertActiveMutable returns ErrProfileImmutable when the active profile is
// read-only — the guard every corpus-mutating entry point calls first.
func (a *App) assertActiveMutable() error {
	if a.profiles != nil && a.profiles.IsImmutable(a.profiles.Active()) {
		return fmt.Errorf("%w: %q", ErrProfileImmutable, a.profiles.Active())
	}
	return nil
}

// SetProfileOverride stashes a profile name to activate during the
// next Startup. main.go / main_server.go call this when the user
// passes `--profile=<name>` on the command line. The override is
// applied EXACTLY ONCE in Startup, after profiles.json is loaded;
// the named profile is auto-created if it doesn't exist. Recorded as
// the active profile in profiles.json so subsequent launches without
// --profile resume on the same one.
func (a *App) SetProfileOverride(name string) {
	a.profileOverride = name
}

// GetProfiles returns the active profile + the sorted list of every
// known profile. Read-only — safe to call from any goroutine.
func (a *App) GetProfiles() ProfilesResponse {
	if a.profiles == nil {
		// Pre-Startup safety: return a single-default placeholder so
		// the frontend's first paint doesn't render an empty switcher.
		return ProfilesResponse{
			Active:    DefaultProfileName,
			Profiles:  []string{DefaultProfileName},
			Immutable: []string{},
		}
	}
	list := a.profiles.List()
	immutable := make([]string, 0, len(list))
	for _, name := range list {
		if a.profiles.IsImmutable(name) {
			immutable = append(immutable, name)
		}
	}
	return ProfilesResponse{
		Active:    a.profiles.Active(),
		Profiles:  list,
		Immutable: immutable,
	}
}

// CreateProfile creates a new profile + immediately activates it. The
// create-then-switch sequence matches the typical UX (user picks
// "New profile…" from the masthead chip, names it, expects to be on
// it). Returns ErrInvalidProfileName / ErrProfileExists for typed 4xx
// mapping at the HTTP boundary.
func (a *App) CreateProfile(name string) error {
	if a.profiles == nil {
		return errors.New("profiles: not initialized")
	}
	if err := a.profiles.Create(name); err != nil {
		return err
	}
	return a.activateAndReload(name)
}

// SwitchProfile activates an existing profile. The full App teardown
// + reload sequence runs so settings, the SQLite connection, and the
// watcher all swap atomically to the new profile's state. Returns
// ErrProfileNotFound for unknown names.
func (a *App) SwitchProfile(name string) error {
	if a.profiles == nil {
		return errors.New("profiles: not initialized")
	}
	if !a.profiles.Contains(name) {
		return fmt.Errorf("%w: %q", ErrProfileNotFound, name)
	}
	return a.activateAndReload(name)
}

// Sample "test" profile constants — the in-app onboarding "explore with
// real data" action seeds this and then SwitchProfile's into it. A fixed
// seed gives a stable demo corpus. NO chaos: the walkthrough must show only
// real OW heroes + maps (chaos mutates matches into pathological garbage —
// synthetic-hero-NN, zalgo map names — which belongs to the seed-dev stress
// path, not a user-facing demo). The Unknown/Ambiguous tour targets come from
// the dedicated unknown/ambiguous fixtures in the base generation, not chaos.
const (
	TestProfileName    = "test"
	testProfileSeed    = 8
	testProfileMatches = 500
)

// SeedTestProfileResponse is the wire shape for SeedTestProfile.
type SeedTestProfileResponse struct {
	Profile       string `json:"profile"`
	Matches       int    `json:"matches"`
	AlreadySeeded bool   `json:"already_seeded"`
}

// SeedTestProfile creates a sample "test" profile (if absent) and seeds
// it with ~500 synthetic matches over the rolling last-8-months window so
// a new user can explore Recall on a real history. It does NOT switch the
// active profile — the caller (the walkthrough) does that separately.
// Idempotent: if "test" already holds matches, it's reused untouched and
// AlreadySeeded is true. Seeds a transient store at the test profile's db
// path, never the active store.
func (a *App) SeedTestProfile() (SeedTestProfileResponse, error) {
	if a.profiles == nil {
		return SeedTestProfileResponse{}, errors.New("profiles: not initialized")
	}
	res, err := SeedProfile(a.profiles, TestProfileName, SeedOptions{
		N:     testProfileMatches,
		Seed:  testProfileSeed,
		Style: "flex",
		// Chaos deliberately omitted (0) — see the const comment above.
	})
	if err != nil {
		return SeedTestProfileResponse{}, err
	}
	// The sample profile's corpus is protected: it's a curated demo, so the user
	// can't IMPORT new matches into it (parse / bundle import / manual add /
	// move-in / restore-a-foreign-db). Small edits to the existing seeded
	// matches — tags, reviews, per-match overrides, even deleting one — stay
	// allowed so the demo is explorable. Marked idempotently on every seed call.
	if err := a.profiles.SetImmutable(TestProfileName); err != nil {
		return SeedTestProfileResponse{}, err
	}
	return SeedTestProfileResponse{
		Profile:       res.Profile,
		Matches:       res.Matches,
		AlreadySeeded: res.AlreadySeeded,
	}, nil
}

// RenameProfile changes a profile's name. The on-disk directory
// renames atomically via os.Rename; if the profile being renamed is
// the active one, the store + watcher both get torn down before the
// rename and re-stood-up afterward so they
// point at the new path (the SQLite handle's open file is invalid
// once the directory moves out from under it). Idempotent when
// new == old.
func (a *App) RenameProfile(old, newName string) error {
	if a.profiles == nil {
		return errors.New("profiles: not initialized")
	}
	if old == newName {
		return nil
	}
	wasActive := a.profiles.Active() == old
	if wasActive {
		// Same guard as activateAndReload: the branch below closes the
		// live store, and an in-flight parse would write through it
		// mid-rename. (defer runs at function end — the slot is held
		// for the whole rename + reopen.)
		if _, ok := a.claimRunSlot("profile-rename"); !ok {
			return ErrProfileSwitchDuringParse
		}
		defer a.endParse()
		// Tear down everything that holds the active profile dir open
		// — the directory rename can't proceed while SQLite has the
		// .db file mapped.
		a.saveSettingsBestEffort()
		a.stopWatching()
		if a.store != nil {
			if closer, ok := a.store.(interface{ Close() error }); ok {
				_ = closer.Close()
			}
			a.store = nil
		}
	}

	if err := a.profiles.Rename(old, newName); err != nil {
		// Re-open on the original profile so the App doesn't get
		// stranded with a nil store on a failed active rename.
		if wasActive {
			if rerr := a.reopenActiveStore(); rerr != nil {
				applog.Subsystem("profiles").Warn("reopen active store after failed rename", "err", rerr)
			}
		}
		return err
	}

	if wasActive {
		return a.reopenActiveStore()
	}
	return nil
}

// reopenActiveStore is shared between RenameProfile's active branch
// and any future caller that needs to re-init the store at the
// current active profile's directory.
func (a *App) reopenActiveStore() error {
	dbDir := filepath.Join(a.dataDir(), "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		return fmt.Errorf("profiles: ensure db dir: %w", err)
	}
	s, err := db.NewSQLStore(filepath.Join(dbDir, "recall.db"))
	if err != nil {
		return fmt.Errorf("profiles: open db: %w", err)
	}
	a.store = s
	if a.settingsSnapshot().WatchEnabled {
		a.startWatching()
	}
	return nil
}

// ErrProfileSwitchDuringParse rejects a profile activation while a parse
// holds the single-flight slot: activateAndReload tears down and replaces
// a.store, and an OCR loop writing through the old handle mid-swap would
// race a closed store. Callers retry once the parse finishes; the HTTP
// layer maps this to 409.
var ErrProfileSwitchDuringParse = errors.New("profiles: a parse is in flight — retry when it finishes")

// DeleteProfile drops a profile from the list AND wipes its dir. The
// active profile cannot be deleted — callers must SwitchProfile first.
func (a *App) DeleteProfile(name string) error {
	if a.profiles == nil {
		return errors.New("profiles: not initialized")
	}
	return a.profiles.Delete(name)
}

// activateAndReload is the common tail of Create/Switch. After the
// profile name change is recorded, we tear down the active store +
// background services and re-build them at the new profile's dir.
//
// Failure path is best-effort: if the teardown succeeds but the
// re-init fails (e.g. SQLite can't open the new path), the App is
// left in a broken state and the operator restarts. Acceptable
// because the only realistic failure is filesystem-level (out of
// disk, permission). The HTTP handler returns 500 and the user
// retries.
func (a *App) activateAndReload(name string) error {
	// Hold the run slot for the whole swap: a watcher- or user-triggered
	// parse mid-switch would write through the store this function is
	// about to close. Busy → the caller retries after the parse (409).
	if _, ok := a.claimRunSlot("profile-switch"); !ok {
		return ErrProfileSwitchDuringParse
	}
	defer a.endParse()

	// Persist any in-memory settings deltas the user staged but hasn't
	// triggered a save for. The toggle setters all save inline, so
	// this is paranoia — but cheap paranoia.
	a.saveSettingsBestEffort()

	// Tear down the background services tied to the OLD profile.
	a.stopWatching()
	if a.store != nil {
		if closer, ok := a.store.(interface{ Close() error }); ok {
			_ = closer.Close()
		}
		a.store = nil
	}

	if err := a.profiles.Activate(name); err != nil {
		return err
	}

	// Re-init at the new dir — same resolve-under-lock shape as
	// resolveSettings so a concurrent settings read never observes the
	// half-swapped state.
	changed := false
	resolved := a.mutateSettings(func(s *Settings) {
		*s = a.loadSettings()
		if s.ScreenshotsDir != "" && pathIsMissingOrNotADir(s.ScreenshotsDir) {
			s.ScreenshotsDir = ""
			changed = true
		}
		if s.TesseractPath == "" {
			s.TesseractPath = defaultTesseractPath()
			changed = true
		}
	})
	if changed {
		a.saveSettingsBestEffort()
	}
	a.setTessStatus(checkTesseract(resolved.TesseractPath))
	parser.SetTesseractPath(resolved.TesseractPath)
	a.autoProbeOnFirstRun()

	dbDir := filepath.Join(a.dataDir(), "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		return fmt.Errorf("profiles: ensure db dir for %q: %w", name, err)
	}
	s, err := db.NewSQLStore(filepath.Join(dbDir, "recall.db"))
	if err != nil {
		applog.Subsystem("profiles").Error("open db", "name", applog.Scrub(name), "err", err)
		return fmt.Errorf("profiles: open db for %q: %w", name, err)
	}
	a.store = s

	if resolved.WatchEnabled {
		a.startWatching()
	}
	return nil
}
