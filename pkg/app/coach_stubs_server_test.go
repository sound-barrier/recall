//go:build serveronly

package app_test

import (
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
)

// Server-mode builds have no native dialogs, so the coaching file-picker
// twins are stubs. They must still exist (both build tags expose the same
// method set) and must name the HTTP route that replaces them, because
// that message is what the user sees.
func TestCoachDialogTwins_PointAtTheHTTPRoutes(t *testing.T) {
	isolateInstall(t)
	a := app.NewWithStore(dbtest.New())

	opened, openErr := a.LoadCoachBundleFromFile()
	assertStubNamesRoute(t, "LoadCoachBundleFromFile", "/api/v1/coach/session", openErr)
	if opened.Path != "" || opened.Session != nil {
		t.Errorf("LoadCoachBundleFromFile returned %+v, want the zero result", opened)
	}

	saved, saveErr := a.SaveCoachNotesToFile()
	assertStubNamesRoute(t, "SaveCoachNotesToFile", "/api/v1/coach/session/export", saveErr)
	if saved != "" {
		t.Errorf("SaveCoachNotesToFile returned %q, want \"\"", saved)
	}

	shared, shareErr := a.SaveShareBundleToFile(nil, false, false, app.SharePlayer{Handle: "Sable"})
	assertStubNamesRoute(t, "SaveShareBundleToFile", "/api/v1/exports/bundle", shareErr)
	if shared != "" {
		t.Errorf("SaveShareBundleToFile returned %q, want \"\"", shared)
	}
}

// assertStubNamesRoute holds one dialog stub to its half of the contract:
// it must fail, and the failure must name the route that replaces it.
func assertStubNamesRoute(t *testing.T, method, route string, err error) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s succeeded in server mode", method)
	}
	if !strings.Contains(err.Error(), route) {
		t.Errorf("%s stub error = %q, want it to name %s", method, err, route)
	}
}
