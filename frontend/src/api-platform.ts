/**
 * api-platform.ts — the surviving dual-mode surface after the transport
 * unification. JSON calls all go through the generated SDK facade in
 * api.ts (one fetch transport, both modes); what remains here is the
 * genuinely platform-bound surface:
 *
 *   - the runtime detection (IS_WAILS) + Call.ByName escape hatch for the
 *     native-dialog methods in pkg/app/app_wails.go
 *   - OpenURL (system browser vs window.open)
 *   - the events bridge (Wails event bus vs a shared EventSource — SSE
 *     cannot ride the Wails asset server on Windows, see pkg/cmd's
 *     newAPIMux)
 *   - the binary import/export paths: the NATIVE half (save/load dialogs)
 *     plus the browser half's DOM plumbing (blob download, file picker).
 *     The HTTP half of those goes through the generated SDK like
 *     everything else — only the DOM work is hand-written here.
 */

import { Browser, Call, Events } from '@wailsio/runtime'

import { unwrap, unwrapWithResponse } from '@/api-unwrap'
import { IS_WAILS } from '@/platform'
import * as sdk from '@/client/sdk.gen'
import type { BundleShare, CoachReturnSheet, CoachSessionView } from '@/client/types.gen'

// Fully-qualified prefix for the bound App service — the v3 runtime resolves a
// Call.ByName against `packagePath.typeName.method` (see pkg/app's App service,
// registered via application.NewService). Hand-maintained so nothing imports
// the generated frontend/bindings/.
const APP_FQN = 'recall/pkg/app.App.'

// IS_WAILS (the serving-origin detector) lives in the dependency-free
// @/platform leaf so leaf components can read it without pulling the SDK
// or the Wails runtime into their chunk. Re-exported here because this is
// where the dual-mode surface consumes it.
export { IS_WAILS } from '@/platform'

// wailsCall dispatches a native-dialog method by FQN. IS_WAILS-gated callers
// only; CancellablePromise is a Promise subtype, so the cast is safe.
export function wailsCall<T>(method: string, ...args: unknown[]): Promise<T> {
  return Call.ByName(APP_FQN + method, ...args) as unknown as Promise<T>
}

// OpenURL opens a URL in the OS default browser. In Wails mode the WebView
// does not route target="_blank" links to the system browser, so we call the
// runtime explicitly. In server/browser mode window.open suffices.
export function OpenURL(url: string): void {
  if (IS_WAILS) {
    void Browser.OpenURL(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

// ─── Binary import/export ──────────────────────────────────────────────────

// Which archive an import turned out to be. The server sniffs ZIP entry
// names before parsing anything, so one affordance ("Import matches…")
// accepts both a shared bundle and a coach's notes.
export type MatchImportKind = 'bundle' | 'coach_notes'

// MatchImportResult is the outcome of an import: where it came from (empty
// path = user canceled) plus the server's union answer — merge counts for a
// bundle, the staged return sheet for a coach's notes archive. The counts
// are always present (a bundle whose keys all existed is "imported 0,
// skipped 12"); `return` only on the coach_notes arm.
export interface MatchImportResult {
  path:     string
  kind:     MatchImportKind
  imported: number
  skipped:  number
  return?:  CoachReturnSheet
}

// CoachSessionResult is the native open-a-bundle dialog's return: the path
// the coach picked (empty on cancel) plus the session it opened.
interface CoachSessionResult {
  path:     string
  session?: CoachSessionView
}

const IMPORT_CANCELED: MatchImportResult = { path: '', kind: 'bundle', imported: 0, skipped: 0 }

// tsFilenameStamp builds a filesystem-safe `YYYY-MM-DDTHH-MM-SS` stamp for a
// fallback download name when the server omits Content-Disposition.
function tsFilenameStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

// triggerBlobDownload hands a Blob to the browser as a named download via a
// transient <a download> click.
function triggerBlobDownload(blob: Blob, name: string): void {
  const blobURL = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobURL
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobURL)
}

// contentDispositionName extracts the server-provided filename, falling back
// when the header is absent.
function contentDispositionName(r: Response, fallback: string): string {
  const cd = r.headers.get('Content-Disposition') ?? ''
  const matched = /filename="([^"]+)"/.exec(cd)
  return matched?.[1] ?? fallback
}

// saveBlobResponse turns an SDK binary result into a browser download,
// resolving with the saved filename.
async function saveBlobResponse(
  result: Promise<{ data?: Blob | File; error?: unknown; response?: Response }>,
  fallbackName: string,
  // The caller supplied the name deliberately (the user typed it), so the
  // server's Content-Disposition must not override it.
  nameIsChosen = false,
): Promise<string> {
  const { data, response } = await unwrapWithResponse(result)
  const name = nameIsChosen ? fallbackName : contentDispositionName(response, fallbackName)
  triggerBlobDownload(data, name)
  return name
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

// BackupDatabase saves a complete native SQLite snapshot of the database.
// Wails delegates to a native save dialog (SaveBackupToFile, "" on cancel);
// server mode streams GET /api/v1/database into a browser download. Resolves
// with the saved filename ("" on a Wails cancel).
export function BackupDatabase(): Promise<string> {
  if (IS_WAILS) return wailsCall<string>('SaveBackupToFile')
  return saveBlobResponse(sdk.backupDatabase(), `recall-backup-${tsFilenameStamp()}.db`)
}

// ExportMatchesCSV saves a flat, one-row-per-match sheet the caller has
// already assembled (matchesToCSV). Wails writes the string through a native
// save dialog (SaveTextToFile, "" on cancel); server/browser mode builds a
// Blob and triggers a transient <a download>. Resolves with the saved
// filename ("" on a Wails cancel). No HTTP in browser mode — the CSV is
// built client-side.
export async function ExportMatchesCSV(csv: string, defaultName: string): Promise<string> {
  if (IS_WAILS) return wailsCall<string>('SaveTextToFile', defaultName, csv)
  triggerBlobDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), defaultName)
  return defaultName
}

// ExportBundle is the selection-aware export. The caller passes the explicit
// match_keys the user ticked plus optional `includeUnknown` / `includeHidden`
// toggles that UNION extra records onto the selection. Wails delegates to a
// native save dialog (SaveBundleToFile); server mode POSTs the request and
// streams the ZIP into a browser download. Resolves with the filename the
// bundle was saved as ("" on user cancel in Wails mode). Throws ApiError on
// a non-2xx HTTP response.
//
// With `share` set the result is a DIFFERENT artifact: the manifest names
// the player, a coach can open it as a session, and a mis-clicked Import
// refuses to merge it. The stable player id is minted and persisted by the
// backend — the caller only supplies the display handle and the optional
// message. Share mode dispatches its own native method rather than passing a
// nullable argument, so the ordinary saver stays incapable of stamping an
// identity into a manifest.
export function ExportBundle(opts: {
  matchKeys:       string[]
  includeUnknown:  boolean
  includeHidden:   boolean
  share?:          BundleShare
  /**
   * What the user typed in the modal. Non-empty wins over the server's
   * Content-Disposition and over the generated stem — naming the file is
   * the only reason that field exists.
   */
  filename?:       string
}): Promise<string> {
  const chosen = opts.filename?.trim() ?? ''
  // Both modes take the same default name; Wails opens its dialog with it,
  // the browser saves under it outright.
  if (IS_WAILS) {
    return saveBundleNatively({
      ...opts,
      filename: chosen || `recall-${opts.share ? 'share' : 'bundle'}-${tsFilenameStamp()}.zip`,
    })
  }
  return saveBlobResponse(
    sdk.exportBundle({
      body: {
        match_keys:      opts.matchKeys,
        include_unknown: opts.includeUnknown,
        include_hidden:  opts.includeHidden,
        ...(opts.share ? { share: opts.share } : {}),
      },
    }),
    chosen || `recall-${opts.share ? 'share' : 'bundle'}-${tsFilenameStamp()}.zip`,
    chosen !== '',
  )
}

function saveBundleNatively(opts: {
  matchKeys:      string[]
  includeUnknown: boolean
  includeHidden:  boolean
  filename?:      string
  share?:         BundleShare
}): Promise<string> {
  // The filename travels even though the native dialog owns the naming: it
  // is what the dialog OPENS with, and hard-coding it there meant a share
  // was offered as `recall-bundle-...` while the modal beside it said
  // `recall-share-...` — the one distinction that tells a coach's copy from
  // the player's own backups later.
  const selection = [opts.matchKeys, opts.includeUnknown, opts.includeHidden] as const
  const name = opts.filename ?? ''
  if (opts.share) return wailsCall<string>('SaveShareBundleToFile', ...selection, opts.share, name)
  return wailsCall<string>('SaveBundleToFile', ...selection, name)
}

// ExportDiagnosticBundle builds the parser-triage zip (failed screenshots +
// logs + environment manifest). Wails routes through the native save dialog
// (SaveDiagnosticBundleToFile); server mode POSTs and streams the ZIP into a
// browser download. Resolves with the saved filename ("" on user cancel in
// Wails mode).
export function ExportDiagnosticBundle(): Promise<string> {
  if (IS_WAILS) return wailsCall<string>('SaveDiagnosticBundleToFile')
  return saveBlobResponse(
    sdk.exportDiagnosticBundle(),
    `recall-diagnostic-${tsFilenameStamp()}.zip`,
  )
}

// RestoreDatabase REPLACES the local database with a chosen `.db` snapshot.
// Wails opens a native picker (LoadRestoreFromFile); server mode reads the
// chosen file and PUTs it to /api/v1/database. Resolves with the file name
// ("" on cancel). Destructive — the caller must confirm first.
export async function RestoreDatabase(): Promise<string> {
  if (IS_WAILS) return wailsCall('LoadRestoreFromFile')
  const file = await pickFile('.db,application/octet-stream,application/x-sqlite3')
  if (!file) return ''
  // The generated op carries bodySerializer: null + the octet-stream
  // content type, so the File streams through unmodified.
  await unwrap(sdk.restoreDatabase({ body: file }))
  return file.name
}

// ImportMatches takes either archive a user can hand Recall. A bundle
// MERGES its matches into the local database (additive, existing keys
// skipped, nothing wiped); a coach's notes archive is STAGED as a return
// sheet and changes no match until the player accepts a note. Wails opens a
// native picker (LoadMatchImportFromFile); server mode reads the chosen file
// and POSTs it to /api/v1/imports. Resolves with an empty path on cancel —
// Go's zero result carries no kind, so a cancel normalizes onto the bundle
// arm and the discriminant stays trustworthy once `path` is non-empty.
export async function ImportMatches(): Promise<MatchImportResult> {
  if (IS_WAILS) {
    const picked = await wailsCall<MatchImportResult>('LoadMatchImportFromFile')
    return picked?.path ? picked : IMPORT_CANCELED
  }
  const file = await pickFile('application/zip,.zip')
  if (!file) return IMPORT_CANCELED
  const outcome = await unwrap(sdk.importMatches({ body: file }))
  return { path: file.name, ...outcome }
}

// OpenCoachBundle opens a player's exported bundle as a coaching session:
// the records are loaned to the app in memory and never reach the coach's
// database. Wails opens a native picker (LoadCoachBundleFromFile); server
// mode POSTs the chosen bytes to /api/v1/coach/session. Resolves null when
// the user cancels; rejects with ApiError on a refused open (409 when a
// session is already live, or the payload is a notes archive).
export async function OpenCoachBundle(): Promise<CoachSessionView | null> {
  if (IS_WAILS) {
    const opened = await wailsCall<CoachSessionResult>('LoadCoachBundleFromFile')
    return opened?.session ?? null
  }
  const file = await pickFile('application/zip,.zip')
  if (!file) return null
  return unwrap(sdk.openCoachSession({ body: file }))
}

// ExportCoachNotes packs the session's notes into the archive the coach
// hands the player (notes.json + ledger.html). Wails writes it through a
// native save dialog (SaveCoachNotesToFile, "" on cancel); server mode
// streams the ZIP into a browser download. Rejects with ApiError when the
// coach has no name set (409) or there is nothing to export.
export function ExportCoachNotes(): Promise<string> {
  if (IS_WAILS) return wailsCall<string>('SaveCoachNotesToFile')
  return saveBlobResponse(sdk.exportCoachNotes(), `recall-coach-notes-${tsFilenameStamp()}.zip`)
}

// ─── Events ────────────────────────────────────────────────────────────────
// In Wails mode: thin pass-through to the Wails event bus (ExecJS delivery —
//   no network, so no drop scenario; the status handler never fires).
// In server mode: ONE shared EventSource on /api/v1/events for every
//   event name, with per-name listeners. A single source makes the
//   connection state unambiguous, so onopen/onerror can drive the
//   reconnecting indicator the parse-recovery UI needs.

export type EventStreamStatus = 'connected' | 'reconnecting'

let _streamStatusHandler: ((status: EventStreamStatus) => void) | null = null

// Register a single observer of the server-mode SSE connection state.
// Fires 'reconnecting' when the stream drops (EventSource is auto-
// retrying) and 'connected' when it (re)opens. No-op in Wails mode.
export function setEventStreamStatusHandler(cb: ((status: EventStreamStatus) => void) | null): void {
  _streamStatusHandler = cb
}

let _serverSource: EventSource | null = null
const _serverListeners: Record<string, (e: Event) => void> = {}

function ensureServerSource(): EventSource {
  if (_serverSource) return _serverSource
  const es = new EventSource('/api/v1/events')
  es.onopen = () => { _streamStatusHandler?.('connected') }
  es.onerror = () => {
    // The browser auto-reconnects (readyState CONNECTING) unless the
    // source was explicitly closed; surface the gap so the UI can show
    // "reconnecting", and onopen flips it back to 'connected'.
    if (es.readyState !== EventSource.CLOSED) _streamStatusHandler?.('reconnecting')
  }
  _serverSource = es
  return es
}

export function EventsOn<T = unknown>(eventName: string, callback: (data: T) => void): void {
  if (IS_WAILS) {
    // v3 delivers a WailsEvent envelope; unwrap `.data` to match the server-mode
    // payload. Off-then-On gives replace semantics (HMR double-mount guard).
    Events.Off(eventName)
    Events.On(eventName, (ev) => callback(ev.data as T))
    return
  }
  const es = ensureServerSource()
  // Replace any previous listener for this name (HMR double-mount guard).
  const prev = _serverListeners[eventName]
  if (prev) es.removeEventListener(eventName, prev)
  const listener = (e: Event) => {
    try {
      const raw = (e as MessageEvent).data
      callback((raw ? JSON.parse(raw) : null) as T)
    } catch (_) { callback(null as unknown as T) }
  }
  _serverListeners[eventName] = listener
  es.addEventListener(eventName, listener)
}

export function EventsOff(eventName: string): void {
  if (IS_WAILS) {
    Events.Off(eventName)
    return
  }
  const listener = _serverListeners[eventName]
  if (listener && _serverSource) _serverSource.removeEventListener(eventName, listener)
  delete _serverListeners[eventName]
  // Close the shared source once nothing is listening (mirrors the old
  // per-source close on the last EventsOff).
  if (_serverSource && Object.keys(_serverListeners).length === 0) {
    _serverSource.close()
    _serverSource = null
  }
}
