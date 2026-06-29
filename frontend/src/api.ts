/**
 * api.ts — transport-agnostic wrapper for all Wails-bound App methods
 * and runtime events. Types come from api.gen.d.ts which is generated
 * from api/openapi.yaml by `npm run gen:types` (or `make gen-types`).
 *
 * In Wails mode (native window):  delegates to window['go']['app']['App']
 *   and window.runtime — identical behavior to the generated wailsjs/ bindings.
 *
 * In server mode (regular browser): uses fetch('/api/v1/...') for calls and
 *   EventSource('/api/v1/events') for the parse-complete notification.
 *
 * Server-mode HTTP conventions:
 *   - All JSON endpoints under /api/v1/.
 *   - GET to read, PUT to replace/upsert a resource, DELETE to clear
 *     or reset, POST to start an action that doesn't map to a single
 *     resource (the parse run).
 *   - Writers with no useful return body resolve via the 204 No Content
 *     branch in _fetch.
 */

import { Browser, Call, Events } from '@wailsio/runtime'

import type { components } from '@/api.gen'

// Re-exported types — consumers (App.vue) import these instead of
// reaching into api.gen directly.
export type MatchRecord       = components['schemas']['MatchRecord']
export type MatchResult       = components['schemas']['MatchResult']
export type HeroPlay          = components['schemas']['HeroPlay']
export type TesseractStatus   = components['schemas']['TesseractStatus']
export type ScreenshotType    = components['schemas']['ScreenshotType']
export type ProfilesResponse  = components['schemas']['ProfilesResponse']
export type SeedTestProfileResponse = components['schemas']['SeedTestProfileResponse']
export type UserMatchDataInput = components['schemas']['UserMatchDataInput']
export type ManualMatchInput   = components['schemas']['ManualMatchInput']
export type ProblemDetails     = components['schemas']['ProblemDetails']

// Fully-qualified prefix for the bound App service — the v3 runtime resolves a
// Call.ByName against `packagePath.typeName.method` (see pkg/app's App service,
// registered via application.NewService). Keeps api.ts a hand-maintained seam
// with no import from the generated frontend/bindings/.
const APP_FQN = 'recall/pkg/app.App.'

// Detect the native Wails v3 webview by its user-agent marker. The webview's UA
// carries the Wails application name ("wails.io" by default), set synchronously
// at webview creation — so it's reliably present when this module first loads.
// (window._wails.flags is NOT: the backend injects it LATER via ExecJS, after
// this const would already have evaluated, so it read as false on boot and every
// call wrongly took the fetch path.) A regular browser (server mode) + the test
// env lack the marker. We match the bare "wails" token, NOT a hostname-shaped
// literal, so CodeQL's incomplete-URL-sanitization rule stays quiet. Stays a
// `const` so tree-shakers can fold the dead branch at build time.
const IS_WAILS = typeof navigator !== 'undefined' && navigator.userAgent.includes('wails')

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

// ─── Error type ───────────────────────────────────────────────────────────

// ApiError is thrown by all server-mode fetch calls when the server responds
// with a non-2xx status. The status code lets callers distinguish
// user/config errors (4xx) from unexpected server faults (5xx).
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    // The parsed RFC 9457 problem object when the server replied with
    // application/problem+json (server mode); undefined for plain-text errors
    // and the Wails bridge's raw Go errors.
    public readonly problem?: ProblemDetails,
  ) {
    super(`HTTP ${status}: ${body}`)
    this.name = 'ApiError'
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function _wails<T>(method: string, ...args: unknown[]): Promise<T> {
  // IS_WAILS-gated callers only; the v3 runtime resolves the FQN to the bound
  // App method. CancellablePromise is a Promise subtype, so the cast is safe.
  return Call.ByName(APP_FQN + method, ...args) as unknown as Promise<T>
}

// _apiError builds an ApiError from a non-ok Response. It parses the server's
// RFC 9457 application/problem+json body into the human-readable `detail` (kept
// on `body` so existing call sites that read `.body` still work) plus the
// structured `problem`; it falls back to plain text for any non-problem response
// (the SPA file server, a proxy).
async function _apiError(r: Response): Promise<ApiError> {
  if ((r.headers.get('content-type') ?? '').includes('application/problem+json')) {
    const p = (await r.json().catch(() => null)) as ProblemDetails | null
    if (p) return new ApiError(r.status, p.detail || p.title || '', p)
  }
  return new ApiError(r.status, await r.text().catch(() => ''))
}

async function _fetch<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init)
  if (!r.ok) {
    throw await _apiError(r)
  }
  // 204 No Content (writers with no useful echo) and 202 Accepted
  // (POST /api/v1/parses) both arrive without a body. r.json() would
  // throw "Unexpected end of JSON input", so short-circuit and let
  // void-returning callers resolve to undefined.
  if (r.status === 204 || r.status === 202) return undefined as T
  return r.json() as Promise<T>
}

function _get<T>(path: string): Promise<T> {
  return _fetch<T>(path)
}

function _send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return _fetch<T>(path, init)
}

// _dualVoid bundles the Wails-vs-fetch branching for every void-
// returning write. Each writer used to repeat the same five lines:
//
//   if (IS_WAILS) return _wails('SetX', arg)
//   return _send('PUT', '/api/v1/x', body).then(() => undefined)
//
// The helper takes a Wails method name, an HTTP method, a fetch path
// (or a function that builds it from args, for hierarchical sub-
// resources like /matches/{key}/annotation), and an optional body
// factory. The fetch branch's `.then(() => undefined)` is the type-
// correct way to discard the server response (204/202 endpoints
// return undefined via _fetch's empty-body special case, so this is
// a no-op at runtime).
function _dualVoid<TArgs extends unknown[]>(
  wailsName: string,
  httpMethod: 'POST' | 'PUT' | 'DELETE',
  fetchPath: ((...args: TArgs) => string) | string,
  body?: (...args: TArgs) => unknown,
): (...args: TArgs) => Promise<void> {
  return (...args: TArgs) => {
    if (IS_WAILS) return _wails(wailsName, ...args)
    const path = typeof fetchPath === 'function' ? fetchPath(...args) : fetchPath
    return _send(httpMethod, path, body?.(...args)).then(() => undefined)
  }
}

// ─── App methods ───────────────────────────────────────────────────────────

export function GetVersion(): Promise<string> {
  if (IS_WAILS) return _wails('GetVersion')
  return _get<{ version: string }>('/api/v1/system/version').then(d => d.version)
}

// Captured Startup failure or empty when boot was clean. App.vue
// calls this on mount and renders a blocking modal when non-empty.
// In server mode the server exits before mounting routes if Startup
// captured an error, so this practically always resolves to "" —
// the route exists for parity + future test harnesses.
export function GetStartupError(): Promise<string> {
  if (IS_WAILS) return _wails('GetStartupError')
  return _get<{ message: string }>('/api/v1/system/startup-error').then(d => d.message)
}

type GameDataStatus = {
  commit_sha:       string
  committed_at?:    string
  applied_commit:   string
  applied_at?:      string
  has_update:       boolean
  added_heroes?:    string[]
  removed_heroes?:  string[]
  added_maps?:      string[]
  removed_maps?:    string[]
  added_sources?:   string[]
  removed_sources?: string[]
}

export type UpdateInfo = {
  checked:          boolean
  dev_build:        boolean
  available:        boolean
  latest:           string
  url:              string
  latest_heroes?:   string[]
  latest_maps?:     string[]
  latest_sources?:  string[]
  last_checked_at?: string
  release_notes?:   string
  game_data:        GameDataStatus
}

export function CheckForUpdate(): Promise<UpdateInfo> {
  if (IS_WAILS) return _wails('CheckForUpdate')
  return _get<UpdateInfo>('/api/v1/system/update')
}

export type DataUpdateResult = {
  applied_commit:   string
  added_heroes?:    string[]
  removed_heroes?:  string[]
  added_maps?:      string[]
  removed_maps?:    string[]
  added_sources?:   string[]
  removed_sources?: string[]
}

// ApplyGameDataUpdate pulls the live YAMLs from
// https://sound-barrier.github.io/recall/data/ (the main channel
// published by .github/workflows/pages.yml on every push that touches
// pkg/parser/*.yaml), SHA-256-verifies them, and swaps the running
// parser dataset. The apply commit SHA is echoed back in
// DataUpdateResult.applied_commit. Throws ApiError (status 502) when
// Pages is unreachable, 422 on SHA mismatch, 500 on local disk failure.
export function ApplyGameDataUpdate(): Promise<DataUpdateResult> {
  if (IS_WAILS) return _wails('ApplyGameDataUpdate')
  return _send<DataUpdateResult>('POST', '/api/v1/system/data-update')
}

export function GetMatchResults(): Promise<MatchRecord[]> {
  if (IS_WAILS) return _wails('GetMatchResults')
  return _get<MatchRecord[]>('/api/v1/matches')
}

export type OWData = {
  heroes_by_role:     Record<string, string[]>
  maps_by_game_mode:       Record<string, string[]>
  screenshot_sources: Array<{
    name: string
    prefix: string
    regex: string
    year_offset: number
    example: string
  }>
}

// Static Overwatch reference data baked into the parser at compile
// time from pkg/parser/{heroes,maps}.yaml. Stable across a session —
// callers may fetch once at app load and cache.
export function GetOWData(): Promise<OWData> {
  if (IS_WAILS) return _wails('GetOWData')
  return _get<OWData>('/api/v1/system/reference-data')
}

export function GetScreenshotsDir(): Promise<string> {
  if (IS_WAILS) return _wails('GetScreenshotsDir')
  return _get<{ path: string }>('/api/v1/settings/screenshots-folder').then(d => d.path)
}

// In server mode: prompt the user for a path and PUT it. Falls back
// to the existing value on cancel (mirrors Wails dialog-cancel behavior).
export async function PickScreenshotsDir(): Promise<string> {
  if (IS_WAILS) return _wails('PickScreenshotsDir')
  const current = await _get<{ path: string }>('/api/v1/settings/screenshots-folder').then(d => d.path)
  const p = window.prompt('Screenshots directory path:', current)
  if (!p) return current
  await _send('PUT', '/api/v1/settings/screenshots-folder', { path: p })
  return p
}

export type ProbeResult = {
  found: boolean
  path?: string
  tried: string[]
}

// NamedCandidate is one entry in the Windows screenshot-source
// picker grid (Settings first-run empty state). Mirrors the Go
// struct in `pkg/app/probe.go`. `exists` drives the card's status
// dot + clickability; `name` is the stable id ('nvidia' | 'prntscn'
// | 'snip' | 'steam') used for keying + telemetry.
export type NamedCandidate = {
  name:   'nvidia' | 'prntscn' | 'snip' | 'steam'
  label:  string
  path:   string
  exists: boolean
}

// GetScreenshotsFolderCandidates returns the per-source picker list
// (empty on macOS / Linux — auto-detect is Windows-only by design;
// the frontend hides the grid on those platforms).
export function GetScreenshotsFolderCandidates(): Promise<NamedCandidate[]> {
  if (IS_WAILS) return _wails('ProbeScreenshotsCandidates')
  return _get<NamedCandidate[]>('/api/v1/system/screenshots-folder-candidates')
}

// NamedCandidateStats is the per-source diagnostic blob the picker
// grid hydrates AFTER the cards mount. file_count + last_modified +
// recognised_count compose into the second metadata line on each
// card. Mirrors the Go struct in `pkg/app/probe.go`.
export type NamedCandidateStats = {
  name:             NamedCandidate['name']
  file_count:       number
  last_modified:    string  // RFC3339 UTC, empty when no files
  recognised_count: number
}

// GetScreenshotsFolderCandidateStats is the deferred per-source
// diagnostics call. The picker grid fetches this after the cards
// mount so the directory walk (bounded to 1000 entries per source)
// doesn't block the visible UI. Empty array on macOS / Linux.
export function GetScreenshotsFolderCandidateStats(): Promise<NamedCandidateStats[]> {
  if (IS_WAILS) return _wails('ProbeScreenshotsCandidateStats')
  return _get<NamedCandidateStats[]>('/api/v1/system/screenshots-folder-candidates/stats')
}

// SetScreenshotsDir persists `path` as the active screenshots
// directory. Used by the "Detect Overwatch Folder" button to apply
// a probe result without going through the native folder picker.
export const SetScreenshotsDir = _dualVoid<[path: string]>(
  'SetScreenshotsDir',
  'PUT',
  '/api/v1/settings/screenshots-folder',
  (path) => ({ path }),
)

// ResetScreenshotsDir clears the persisted screenshots folder and
// tears down the watcher. Symmetric with ResetTesseractPath. UI:
// the Reset button in SettingsFolders' steady-state row.
export const ResetScreenshotsDir = _dualVoid<[]>(
  'ResetScreenshotsDir',
  'DELETE',
  '/api/v1/settings/screenshots-folder',
)

// RevealScreenshotsDir opens the configured folder in the host OS
// file manager. Replaces the old BrowserOpenURL('file://…') shape
// which Wails v2.12 rejects with "scheme not allowed". No path
// argument: the configured folder is the only thing this action
// reveals, so passing an arbitrary path would widen attack surface.
export const RevealScreenshotsDir = _dualVoid<[]>(
  'RevealScreenshotsDir',
  'POST',
  '/api/v1/system/screenshots-folder-reveal',
)

// Per-match user annotation. All fields are optional but at least one
// must carry content — PUT is upsert-only and rejects an all-empty body
// (400). Clearing a row is DeleteMatchAnnotation (DELETE). `leaver`
// ∈ {'self', 'team', 'enemy', ''}.
type LeaverKind = 'self' | 'team' | 'enemy'

export interface MatchAnnotationInput {
  leaver?:      LeaverKind | ''
  note?:        string
  replay_code?: string
  members?:     string[]
  // Free-form match labels — `stack`, `stream`, `placement` are the
  // three conventional ones surfaced as quick-add toggles in the
  // inline editor. Server lowercases + dedupes; any string is
  // accepted. Empty array (or omitted) = no tags on this match.
  tags?:        string[]
}

// Match annotations are a hierarchical sub-resource of the parent
// match (PUT /api/v1/matches/{matchKey}/annotation), so the HTTP
// body carries only the annotation fields — match_key lives in the
// URL. Wails mode can't use the same body shape: the Go method's
// signature is `SetMatchAnnotation(in AnnotationInput)` (one struct,
// match_key inside it), so the bridge gets a single argument with
// Go-field-name keys. Mismatched arity ("received 2 arguments to
// method 'app.App.SetMatchAnnotation', expected 1") is exactly what
// the old `_dualVoid` form produced — it spread (matchKey, input)
// into two positional args on the Wails path. SetMatchAnnotation
// always sends the full four-field row so partial inputs from the
// frontend (note-only edit, members-only edit) don't accidentally
// null fields the user typed in another input.
export function SetMatchAnnotation(matchKey: string, input: MatchAnnotationInput): Promise<void> {
  if (IS_WAILS) {
    // AnnotationInput in pkg/app/match_annotation.go has no json
    // tags, so encoding/json uses exact Go field names. Pass them
    // verbatim — anything else case-insensitive-fails to match.
    return _wails('SetMatchAnnotation', {
      MatchKey:   matchKey,
      Leaver:     input.leaver ?? '',
      Note:       input.note ?? '',
      ReplayCode: input.replay_code ?? '',
      Members:    input.members ?? [],
      Tags:       input.tags ?? [],
    })
  }
  const path = `/api/v1/matches/${encodeURIComponent(matchKey)}/annotation`
  return _send('PUT', path, {
    leaver:      input.leaver ?? '',
    note:        input.note ?? '',
    replay_code: input.replay_code ?? '',
    members:     input.members ?? [],
    tags:        input.tags ?? [],
  }).then(() => undefined)
}

// Clear a match's annotation row entirely (members + tags cascade). The
// explicit verb that replaced the old all-empty-PUT-deletes overload;
// the frontend calls this when an edit leaves the annotation empty.
// Idempotent — deleting an absent annotation resolves quietly.
export const DeleteMatchAnnotation = _dualVoid<[matchKey: string]>(
  'DeleteMatchAnnotation',
  'DELETE',
  (matchKey) => `/api/v1/matches/${encodeURIComponent(matchKey)}/annotation`,
)

// Hard-delete a single match. Every parent row + annotation + the
// hidden_matches flag for matchKey is wiped from the database — the
// screenshot files on disk are untouched, so a re-parse will
// rediscover them. Idempotent: unknown keys resolve quietly.
// Surfaced by the Hidden drawer's "Delete forever" affordance after
// the user has already moved the match to the archive.
export const HardDeleteMatch = _dualVoid<[matchKey: string]>(
  'HardDeleteMatch',
  'DELETE',
  (matchKey) => `/api/v1/matches/${encodeURIComponent(matchKey)}`,
)

// Hand-enter a match (no OCR). The server derives the match_key from
// played_at (default now), 409s on a collision, and returns the created
// MatchRecord (source: "manual"). The detail-panel choosers then work
// unchanged, keyed by the new match_key.
export function CreateManualMatch(input: ManualMatchInput): Promise<MatchRecord> {
  if (IS_WAILS) return _wails<MatchRecord>('CreateManualMatch', input)
  return _send<MatchRecord>('POST', '/api/v1/matches', input)
}

// Replace a match's user-data override set — the editable copy kept
// separate from the parsed OCR rows. The body is the FULL override set; a
// per-field revert is the same call omitting that field. Idempotent.
export const UpdateMatchData = _dualVoid<[matchKey: string, input: UserMatchDataInput]>(
  'UpdateMatchData',
  'PUT',
  (matchKey) => `/api/v1/matches/${encodeURIComponent(matchKey)}/data`,
  (_matchKey, input) => input,
)

// Reset a match to pure OCR by clearing its override set, reverting an
// edited OCR match to its parsed values. Idempotent. (Deleting a manual
// match is HardDeleteMatch instead.)
export const ResetMatchData = _dualVoid<[matchKey: string]>(
  'ResetMatchData',
  'DELETE',
  (matchKey) => `/api/v1/matches/${encodeURIComponent(matchKey)}/data`,
)

// Permanently ignore a screenshot — backs the Unknown tab's
// "Delete forever" affordance. Adds the filename to the
// suppress-list (so future parse runs skip it) AND wipes the
// matching unmatched- / ambiguous- match rows so the Unknown card
// disappears immediately. The on-disk file is NOT deleted —
// "forever" means "forever ignored by Recall", not "wiped from
// your drive." Idempotent.
export const IgnoreScreenshot = _dualVoid<[filename: string]>(
  'IgnoreScreenshot',
  'PUT',
  (filename) => `/api/v1/screenshots/${encodeURIComponent(filename)}/ignore`,
)

// Restore an ignored screenshot — backs the Settings → Advanced →
// Manage ignored files panel's per-row Restore button. Removes the
// filename from the suppress-list so the next Parse run picks it back
// up off disk. Idempotent on filenames that aren't ignored.
export const UnignoreScreenshot = _dualVoid<[filename: string]>(
  'UnignoreScreenshot',
  'DELETE',
  (filename) => `/api/v1/screenshots/${encodeURIComponent(filename)}/ignore`,
)

// Bulk truncate the suppress-list — Settings panel's "Re-enable all"
// action. Idempotent; resolves to undefined even when the list was
// already empty.
export const ClearIgnoredScreenshots = _dualVoid<[]>(
  'ClearIgnoredScreenshots',
  'DELETE',
  '/api/v1/screenshots/ignored',
)

// Returned row from GetIgnoredScreenshots. Pre-1.0 the project keeps
// the wire type narrow — the Settings panel renders `filename` +
// `ignored_at` and nothing else.
export type IgnoredScreenshot = {
  filename:   string
  ignored_at: string
}

// List the suppress-list with timestamps. Sorted most-recently-
// ignored first; tie-break is filename ASC.
export function GetIgnoredScreenshots(): Promise<IgnoredScreenshot[]> {
  if (IS_WAILS) return _wails('GetIgnoredScreenshots')
  return _get<IgnoredScreenshot[]>('/api/v1/screenshots/ignored')
}


// Per-match review-status tag. `reviewedBy` is `'self'` (user
// reviewed the VOD themselves), `'coach'` (a coach reviewed it),
// or `''` (the implicit "not reviewed" third state — clears the
// tag). An empty value issues a DELETE on the row; `'self'` or
// `'coach'` issues a PUT. Both directions are idempotent.
//
// Wails-side dispatches to two separate App methods
// (SetMatchReview / ClearMatchReview) so the bridge resolves the
// right one based on whether reviewedBy is the empty string.
export type ReviewedBy = '' | 'self' | 'coach'

export function SetMatchReview(matchKey: string, reviewedBy: ReviewedBy): Promise<void> {
  if (IS_WAILS) {
    return reviewedBy === ''
      ? _wails('ClearMatchReview', matchKey)
      : _wails('SetMatchReview', matchKey, reviewedBy)
  }
  const path = `/api/v1/matches/${encodeURIComponent(matchKey)}/review`
  if (reviewedBy === '') {
    return _send('DELETE', path).then(() => undefined)
  }
  return _send('PUT', path, { reviewed_by: reviewedBy }).then(() => undefined)
}

// Per-match queue-type tag (Role Queue 5v5 vs Open Queue 6v6).
// Empty string clears via DELETE; 'role' or 'open' issues a PUT.
// Both directions are idempotent. Mirrors SetMatchReview's
// dual-transport shape.
export type QueueType = '' | 'role' | 'open'

export function SetMatchQueue(matchKey: string, queueType: QueueType): Promise<void> {
  if (IS_WAILS) {
    return queueType === ''
      ? _wails('ClearMatchQueue', matchKey)
      : _wails('SetMatchQueue', matchKey, queueType)
  }
  const path = `/api/v1/matches/${encodeURIComponent(matchKey)}/queue`
  if (queueType === '') {
    return _send('DELETE', path).then(() => undefined)
  }
  return _send('PUT', path, { queue_type: queueType }).then(() => undefined)
}

// Per-match play-mode override (Quickplay vs Competitive). Empty
// string clears via DELETE, reverting to the aggregator's fallback
// chain (parser data.playlist → rank presence → empty); 'quickplay' or
// 'competitive' issues a PUT. Both directions idempotent. Mirrors
// SetMatchQueue's dual-transport shape.
export type PlayMode = '' | 'quickplay' | 'competitive'

export function SetMatchPlayMode(matchKey: string, playMode: PlayMode): Promise<void> {
  if (IS_WAILS) {
    return playMode === ''
      ? _wails('ClearMatchPlayMode', matchKey)
      : _wails('SetMatchPlayMode', matchKey, playMode)
  }
  const path = `/api/v1/matches/${encodeURIComponent(matchKey)}/play-mode`
  if (playMode === '') {
    return _send('DELETE', path).then(() => undefined)
  }
  return _send('PUT', path, { play_mode: playMode }).then(() => undefined)
}

// Bulk write — apply the same queue_type to every match_key in one
// transaction. '' clears (bulk Clear). Powers the sticky bulk-action
// toolbar; firing 47 per-match PUTs through the dual-transport shim
// would pay 47 round-trips on the server side.
export function BulkSetMatchQueue(matchKeys: string[], queueType: QueueType): Promise<void> {
  if (IS_WAILS) {
    return _wails('BulkSetMatchQueue', matchKeys, queueType)
  }
  return _send('PUT', '/api/v1/matches/queue', {
    match_keys: matchKeys, queue_type: queueType,
  }).then(() => undefined)
}

export function BulkSetMatchPlayMode(matchKeys: string[], playMode: PlayMode): Promise<void> {
  if (IS_WAILS) {
    return _wails('BulkSetMatchPlayMode', matchKeys, playMode)
  }
  return _send('PUT', '/api/v1/matches/play-mode', {
    match_keys: matchKeys, play_mode: playMode,
  }).then(() => undefined)
}

// Soft-delete a match. Reversible: pass hidden=false to restore.
// Both directions are idempotent — repeated identical calls succeed.
// Wails-side this dispatches to HideMatch / UnhideMatch (two
// separate App methods), so the boolean determines which method name
// the bridge resolves. Server-mode posts the new state to the
// /visibility sub-resource on the parent match.
export function SetMatchVisibility(matchKey: string, hidden: boolean): Promise<void> {
  if (IS_WAILS) {
    return hidden ? _wails('HideMatch', matchKey) : _wails('UnhideMatch', matchKey)
  }
  const path = `/api/v1/matches/${encodeURIComponent(matchKey)}/visibility`
  return _send('PUT', path, { hidden }).then(() => undefined)
}

// Resolve an ambiguous-attribution screenshot by attaching every
// parent row carrying the sentinel to the user's chosen match.
// `resolvedTo` must be one of the candidates surfaced on
// `MatchRecord.candidates` OR a freshly-minted "match:<ts>" key
// (the "Treat as new match" escape hatch in the Unknown tab).
export function ResolveAmbiguousMatch(ambiguousMatchKey: string, resolvedTo: string): Promise<void> {
  if (IS_WAILS) {
    return _wails('ResolveAmbiguousMatch', ambiguousMatchKey, resolvedTo)
  }
  const path = `/api/v1/matches/${encodeURIComponent(ambiguousMatchKey)}/resolution`
  return _send('PUT', path, { resolved_to: resolvedTo }).then(() => undefined)
}

export const ParseScreenshots = _dualVoid<[]>(
  'ParseScreenshots',
  'POST',
  '/api/v1/parses',
)

// ReParseAll re-runs OCR on every PNG in the watched folder,
// including files already in the DB. Used by Settings → Advanced →
// "Re-parse all screenshots" after a parser-tightening release
// (e.g. the hero-fuzzy-match length-gate) to retroactively correct
// older rows. The Upsert is idempotent on filename so the user's
// annotations / queue / play-mode / hidden / review state survive.
export function ReParseAll(): Promise<void> {
  if (IS_WAILS) return _wails('ReParseAll')
  return _send('POST', '/api/v1/parses?scope=all').then(() => undefined)
}

// Cancel an in-flight parse. The OCR loop checks ctx.Err()
// between screenshots, so the file in tesseract finishes before
// the loop unwinds. Caller awaits the SSE `parse-cancelled`
// event (handled in useEventStream) to flip the Stop button back
// to Run. 409 surfaces here as a rejected promise — App.vue
// swallows it because the only way it can hit is a race where
// the parse finished naturally before the Stop click landed.
export const CancelParse = _dualVoid<[]>(
  'CancelParse',
  'DELETE',
  '/api/v1/parses/active',
)

// Active-parse status snapshot — the resync anchor for the async parse
// pipeline. A client that reconnects or reloads mid-parse reads this to
// restore "is a parse running, and how far along" without replaying the
// SSE backlog (which isn't replayed on connect).
export interface ActiveParse {
  running: boolean
  done: number
  total: number
  scope: string
}

export function GetActiveParse(): Promise<ActiveParse> {
  if (IS_WAILS) return _wails('ActiveParse')
  return _get<ActiveParse>('/api/v1/parses/active')
}

export function GetWatchEnabled(): Promise<boolean> {
  if (IS_WAILS) return _wails('GetWatchEnabled')
  return _get<{ enabled: boolean }>('/api/v1/settings/watcher').then(d => d.enabled)
}

export const SetWatchEnabled = _dualVoid<[enabled: boolean]>(
  'SetWatchEnabled',
  'PUT',
  '/api/v1/settings/watcher',
  (enabled) => ({ enabled }),
)

export function GetExitOnClose(): Promise<boolean> {
  if (IS_WAILS) return _wails('GetExitOnClose')
  return _get<{ exit_on_close: boolean }>('/api/v1/settings/close-behavior').then(d => d.exit_on_close)
}

export const SetExitOnClose = _dualVoid<[exitOnClose: boolean]>(
  'SetExitOnClose',
  'PUT',
  '/api/v1/settings/close-behavior',
  (exitOnClose) => ({ exit_on_close: exitOnClose }),
)

export function GetTesseractStatus(): Promise<TesseractStatus> {
  if (IS_WAILS) return _wails('GetTesseractStatus')
  return _get<TesseractStatus>('/api/v1/settings/tesseract')
}

// In server mode: prompt for the binary path then PUT it.
export async function PickTesseractBinary(): Promise<TesseractStatus> {
  if (IS_WAILS) return _wails('PickTesseractBinary')
  const current = await _get<TesseractStatus>('/api/v1/settings/tesseract').then(d => d.path || '')
  const p = window.prompt('Path to Tesseract binary:', current)
  if (!p) return _get<TesseractStatus>('/api/v1/settings/tesseract')
  return _send<TesseractStatus>('PUT', '/api/v1/settings/tesseract', { path: p })
}

// Reset to the platform default — modeled server-side as DELETE on
// the tesseract setting (i.e. remove the user-set override).
export function ResetTesseractPath(): Promise<TesseractStatus> {
  if (IS_WAILS) return _wails('ResetTesseractPath')
  return _send<TesseractStatus>('DELETE', '/api/v1/settings/tesseract')
}

// ProbeTesseractBinary walks per-OS install locations + PATH and
// returns the first that resolves to a working Tesseract 5.x. Read-
// only — the caller (Detect button) decides whether to apply via
// SetTesseractPath.
export function ProbeTesseractBinary(): Promise<ProbeResult> {
  if (IS_WAILS) return _wails('ProbeTesseractBinary')
  return _get<ProbeResult>('/api/v1/system/tesseract-probe')
}

// SetTesseractPath applies a known path (from the picker or the
// Detect probe) and returns the re-detected status. Used by the
// Detect button to swap to the discovered binary without forcing
// the user through the picker UI.
export function SetTesseractPath(path: string): Promise<TesseractStatus> {
  if (IS_WAILS) return _wails('SetTesseractPath', path)
  return _send<TesseractStatus>('PUT', '/api/v1/settings/tesseract', { path })
}

// Wipe all parsed-match data — DELETE on the matches collection.
// Settings and the screenshots folder are untouched. Pass
// `keepIgnored = true` to preserve the Unknown-tab "Delete forever"
// suppress list across the wipe; default `false` matches the historic
// factory-reset semantic. Plumbed as `?keep_ignored=true` over fetch
// and as a positional bool over the Wails bridge.
export function ClearDatabase(keepIgnored = false): Promise<void> {
  if (IS_WAILS) return _wails('ClearDatabase', keepIgnored)
  const path = keepIgnored ? '/api/v1/matches?keep_ignored=true' : '/api/v1/matches'
  return _send('DELETE', path).then(() => undefined)
}

// ─── Profiles ─────────────────────────────────────────────────────────────
//
// Each profile is its own settings + SQLite DB under
// <base>/profiles/<name>/. Switching tears down the server's in-memory
// state and re-initializes — the SPA reloads after each Create/Switch
// so every composable re-fetches against the new active profile.

export function GetProfiles(): Promise<ProfilesResponse> {
  if (IS_WAILS) return _wails('GetProfiles')
  return _get<ProfilesResponse>('/api/v1/profiles')
}

// Create-and-activate. Server returns the new state; caller reloads.
export function CreateProfile(name: string): Promise<ProfilesResponse> {
  if (IS_WAILS) {
    return _wails<void>('CreateProfile', name).then(() => GetProfiles())
  }
  return _send<ProfilesResponse>('POST', '/api/v1/profiles', { name })
}

// Onboarding helper: create + seed the sample "test" profile with ~500
// synthetic matches over the rolling last-8-months window so the
// walkthrough can run on real data. Idempotent (reuses an already-seeded
// "test"). Does NOT switch the active profile — the caller does that via
// SwitchProfile afterwards.
export function SeedTestProfile(): Promise<SeedTestProfileResponse> {
  if (IS_WAILS) return _wails<SeedTestProfileResponse>('SeedTestProfile')
  return _send<SeedTestProfileResponse>('POST', '/api/v1/profiles/test/seed')
}

// Switch the active profile. Same shape as CreateProfile — returns
// the new state for callers that want to read it before reloading.
export function SwitchProfile(name: string): Promise<ProfilesResponse> {
  if (IS_WAILS) {
    return _wails<void>('SwitchProfile', name).then(() => GetProfiles())
  }
  return _send<ProfilesResponse>('PUT', '/api/v1/profiles/active', { name })
}

// Rename a profile. Server handles the directory rename + the
// active-store close/re-open dance when the renamed profile is the
// current active one. The caller reloads after success so every
// composable refetches with the new name surfaced.
export function RenameProfile(oldName: string, newName: string): Promise<ProfilesResponse> {
  if (IS_WAILS) {
    return _wails<void>('RenameProfile', oldName, newName).then(() => GetProfiles())
  }
  const path = `/api/v1/profiles/${encodeURIComponent(oldName)}`
  return _send<ProfilesResponse>('PUT', path, { new_name: newName })
}

// Bulk-move matches from the active profile to another profile. The
// server transfers every row + annotation + hidden flag in two
// phases (write target, then delete source) so a mid-transfer
// failure leaves the canonical copy on the target.
export const MoveMatches = _dualVoid<[matchKeys: string[], targetProfile: string]>(
  'MoveMatches',
  'POST',
  '/api/v1/matches/transfers',
  (matchKeys, targetProfile) => ({ match_keys: matchKeys, target_profile: targetProfile }),
)

// Delete a profile and wipe its directory tree. Cannot target the
// active profile — the server returns 409 in that case. Resolves to
// the refreshed list on success; the caller is expected to reload
// the in-memory profiles snapshot afterwards.
export function DeleteProfile(name: string): Promise<ProfilesResponse> {
  if (IS_WAILS) {
    return _wails<void>('DeleteProfile', name).then(() => GetProfiles())
  }
  const path = `/api/v1/profiles/${encodeURIComponent(name)}`
  return _send<void>('DELETE', path).then(() => GetProfiles())
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
  return _get<DataLocation>('/api/v1/system/data-location')
}

// MatchImportResult is the outcome of a merge import: where it came from
// (empty path = user cancelled) plus how many matches were added vs skipped
// because their key already existed locally.
export interface MatchImportResult {
  path:     string
  imported: number
  skipped:  number
}

// BackupDatabase saves a complete native SQLite snapshot of the database.
// Wails delegates to a native save dialog (SaveBackupToFile, "" on cancel);
// server mode streams GET /api/v1/database into a browser download. Resolves
// with the saved filename ("" on a Wails cancel). Captures every table — a
// true backup, unlike the former lossy JSON/CSV export.
export function BackupDatabase(): Promise<string> {
  if (IS_WAILS) return _wails<string>('SaveBackupToFile')
  return downloadBinary('/api/v1/database', `recall-backup-${tsFilenameStamp()}.db`)
}

// ExportMatchesCSV saves a flat, one-row-per-match sheet the caller has
// already assembled (matchesToCSV) — distinct from ExportDataCSV's
// whole-database zip backup. Wails writes the string through a native
// save dialog (SaveTextToFile, "" on cancel); server/browser mode builds
// a Blob and triggers a transient <a download>. Resolves with the saved
// filename ("" on a Wails cancel).
export async function ExportMatchesCSV(csv: string, defaultName: string): Promise<string> {
  if (IS_WAILS) return _wails<string>('SaveTextToFile', defaultName, csv)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const blobURL = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobURL
  a.download = defaultName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobURL)
  return defaultName
}

// ExportBundle is the selection-aware variant of ExportData. The
// caller passes the explicit match_keys the user ticked plus optional
// `includeUnknown` / `includeHidden` toggles that UNION extra records
// onto the selection. The Wails build delegates to a native save
// dialog (`SaveBundleToFile`); the server build POSTs the request and
// streams the ZIP into a browser download via the same blob+anchor
// idiom downloadExport uses.
//
// Resolves with the filename the bundle was saved as ("" on user
// cancel in Wails mode). Throws ApiError on a non-2xx HTTP response.
export async function ExportBundle(opts: {
  matchKeys:       string[]
  includeUnknown:  boolean
  includeHidden:   boolean
}): Promise<string> {
  if (IS_WAILS) {
    return _wails<string>(
      'SaveBundleToFile',
      opts.matchKeys,
      opts.includeUnknown,
      opts.includeHidden,
    )
  }
  const r = await fetch('/api/v1/exports/bundle', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      match_keys:      opts.matchKeys,
      include_unknown: opts.includeUnknown,
      include_hidden:  opts.includeHidden,
    }),
  })
  if (!r.ok) throw await _apiError(r)
  const cd = r.headers.get('Content-Disposition') ?? ''
  const matched = /filename="([^"]+)"/.exec(cd)
  const fallback = `recall-bundle-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`
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

// tsFilenameStamp builds a filesystem-safe `YYYY-MM-DDTHH-MM-SS` stamp for a
// fallback download name when the server omits Content-Disposition.
function tsFilenameStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

// downloadBinary fetches a binary endpoint and triggers a browser download via
// a transient <a download> click, resolving with the saved filename. The name
// comes from the server's Content-Disposition, falling back to fallbackName.
async function downloadBinary(url: string, fallbackName: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) throw await _apiError(r)
  const cd = r.headers.get('Content-Disposition') ?? ''
  const matched = /filename="([^"]+)"/.exec(cd)
  const name = matched?.[1] ?? fallbackName
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

// RestoreDatabase REPLACES the local database with a chosen `.db` snapshot.
// Wails opens a native picker (LoadRestoreFromFile); server mode reads the
// chosen file and PUTs it to /api/v1/database. Resolves with the file name
// ("" on cancel). Destructive — the caller must confirm first.
export async function RestoreDatabase(): Promise<string> {
  if (IS_WAILS) return _wails('LoadRestoreFromFile')
  const file = await pickFile('.db,application/octet-stream,application/x-sqlite3')
  if (!file) return ''
  const buf = await file.arrayBuffer()
  const r = await fetch('/api/v1/database', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buf,
  })
  if (!r.ok) throw await _apiError(r)
  return file.name
}

// ImportMatches MERGES the matches in a chosen bundle `.zip` into the local
// database — additive, existing keys skipped, nothing wiped. Wails opens a
// native picker (LoadMatchImportFromFile) returning the merge counts; server
// mode reads the chosen file, POSTs it to /api/v1/imports, and reads the
// {imported, skipped} summary. Resolves with an empty path on cancel.
export async function ImportMatches(): Promise<MatchImportResult> {
  if (IS_WAILS) return _wails<MatchImportResult>('LoadMatchImportFromFile')
  const file = await pickFile('application/zip,.zip')
  if (!file) return { path: '', imported: 0, skipped: 0 }
  // Read as ArrayBuffer so the ZIP bytes survive — a .text() call would mangle
  // binary content via UTF-8 decoding.
  const buf = await file.arrayBuffer()
  const r = await fetch('/api/v1/imports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: buf,
  })
  if (!r.ok) throw await _apiError(r)
  const summary = (await r.json()) as { imported: number; skipped: number }
  return { path: file.name, imported: summary.imported, skipped: summary.skipped }
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
  return _get<{ count: number }>('/api/v1/screenshots/pending-count').then(d => d.count)
}

// ─── Events ────────────────────────────────────────────────────────────────
// In Wails mode: thin pass-through to window.runtime (no network, so no
//   drop scenario — the status handler never fires).
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
