package app_test

import (
	"context"
	"errors"
	"testing"

	"recall/pkg/app"
)

// A profile activation tears down and replaces a.store. If a parse holds
// the single-flight slot, its OCR loop is writing through the OLD store
// handle — the switch must refuse (typed sentinel → HTTP 409) instead of
// closing the store out from under it.
func TestSwitchProfile_RefusesWhileParseInFlight(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.Startup(context.Background())
	if err := a.CreateProfile("alt"); err != nil { // creates + activates alt
		t.Fatalf("CreateProfile: %v", err)
	}

	// Occupy the parse slot exactly as claimParse does.
	app.ParseCancelMu(a).Lock()
	*app.ParseRunning(a) = true
	app.ParseCancelMu(a).Unlock()

	if err := a.SwitchProfile("main"); !errors.Is(err, app.ErrProfileSwitchDuringParse) {
		t.Fatalf("SwitchProfile during parse = %v, want ErrProfileSwitchDuringParse", err)
	}

	// Renaming the ACTIVE profile closes the store the same way — the
	// guard covers that path too.
	if err := a.RenameProfile("alt", "alt2"); !errors.Is(err, app.ErrProfileSwitchDuringParse) {
		t.Fatalf("RenameProfile(active) during parse = %v, want ErrProfileSwitchDuringParse", err)
	}
	// Renaming an INACTIVE profile touches no live store — allowed.
	if err := a.RenameProfile("main", "main2"); err != nil {
		t.Fatalf("RenameProfile(inactive) during parse = %v, want nil", err)
	}

	// Slot released → the switch proceeds normally.
	app.ParseCancelMu(a).Lock()
	*app.ParseRunning(a) = false
	app.ParseCancelMu(a).Unlock()
	if err := a.SwitchProfile("main2"); err != nil {
		t.Fatalf("SwitchProfile after parse ended = %v, want nil", err)
	}
}
