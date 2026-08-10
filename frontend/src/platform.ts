// Coarse host-OS detection from the user-agent. In the Wails desktop build the
// webview's UA reflects the host OS; in server mode it's the browser's OS.
// Used to gate desktop-window settings that don't apply on macOS (which always
// keeps the app in the menu bar per the platform convention).
export function isMacOS(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
}

// IS_WAILS — the ONE "are we in the native desktop webview" detector, keyed
// off the SERVING ORIGIN: the `wails:` custom scheme (macOS) or the
// `wails.localhost` virtual host (Windows), both of which window.location
// exposes synchronously at module load.
//
// Do NOT re-derive this from navigator.userAgent. Wails appends its marker
// to outgoing request headers on Windows, never to the JS-visible UA, so a
// UA-only copy reads false in the shipped desktop build — that is how every
// API call once 404'd against the desktop asset server, and how a
// context-menu item later went missing there. String comparisons only, so
// CodeQL's incomplete-URL-sanitization rule stays quiet.
//
// It lives in this dependency-free leaf (not in api-platform.ts, which
// pulls the generated SDK and the Wails runtime) so leaf components can
// read it without dragging the api chain into their chunk.
function detectWailsWebview(): boolean {
  if (typeof window === 'undefined') return false
  const { protocol, hostname } = window.location
  return protocol === 'wails:' || hostname === 'wails.localhost'
}

export const IS_WAILS = detectWailsWebview()
