// Coarse host-OS detection from the user-agent. In the Wails desktop build the
// webview's UA reflects the host OS; in server mode it's the browser's OS.
// Used to gate desktop-window settings that don't apply on macOS (which always
// keeps the app in the menu bar per the platform convention).
export function isMacOS(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
}
