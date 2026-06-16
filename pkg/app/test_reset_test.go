package app_test

import (
	"context"
	"testing"

	"recall/pkg/app"
)

func TestResetForTest_ReturnsToSingleMainProfile(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.Startup(context.Background())

	// Two extra profiles; CreateProfile activates the last, so the active
	// profile is "beta" (not "main") — exercising the switch-back + the
	// multi-delete.
	if err := a.CreateProfile("alt"); err != nil {
		t.Fatalf("CreateProfile(alt): %v", err)
	}
	if err := a.CreateProfile("beta"); err != nil {
		t.Fatalf("CreateProfile(beta): %v", err)
	}

	if err := a.ResetForTest(); err != nil {
		t.Fatalf("ResetForTest: %v", err)
	}

	got := a.GetProfiles()
	if got.Active != "main" || len(got.Profiles) != 1 || got.Profiles[0] != "main" {
		t.Errorf("profiles = %+v, want active=main profiles=[main]", got)
	}
	recs, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(recs) != 0 {
		t.Errorf("matches after reset = %d, want 0 (DB cleared)", len(recs))
	}
}
