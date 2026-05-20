/**
 * api.ts — transport-agnostic wrapper for all Wails-bound App methods
 * and runtime events. Types come from api.gen.d.ts which is generated
 * from api/openapi.yaml by `npm run gen:types` (or `make gen-types`).
 *
 * In Wails mode (native window):  delegates to window['go']['app']['App']
 *   and window.runtime — identical behavior to the generated wailsjs/ bindings.
 *
 * In server mode (regular browser): uses fetch('/api/...') for calls and
 *   EventSource('/api/events') for the parse-complete notification.
 */

import type { components } from './api.gen'

// Re-exported types — consumers (App.vue) import these instead of
// reaching into api.gen directly.
export type MatchRecord     = components['schemas']['MatchRecord']
export type MatchResult     = components['schemas']['MatchResult']
export type HeroPlay        = components['schemas']['HeroPlay']
export type HeroSR          = components['schemas']['HeroSR']
export type Performance     = components['schemas']['Performance']
export type TesseractStatus = components['schemas']['TesseractStatus']
export type ScreenshotType  = components['schemas']['ScreenshotType']

// Detect whether the Wails IPC bridge has been injected. The bridge is
// only present when the page is loaded inside the native Wails webview.
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    go?: { app?: { App?: Record<string, (...args: any[]) => Promise<any>> } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runtime?: { EventsOn: (n: string, cb: (data: any) => void) => void; EventsOff: (n: string) => void }
  }
}

const IS_WAILS = typeof window !== 'undefined' && !!window.go?.app?.App

// ─── Internal helpers ──────────────────────────────────────────────────────

function _wails<T>(method: string, ...args: unknown[]): Promise<T> {
  // Bridge is present (IS_WAILS gated callers); cast is intentional.
  return window.go!.app!.App![method]!(...args) as Promise<T>
}

async function _get<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(await r.text())
  return r.json() as Promise<T>
}

async function _post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json() as Promise<T>
}

// ─── App methods ───────────────────────────────────────────────────────────

export function GetVersion(): Promise<string> {
  if (IS_WAILS) return _wails('GetVersion')
  return _get<{ version: string }>('/api/version').then(d => d.version)
}

export function GetMatchResults(): Promise<MatchRecord[]> {
  if (IS_WAILS) return _wails('GetMatchResults')
  return _get<MatchRecord[]>('/api/match-results')
}

export function GetScreenshotsDir(): Promise<string> {
  if (IS_WAILS) return _wails('GetScreenshotsDir')
  return _get<{ path: string }>('/api/screenshots-dir').then(d => d.path)
}

// In server mode: prompt the user for a path and POST it. Falls back
// to the existing value on cancel (mirrors Wails dialog-cancel behavior).
export async function PickScreenshotsDir(): Promise<string> {
  if (IS_WAILS) return _wails('PickScreenshotsDir')
  const current = await _get<{ path: string }>('/api/screenshots-dir').then(d => d.path)
  const p = window.prompt('Screenshots directory path:', current)
  if (!p) return current
  await _post('/api/screenshots-dir', { path: p })
  return p
}

export function ParseScreenshots(): Promise<void> {
  if (IS_WAILS) return _wails('ParseScreenshots')
  return _post('/api/parse').then(() => undefined)
}

export function GetPrometheusEnabled(): Promise<boolean> {
  if (IS_WAILS) return _wails('GetPrometheusEnabled')
  return _get<{ enabled: boolean }>('/api/prometheus-enabled').then(d => d.enabled)
}

export function SetPrometheusEnabled(enabled: boolean): Promise<void> {
  if (IS_WAILS) return _wails('SetPrometheusEnabled', enabled)
  return _post('/api/prometheus-enabled', { enabled }).then(() => undefined)
}

export function GetWatchEnabled(): Promise<boolean> {
  if (IS_WAILS) return _wails('GetWatchEnabled')
  return _get<{ enabled: boolean }>('/api/watch-enabled').then(d => d.enabled)
}

export function SetWatchEnabled(enabled: boolean): Promise<void> {
  if (IS_WAILS) return _wails('SetWatchEnabled', enabled)
  return _post('/api/watch-enabled', { enabled }).then(() => undefined)
}

export function GetTesseractStatus(): Promise<TesseractStatus> {
  if (IS_WAILS) return _wails('GetTesseractStatus')
  return _get<TesseractStatus>('/api/tesseract-status')
}

export function SetTesseractPath(path: string): Promise<TesseractStatus> {
  if (IS_WAILS) return _wails('SetTesseractPath', path)
  return _post<TesseractStatus>('/api/tesseract-path', { path })
}

// In server mode: prompt for the binary path then POST it.
export async function PickTesseractBinary(): Promise<TesseractStatus> {
  if (IS_WAILS) return _wails('PickTesseractBinary')
  const current = await _get<TesseractStatus>('/api/tesseract-status').then(d => d.path || '')
  const p = window.prompt('Path to Tesseract binary:', current)
  if (!p) return _get<TesseractStatus>('/api/tesseract-status')
  return _post<TesseractStatus>('/api/tesseract-path', { path: p })
}

export function ResetTesseractPath(): Promise<TesseractStatus> {
  if (IS_WAILS) return _wails('ResetTesseractPath')
  return _post<TesseractStatus>('/api/tesseract-reset')
}

export function ClearDatabase(): Promise<void> {
  if (IS_WAILS) return _wails('ClearDatabase')
  return _post('/api/clear-database').then(() => undefined)
}

export function GetNewScreenshotCount(): Promise<number> {
  if (IS_WAILS) return _wails('GetNewScreenshotCount')
  return _get<{ count: number }>('/api/new-screenshot-count').then(d => d.count)
}

// ─── Events ────────────────────────────────────────────────────────────────
// In Wails mode: thin pass-through to window.runtime.
// In server mode: EventSource on /api/events, keyed by event name so
//   EventsOff can close the matching source.

const _sources: Record<string, EventSource> = {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function EventsOn(eventName: string, callback: (data: any) => void): void {
  if (IS_WAILS) {
    window.runtime!.EventsOn(eventName, callback)
    return
  }
  // Close any previous source for this event before opening a new one
  // (guards against double-mount in development HMR scenarios).
  if (_sources[eventName]) {
    _sources[eventName].close()
  }
  const es = new EventSource('/api/events')
  es.addEventListener(eventName, (e) => {
    try { callback((e as MessageEvent).data ? JSON.parse((e as MessageEvent).data) : null) } catch (_) { callback(null) }
  })
  _sources[eventName] = es
}

export function EventsOff(eventName: string): void {
  if (IS_WAILS) {
    window.runtime!.EventsOff(eventName)
    return
  }
  if (_sources[eventName]) {
    _sources[eventName].close()
    delete _sources[eventName]
  }
}
