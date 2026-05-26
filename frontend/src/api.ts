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
export type HeroPlay        = components['schemas']['HeroPlay']
export type TesseractStatus = components['schemas']['TesseractStatus']
export type ScreenshotType  = components['schemas']['ScreenshotType']

// Detect whether the Wails IPC bridge has been injected. The bridge is
// only present when the page is loaded inside the native Wails webview.
declare global {
  interface Window {
    // Wails IPC bridge — dynamically generated, inherently untyped at this boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    go?: { app?: { App?: Record<string, (...args: any[]) => Promise<unknown>> } }
    runtime?: {
      EventsOn: (n: string, cb: (data: unknown) => void) => void
      EventsOff: (n: string) => void
      BrowserOpenURL: (url: string) => void
    }
  }
}

const IS_WAILS = typeof window !== 'undefined' && !!window.go?.app?.App

// OpenURL opens a URL in the OS default browser. In Wails mode the WebView
// does not route target="_blank" links to the system browser, so we must call
// the runtime bridge explicitly. In server/browser mode window.open suffices.
export function OpenURL(url: string): void {
  if (IS_WAILS && window.runtime?.BrowserOpenURL) {
    window.runtime.BrowserOpenURL(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

// ─── Error type ───────────────────────────────────────────────────────────

// ApiError is thrown by all server-mode fetch calls when the server responds
// with a non-2xx status. The status code lets callers distinguish
// user/config errors (4xx) from unexpected server faults (5xx).
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`HTTP ${status}: ${body}`)
    this.name = 'ApiError'
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function _wails<T>(method: string, ...args: unknown[]): Promise<T> {
  // Bridge is present (IS_WAILS gated callers); cast is intentional.
  return window.go!.app!.App![method]!(...args) as Promise<T>
}

async function _fetch<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init)
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new ApiError(r.status, body)
  }
  return r.json() as Promise<T>
}

function _get<T>(path: string): Promise<T> {
  return _fetch<T>(path)
}

function _post<T>(path: string, body?: unknown): Promise<T> {
  return _fetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// ─── App methods ───────────────────────────────────────────────────────────

export function GetVersion(): Promise<string> {
  if (IS_WAILS) return _wails('GetVersion')
  return _get<{ version: string }>('/api/version').then(d => d.version)
}

export type UpdateInfo = { checked: boolean; dev_build: boolean; available: boolean; latest: string; url: string }

export function CheckForUpdate(): Promise<UpdateInfo> {
  if (IS_WAILS) return _wails('CheckForUpdate')
  return _get<UpdateInfo>('/api/check-update')
}

export function GetMatchResults(): Promise<MatchRecord[]> {
  if (IS_WAILS) return _wails('GetMatchResults')
  return _get<MatchRecord[]>('/api/match-results')
}

export type OWData = {
  heroes_by_role: Record<string, string[]>
  maps_by_type:   Record<string, string[]>
}

// Static Overwatch reference data baked into the parser at compile
// time from pkg/parser/{heroes,maps}.yaml. Stable across a session —
// callers may fetch once at app load and cache.
export function GetOWData(): Promise<OWData> {
  if (IS_WAILS) return _wails('GetOWData')
  return _get<OWData>('/api/owdata')
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

export type ProbeResult = {
  found: boolean
  path?: string
  tried: string[]
}

// ProbeScreenshotsDir walks platform-specific OW default-screenshot
// locations and returns the first directory that exists. Read-only —
// the caller decides whether to apply the result via
// PickScreenshotsDir / SetScreenshotsDir.
export function ProbeScreenshotsDir(): Promise<ProbeResult> {
  if (IS_WAILS) return _wails('ProbeScreenshotsDir')
  return _get<ProbeResult>('/api/probe-screenshots-dir')
}

// SetScreenshotsDir persists `path` as the active screenshots
// directory. Used by the "Detect Overwatch Folder" button to apply
// a probe result without going through the native folder picker.
export function SetScreenshotsDir(path: string): Promise<void> {
  if (IS_WAILS) return _wails('SetScreenshotsDir', path)
  return _post('/api/screenshots-dir', { path }).then(() => undefined)
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

// ─── Data location + export/import ─────────────────────────────────────────

export type DataLocation = {
  base_dir:        string
  settings_path:   string
  database_path:   string
  screenshots_dir: string
}

export function GetDataLocation(): Promise<DataLocation> {
  if (IS_WAILS) return _wails('GetDataLocation')
  return _get<DataLocation>('/api/data-location')
}

// Export — in Wails mode, the native save dialog handles file writing
// and the call resolves with the chosen path ("" on cancel). In server
// mode we fetch the payload as a blob and trigger a browser download
// using a transient <a download> click.
export function ExportData(): Promise<string> {
  return downloadExport('json')
}

// CSV-format export. Wraps the parsed-match tables as a ZIP of CSV
// files + a manifest.json — same data as ExportData, different
// container chosen by the user.
export function ExportDataCSV(): Promise<string> {
  return downloadExport('csv')
}

async function downloadExport(format: 'json' | 'csv'): Promise<string> {
  if (IS_WAILS) {
    return _wails(format === 'csv' ? 'SaveExportToFileCSV' : 'SaveExportToFile')
  }
  const url = format === 'csv' ? '/api/export.csv' : '/api/export'
  const r = await fetch(url)
  if (!r.ok) throw new ApiError(r.status, await r.text().catch(() => ''))
  // Pull the server-suggested filename out of Content-Disposition.
  const cd = r.headers.get('Content-Disposition') ?? ''
  const matched = /filename="([^"]+)"/.exec(cd)
  const ext = format === 'csv' ? 'zip' : 'json'
  const fallback = `recall-export-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`
  const name = matched?.[1] ?? fallback
  const blob = await r.blob()
  const blobURL = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobURL
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobURL)
  return name
}

// Import — Wails opens a native file picker and runs ImportData
// in-process; resolves with the path ("" on cancel). Server mode
// opens a transient <input type=file> accepting either .json or
// .zip (CSV-flavored exports are ZIP archives), reads the chosen
// file as bytes, and POSTs to /api/import with a content-type
// matching the format. The server sniffs the payload's first bytes
// and routes between the JSON and CSV codepaths automatically.
export async function ImportData(): Promise<string> {
  if (IS_WAILS) return _wails('LoadImportFromFile')
  const file = await pickFile('application/json,application/zip,.json,.zip')
  if (!file) return ''
  // Read as ArrayBuffer so ZIP archives survive the round-trip — a
  // .text() call would mangle binary bytes via UTF-8 decoding.
  const buf = await file.arrayBuffer()
  const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip'
  const r = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': isZip ? 'application/zip' : 'application/json' },
    body: buf,
  })
  if (!r.ok) throw new ApiError(r.status, await r.text().catch(() => ''))
  return file.name
}

// pickFile — promise wrapper around a transient <input type=file>.
// Resolves with the selected File, or null on cancel.
function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let resolved = false
    const done = (f: File | null) => {
      if (resolved) return
      resolved = true
      input.remove()
      resolve(f)
    }
    input.addEventListener('change', () => {
      done(input.files?.[0] ?? null)
    })
    input.addEventListener('cancel', () => done(null))
    document.body.appendChild(input)
    input.click()
  })
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

export function EventsOn<T = unknown>(eventName: string, callback: (data: T) => void): void {
  if (IS_WAILS) {
    window.runtime!.EventsOn(eventName, callback as (data: unknown) => void)
    return
  }
  // Close any previous source for this event before opening a new one
  // (guards against double-mount in development HMR scenarios).
  if (_sources[eventName]) {
    _sources[eventName].close()
  }
  const es = new EventSource('/api/events')
  es.addEventListener(eventName, (e) => {
    try {
      const raw = (e as MessageEvent).data
      callback((raw ? JSON.parse(raw) : null) as T)
    } catch (_) { callback(null as unknown as T) }
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
