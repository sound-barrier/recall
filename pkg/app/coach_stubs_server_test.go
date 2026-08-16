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
	if openErr == nil {
		t.Fatal("LoadCoachBundleFromFile succeeded in server mode")
	}
	if opened.Path != "" || opened.Session != nil {
		t.Errorf("LoadCoachBundleFromFile returned %+v, want the zero result", opened)
	}
	if !strings.Contains(openErr.Error(), "/api/v1/coach/session") {
		t.Errorf("open stub error = %q, want it to name the session route", openErr)
	}

	saved, saveErr := a.SaveCoachNotesToFile()
	if saveErr == nil {
		t.Fatal("SaveCoachNotesToFile succeeded in server mode")
	}
	if saved != "" {
		t.Errorf("SaveCoachNotesToFile returned %q, want \"\"", saved)
	}
	if !strings.Contains(saveErr.Error(), "/api/v1/coach/session/export") {
		t.Errorf("save stub error = %q, want it to name the export route", saveErr)
	}
}
