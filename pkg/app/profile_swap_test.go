package app_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
)

// swapApp boots a real app with two profiles, back on "main", watching a
// screenshots folder.
func swapApp(t *testing.T) *app.App {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.Startup(context.Background())
	t.Cleanup(func() { app.StopWatching(a) })
	mustNoErr(t, a.CreateProfile("alt"))
	mustNoErr(t, a.SwitchProfile("main"))
	app.SettingsOf(a).ScreenshotsDir = t.TempDir()
	mustNoErr(t, a.SetWatchEnabled(true))
	return a
}

// breakProfile makes alt's database impossible to open, in one of the ways
// a switch fails after the old store is already closed.
func breakProfile(t *testing.T, a *app.App, how func(dbDir string)) {
	t.Helper()
	mustNoErr(t, a.SwitchProfile("alt"))
	dbDir := filepath.Join(app.DataDir(a), "db")
	mustNoErr(t, a.SwitchProfile("main"))
	mustNoErr(t, os.RemoveAll(dbDir))
	how(dbDir)
}

// The traced bug: a switch that failed after closing the old store left the
// app with no store at all — and, depending on where it failed, the broken
// profile recorded as active and the watcher stopped — so every later call
// failed until a restart.
func TestSwitchProfile_AFailedSwitchLeavesThePreviousProfileWorking(t *testing.T) {
	cases := map[string]func(dbDir string){
		// os.MkdirAll fails: a file sits where the db directory goes.
		"db dir unusable": func(dbDir string) {
			mustNoErr(t, os.WriteFile(dbDir, []byte("x"), 0o600))
		},
		// db.NewSQLStore fails: a directory sits where the database goes.
		"database unopenable": func(dbDir string) {
			mustNoErr(t, os.MkdirAll(filepath.Join(dbDir, "recall.db"), 0o700))
		},
	}
	for name, how := range cases {
		t.Run(name, func(t *testing.T) {
			a := swapApp(t)
			breakProfile(t, a, how)

			if err := a.SwitchProfile("alt"); err == nil {
				t.Fatal("switch to a broken profile succeeded")
			}
			if got := a.GetProfiles().Active; got != "main" {
				t.Errorf("active profile = %q, want main", got)
			}
			if app.Store(a) == nil {
				t.Fatal("no store after the failed switch")
			}
			if _, err := a.GetMatchResults(); err != nil {
				t.Errorf("reading matches after the failed switch: %v", err)
			}
			if app.Watcher(a) == nil {
				t.Error("the previous profile's watcher was not restarted")
			}
		})
	}
}

// A swap ends any open coaching session and closes the store its notes are
// written to. A session opened in that window reached no store at all.
func TestCoachSession_RefusedWhileAStoreSwapHoldsTheSlot(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	_, id, err := app.ClaimRun(a, app.RunKindProfileSwitch)
	mustNoErr(t, err)
	defer app.FinishRun(a, id, nil, nil)

	if _, err := a.OpenCoachReplaySession([]string{"ABC123"}); !errors.Is(err, app.ErrStoreSwapInProgress) {
		t.Errorf("OpenCoachReplaySession mid-swap = %v, want ErrStoreSwapInProgress", err)
	}
}
