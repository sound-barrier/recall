/**
 * api.js — transport-agnostic wrapper for all Wails-bound App methods
 * and runtime events.
 *
 * In Wails mode (native window):  delegates to window['go']['main']['App']
 *   and window.runtime — identical behaviour to the generated wailsjs/ bindings.
 *
 * In server mode (regular browser): uses fetch('/api/...') for calls and
 *   EventSource('/api/events') for the parse-complete notification.
 */

// Detect whether the Wails IPC bridge has been injected. The bridge is
// only present when the page is loaded inside the native Wails webview.
const IS_WAILS = typeof window !== 'undefined' && !!window['go']?.['app']?.['App']

// ─── Internal helpers ──────────────────────────────────────────────────────

function _wails(method, ...args) {
  return window['go']['app']['App'][method](...args)
}

async function _get(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

async function _post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// ─── App methods ───────────────────────────────────────────────────────────

export function GetMatchResults() {
  if (IS_WAILS) return _wails('GetMatchResults')
  return _get('/api/match-results')
}

export function GetScreenshotsDir() {
  if (IS_WAILS) return _wails('GetScreenshotsDir')
  return _get('/api/screenshots-dir').then(d => d.path)
}

// In server mode: prompt the user for a path and POST it. Falls back
// to the existing value on cancel (mirrors Wails dialog-cancel behaviour).
export async function PickScreenshotsDir() {
  if (IS_WAILS) return _wails('PickScreenshotsDir')
  const current = await _get('/api/screenshots-dir').then(d => d.path)
  const p = window.prompt('Screenshots directory path:', current)
  if (!p) return current
  await _post('/api/screenshots-dir', { path: p })
  return p
}

export function ParseScreenshots() {
  if (IS_WAILS) return _wails('ParseScreenshots')
  return _post('/api/parse').then(() => undefined)
}

export function GetPrometheusEnabled() {
  if (IS_WAILS) return _wails('GetPrometheusEnabled')
  return _get('/api/prometheus-enabled').then(d => d.enabled)
}

export function SetPrometheusEnabled(enabled) {
  if (IS_WAILS) return _wails('SetPrometheusEnabled', enabled)
  return _post('/api/prometheus-enabled', { enabled }).then(() => undefined)
}

export function GetWatchEnabled() {
  if (IS_WAILS) return _wails('GetWatchEnabled')
  return _get('/api/watch-enabled').then(d => d.enabled)
}

export function SetWatchEnabled(enabled) {
  if (IS_WAILS) return _wails('SetWatchEnabled', enabled)
  return _post('/api/watch-enabled', { enabled }).then(() => undefined)
}

export function GetTesseractStatus() {
  if (IS_WAILS) return _wails('GetTesseractStatus')
  return _get('/api/tesseract-status')
}

export function SetTesseractPath(path) {
  if (IS_WAILS) return _wails('SetTesseractPath', path)
  return _post('/api/tesseract-path', { path })
}

// In server mode: prompt for the binary path then POST it.
export async function PickTesseractBinary() {
  if (IS_WAILS) return _wails('PickTesseractBinary')
  const current = await _get('/api/tesseract-status').then(d => d.path || '')
  const p = window.prompt('Path to Tesseract binary:', current)
  if (!p) return _get('/api/tesseract-status')
  return _post('/api/tesseract-path', { path: p })
}

export function ResetTesseractPath() {
  if (IS_WAILS) return _wails('ResetTesseractPath')
  return _post('/api/tesseract-reset')
}

// ─── Events ────────────────────────────────────────────────────────────────
// In Wails mode: thin pass-through to window.runtime.
// In server mode: EventSource on /api/events, keyed by event name so
//   EventsOff can close the matching source.

const _sources = {}

export function EventsOn(eventName, callback) {
  if (IS_WAILS) {
    window.runtime.EventsOn(eventName, callback)
    return
  }
  // Close any previous source for this event before opening a new one
  // (guards against double-mount in development HMR scenarios).
  if (_sources[eventName]) {
    _sources[eventName].close()
  }
  const es = new EventSource('/api/events')
  es.addEventListener(eventName, () => callback())
  _sources[eventName] = es
}

export function EventsOff(eventName) {
  if (IS_WAILS) {
    window.runtime.EventsOff(eventName)
    return
  }
  if (_sources[eventName]) {
    _sources[eventName].close()
    delete _sources[eventName]
  }
}
