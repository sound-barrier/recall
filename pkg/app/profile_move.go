package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"recall/pkg/db"
	"recall/pkg/profiles"
)

// MoveMatches transfers every row keyed on matchKeys from the active
// profile's DB to targetProfile's DB. The two-phase engine lives in
// pkg/profiles (see profiles.Move for the crash-consistency
// contract); this shell method owns the request validation and the
// target store's lifecycle.
func (a *App) MoveMatches(matchKeys []string, targetProfile string) error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	if a.profiles == nil {
		return errors.New("profiles: not initialized")
	}
	proceed, err := a.validateMoveRequest(matchKeys, targetProfile)
	if err != nil || !proceed {
		return err
	}

	targetStore, err := a.openProfileStore(targetProfile)
	if err != nil {
		return fmt.Errorf("move: %w", err)
	}
	defer func() { _ = targetStore.Close() }()

	registered := a.registeredHashes()
	if err := profiles.Move(a.store, targetStore, matchKeys); err != nil {
		return err
	}
	// The moved screenshots are the target's now, so this profile, likely
	// watching the same folder, never imports them back.
	a.transferForgotten(registered, targetProfile)
	return nil
}

// validateMoveRequest validates targetProfile and decides whether the
// move should proceed. Returns proceed=false (err=nil) for the
// validated-but-empty-keys idempotent no-op.
func (a *App) validateMoveRequest(matchKeys []string, targetProfile string) (proceed bool, err error) {
	// Validate targetProfile FIRST, before the empty-keys early-return,
	// so an empty-but-invalid request (e.g. "" or "../traversal")
	// surfaces as 400 instead of being swallowed by the no-op branch.
	// Validate targetProfile against the same regex Create / Rename use
	// BEFORE membership in the active list. Two reasons:
	//  1. Defense in depth — the list contents come from a runtime
	//     read that, while validated at write time, is not a static
	//     allow-list as far as taint analysis is concerned. Routing
	//     the name through the regex sanitizes the value before it
	//     flows into the path-construction below
	//     (a.profiles.ProfileDir → filepath.Join → os.MkdirAll).
	//     CodeQL's "Uncontrolled data used in path expression" rule
	//     recognizes the regex check; the slice-membership probe alone
	//     does not.
	//  2. Clearer 400 vs 404 mapping at the HTTP boundary —
	//     malformed names (path-traversal, special chars) return
	//     ErrInvalidProfileName → 400, while well-formed-but-unknown
	//     names return ErrProfileNotFound → 404. The membership
	//     check below catches the second case.
	if err := profiles.ValidateName(targetProfile); err != nil {
		return false, err
	}
	if !a.profiles.Contains(targetProfile) {
		return false, fmt.Errorf("%w: %q", ErrProfileNotFound, targetProfile)
	}
	if targetProfile == a.profiles.Active() {
		return false, fmt.Errorf("%w: %q", ErrMoveTargetIsActive, targetProfile)
	}
	// Validated target, nothing to move — idempotent no-op. The
	// empty-keys check sits HERE (not at the top of the function)
	// so an empty body with a bad target_profile still reports
	// the bad target instead of being swallowed.
	return len(matchKeys) > 0, nil
}

// openProfileStore opens an inactive profile's store at
// <profileDir>/db/recall.db, creating the db dir if it doesn't exist yet.
// The caller closes it.
func (a *App) openProfileStore(name string) (*db.SQLStore, error) {
	dbDir := filepath.Join(a.profiles.ProfileDir(name), "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		return nil, fmt.Errorf("ensure %s's db dir: %w", name, err)
	}
	store, err := db.NewSQLStore(filepath.Join(dbDir, "recall.db"))
	if err != nil {
		return nil, fmt.Errorf("open %s's db: %w", name, err)
	}
	return store, nil
}
