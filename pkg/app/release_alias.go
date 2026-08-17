package app

import (
	"encoding/json"
	"os"

	"recall/pkg/release"
)

// The app-release update check lives in pkg/release (carved out per the
// decomposition plan). These aliases keep the UpdateInfo wire shape and
// every *App method signature byte-identical; the shell only wires the
// install root and the running version in.
//
// Version deliberately did NOT move. `-X recall/pkg/app.Version` is baked
// into Taskfile.yml, build/darwin/Taskfile.yml and
// build/windows/Taskfile.yml, and documented in api/openapi.yaml — the
// linker symbol is the package path, so moving the var would silently
// stamp every release "dev" with nothing failing. It is passed to the
// leaf as a parameter instead.

type (
	// UpdateInfo is returned by CheckForUpdate.
	UpdateInfo = release.Info
	// CheckState records when the install last ran the update check.
	CheckState = release.CheckState
)

// Version is injected at build time via -ldflags "-X recall/pkg/app.Version=<tag>".
// Falls back to "dev" when building outside the release pipeline.
var Version = "dev"

// GetVersion reports the running version, resolving the un-injected dev
// case against the release-please manifest.
func (a *App) GetVersion() string {
	if Version != "dev" {
		return Version
	}
	// No ldflags injection (direct `wails dev` or similar): read the manifest
	// so the UI shows "<version>-dev" rather than a bare "dev".
	data, err := os.ReadFile(".release-please-manifest.json")
	if err != nil {
		return "dev"
	}
	var manifest map[string]string
	if err := json.Unmarshal(data, &manifest); err != nil {
		return "dev"
	}
	if v := manifest["."]; v != "" {
		return v + "-dev"
	}
	return "dev"
}

// CheckForUpdate compares the running version against the latest published
// release and joins the live game-data status. Wails-bound; the HTTP twin
// is GET /api/v1/system/update.
func (a *App) CheckForUpdate() UpdateInfo {
	u := release.Check(appBaseDir(), a.GetVersion())
	// One field covers every gate: the Wails wrapper only sets
	// a.SelfUpdate when self-update is actually possible here.
	//
	// Only on a response that actually CHECKED. A failed fetch comes back as a
	// zero Info whose whole meaning is "show nothing", and stamping the
	// capability onto it ships {"checked":false,"available":false,
	// "can_self_update":true} — a payload that contradicts itself. The old
	// pre-carve shape returned before this line on the failure path; keeping
	// that behavior is the point, not a new rule.
	if u.Checked {
		u.CanSelfUpdate = a.SelfUpdate != nil
	}
	return u
}
