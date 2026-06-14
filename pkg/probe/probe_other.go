//go:build !windows

package probe

// resolveSteamScreenshots is a Windows-only operation — Steam's userdata
// path resolution goes through the Windows registry. On macOS / Linux
// this returns ("", false) so the cross-platform caller can drop the
// Steam card without a build-tag branch at the call site.
//
// (If we ever want Steam screenshot detection on Linux we'd resolve
// SteamPath from `~/.steam/steam` and the rest of the walk works the
// same. macOS Steam stores userdata under
// `~/Library/Application Support/Steam/userdata`. Not implemented yet
// — auto-detect is Windows-only by current product decision.)
func resolveSteamScreenshots() (string, bool) {
	return "", false
}
