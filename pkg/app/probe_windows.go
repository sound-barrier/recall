//go:build windows

package app

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

// owSteamAppID is Overwatch 2's Steam app id. If Blizzard ever
// re-bundles the game under a new entry this is the one knob to
// bump — the registry-walk resolver below is the only consumer.
const owSteamAppID = "2357570"

// resolveSteamScreenshots returns the path to the Steam-installed
// Overwatch 2 screenshots folder for the first Steam user account
// that has one. Resolution chain:
//
//  1. Read HKCU\Software\Valve\Steam SteamPath (set by every Steam
//     install on a Steam-managed Windows box).
//  2. Walk every numeric subdirectory of <SteamPath>\userdata\ —
//     each one is a Steam user account id.
//  3. For each candidate id, check whether
//     <SteamPath>\userdata\<id>\760\remote\<owSteamAppID>\screenshots
//     exists. Return the first that does.
//
// Returns ("", false) when Steam isn't installed, the registry key
// is unreadable, or no userdata folder contains OW screenshots.
// Errors are not surfaced — the picker treats "not found" as a
// state in its own right and renders the card grayed.
func resolveSteamScreenshots() (string, bool) {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Valve\Steam`, registry.QUERY_VALUE)
	if err != nil {
		return "", false
	}
	defer func() { _ = k.Close() }()
	steamPath, _, err := k.GetStringValue("SteamPath")
	if err != nil || steamPath == "" {
		return "", false
	}
	userdataDir := filepath.Join(steamPath, "userdata")
	entries, err := os.ReadDir(userdataDir)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		candidate := filepath.Join(userdataDir, e.Name(), "760", "remote", owSteamAppID, "screenshots")
		if dirExists(candidate) {
			return candidate, true
		}
	}
	return "", false
}
