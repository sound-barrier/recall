package app

import (
	"errors"
	"fmt"
)

// ResetForTest restores the install to a single empty "main" profile — the clean
// slate the real-server Playwright e2e specs reset to before each test. It is
// reachable ONLY through the RECALL_E2E-gated POST /api/v1/system/test-reset
// route (pkg/cmd/server_test_reset.go); released serveronly binaries and the
// schemathesis run never set that env var, so the route — and thus this path —
// is absent in production.
func (a *App) ResetForTest() error {
	if a.profiles == nil {
		return errors.New("profiles: not initialized")
	}
	// "main" must be active before we can delete the others (Delete refuses the
	// active profile) and so we clear the canonical DB.
	if a.profiles.Active() != DefaultProfileName {
		if err := a.SwitchProfile(DefaultProfileName); err != nil {
			return err
		}
	}
	for _, name := range a.profiles.List() {
		if name == DefaultProfileName {
			continue
		}
		if err := a.DeleteProfile(name); err != nil {
			return fmt.Errorf("delete profile %q: %w", name, err)
		}
	}
	return a.ClearDatabase(false)
}
