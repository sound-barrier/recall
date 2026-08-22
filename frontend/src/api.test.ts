import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ApiError,
  ClearDatabase,
  GetDataLocation,
  GetMatchResults,
  GetNewScreenshotCount,
  GetVersion,
  IgnoreScreenshot,
  BackupDatabase,
  ExportBundle,
  ExportCoachNotes,
  ExportDiagnosticBundle,
  OpenCoachBundle,
  RestoreDatabase,
  ImportMatches,
  ParseScreenshots,
  PickScreenshotsDir,
  PickTesseractBinary,
  ReParseAll,
  SetMatchAnnotation,
  SetMatchReview,
  SetWatchEnabled,
} from '@/api'

// The generated hey-api client dispatches every JSON call as a single
// Request object through global fetch — ONE transport for both the Wails
// asset-server origin and server mode. These tests stub global fetch and
// assert on the Request the client built — including the binary paths,
// which now ride the same SDK (only their DOM plumbing is hand-written).

function stubFetch(makeResponse: (req: Request) => Response) {
  const spy = vi.fn(async (req: Request) => makeResponse(req))
  vi.stubGlobal('fetch', spy)
  return spy
}

function jsonReply(status: number, payload: unknown): (req: Request) => Response {
  return () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textReply(status: number, body: string): (req: Request) => Response {
  return () => new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  })
}

function emptyReply(status: number): (req: Request) => Response {
  return () => new Response(null, { status })
}

function lastRequest(spy: ReturnType<typeof vi.fn>): Request {
  const req = spy.mock.lastCall?.[0] as Request | undefined
  if (!req) throw new Error('fetch was not called')
  return req
}

afterEach(() => { vi.unstubAllGlobals() })

// ── ApiError ─────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('is an Error', () => {
    expect(new ApiError(404, 'not found')).toBeInstanceOf(Error)
  })

  it('exposes status and body', () => {
    const err = new ApiError(422, 'invalid input')
    expect(err.status).toBe(422)
    expect(err.body).toBe('invalid input')
  })

  it('has a human-readable message containing the status code', () => {
    const err = new ApiError(503, 'overloaded')
    expect(err.message).toContain('503')
  })

  it('has name ApiError', () => {
    expect(new ApiError(400, '').name).toBe('ApiError')
  })
})

// ── URL construction ──────────────────────────────────────────────────────
// The spec's servers[] must never be baked into request URLs: every call
// stays root-relative so it resolves against the serving origin (the Wails
// asset server or RECALL_SERVER_ADDR) and the e2e page.route mocks match.

describe('URL construction', () => {
  it('requests resolve against the serving origin, not a baked server URL', async () => {
    const spy = stubFetch(jsonReply(200, []))
    await GetMatchResults()
    const url = new URL(lastRequest(spy).url)
    expect(url.origin).toBe(window.location.origin)
    expect(url.pathname).toBe('/api/v1/matches')
  })

  it('percent-encodes path parameters', async () => {
    const spy = stubFetch(emptyReply(204))
    await IgnoreScreenshot('file with space.png')
    const req = lastRequest(spy)
    expect(req.method).toBe('PUT')
    expect(new URL(req.url).pathname).toBe('/api/v1/screenshots/file%20with%20space.png/ignore')
  })

  it('ReParseAll posts to /api/v1/parses?scope=all', async () => {
    const spy = stubFetch(emptyReply(202))
    await ReParseAll()
    const req = lastRequest(spy)
    expect(req.method).toBe('POST')
    const url = new URL(req.url)
    expect(url.pathname).toBe('/api/v1/parses')
    expect(url.search).toBe('?scope=all')
  })

  it('ClearDatabase adds ?keep_ignored=true only when asked', async () => {
    const spy = stubFetch(emptyReply(204))
    await ClearDatabase()
    expect(new URL(lastRequest(spy).url).search).toBe('')
    await ClearDatabase(true)
    const req = lastRequest(spy)
    expect(req.method).toBe('DELETE')
    const url = new URL(req.url)
    expect(url.pathname).toBe('/api/v1/matches')
    expect(url.search).toBe('?keep_ignored=true')
  })
})

// ── GET success ───────────────────────────────────────────────────────────

describe('GET success', () => {
  it('resolves with the parsed JSON body', async () => {
    stubFetch(jsonReply(200, [{ match_key: 'match:x', source_files: [], data: {} }]))
    const result = await GetMatchResults()
    expect(result).toHaveLength(1)
    expect(result[0]?.match_key).toBe('match:x')
  })

  it('unwraps the {count} envelope to a number', async () => {
    stubFetch(jsonReply(200, { count: 7 }))
    const n = await GetNewScreenshotCount()
    expect(n).toBe(7)
  })

  it('unwraps the {version} envelope to a string', async () => {
    stubFetch(jsonReply(200, { version: '0.26.0' }))
    expect(await GetVersion()).toBe('0.26.0')
  })
})

// ── error paths ───────────────────────────────────────────────────────────

describe('GET 4xx error', () => {
  it('throws ApiError with the HTTP status', async () => {
    stubFetch(textReply(400, 'bad request'))
    await expect(GetMatchResults()).rejects.toBeInstanceOf(ApiError)
  })

  it('preserves the status code', async () => {
    stubFetch(textReply(403, 'forbidden'))
    const err = await GetMatchResults().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(403)
  })

  it('preserves the response body text', async () => {
    stubFetch(textReply(400, 'validation error detail'))
    const err = await GetMatchResults().catch(e => e)
    expect((err as ApiError).body).toBe('validation error detail')
  })

  it('parses an RFC 9457 problem+json error into detail + structured problem', async () => {
    const problem = {
      type: 'https://github.com/sound-barrier/recall/problems/invalid-body',
      title: 'Bad Request',
      status: 400,
      detail: 'body must be {"hidden":<bool>}',
      errors: [{ field: 'hidden', detail: 'must be a boolean' }],
    }
    stubFetch(() => new Response(JSON.stringify(problem), {
      status: 400,
      headers: { 'Content-Type': 'application/problem+json' },
    }))
    const err = await GetMatchResults().catch(e => e) as ApiError
    expect(err.status).toBe(400)
    // The detail is kept on .body so existing display call sites keep working.
    expect(err.body).toBe('body must be {"hidden":<bool>}')
    expect(err.problem?.type).toContain('invalid-body')
    expect(err.problem?.errors?.[0]?.field).toBe('hidden')
  })
})

describe('GET 5xx error', () => {
  it('throws ApiError for 500', async () => {
    stubFetch(textReply(500, 'internal server error'))
    const err = await GetMatchResults().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
  })

  it('is distinguishable from 4xx by status', async () => {
    stubFetch(textReply(502, 'bad gateway'))
    const err = await GetMatchResults().catch(e => e) as ApiError
    expect(err.status >= 500).toBe(true)
  })
})

describe('transport failure (no HTTP response at all)', () => {
  // A dropped connection produces an error with NO Response to read a
  // status off. The facade must NOT invent one: callers branch on
  // `instanceof ApiError` (and on .status) to tell a server-reported
  // problem from "the app can't reach its backend", and a fabricated
  // status would route a network outage into the 4xx user-error copy.
  it('rejects with the raw transport error, not an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const err = await GetMatchResults().catch(e => e)
    expect(err).not.toBeInstanceOf(ApiError)
    expect(String(err)).toContain('Failed to fetch')
  })
})

// ── server-mode fallbacks for the native pickers ──────────────────────────
// PickScreenshotsDir / PickTesseractBinary are the only facade calls that
// branch on the runtime: desktop opens a native dialog, server mode falls
// back to window.prompt. IS_WAILS is false under Vitest, so these pin the
// browser half; the Wails half lives in api-platform.wails.test.ts.

describe('PickScreenshotsDir (server mode)', () => {
  function replyByMethod(current: string): (req: Request) => Response {
    return req => (req.method === 'GET'
      ? new Response(JSON.stringify({ path: current }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response(null, { status: 204 }))
  }

  it('keeps the configured folder and writes nothing when the prompt is dismissed', async () => {
    const spy = stubFetch(replyByMethod('/srv/recall'))
    vi.stubGlobal('prompt', vi.fn(() => null))

    expect(await PickScreenshotsDir()).toBe('/srv/recall')
    // Only the GET that seeded the prompt — a canceled picker must not PUT.
    expect(spy.mock.calls.map(c => (c[0] as Request).method)).toEqual(['GET'])
  })

  it('persists the typed path before resolving with it', async () => {
    const spy = stubFetch(replyByMethod('/srv/recall'))
    vi.stubGlobal('prompt', vi.fn(() => '/srv/new'))

    expect(await PickScreenshotsDir()).toBe('/srv/new')
    const req = lastRequest(spy)
    expect(req.method).toBe('PUT')
    expect(JSON.parse(await req.text())).toEqual({ path: '/srv/new' })
  })
})

describe('PickTesseractBinary (server mode)', () => {
  const status = (path: string) => ({
    path, found: true, version: '5.5.0', supported: true, error: '', default: path, platform: 'linux',
  })

  it('re-reads the unchanged status when the prompt is dismissed', async () => {
    const spy = stubFetch(jsonReply(200, status('/usr/bin/tesseract')))
    const promptSpy = vi.fn(() => '')
    vi.stubGlobal('prompt', promptSpy)

    expect((await PickTesseractBinary()).path).toBe('/usr/bin/tesseract')
    // The prompt is pre-filled with the configured path so the user edits
    // rather than retypes it.
    expect(promptSpy).toHaveBeenCalledWith('Path to Tesseract binary:', '/usr/bin/tesseract')
    // Two reads (seed the prompt, then re-detect) and no write.
    expect(spy.mock.calls.map(c => (c[0] as Request).method)).toEqual(['GET', 'GET'])
  })

  it('offers an empty default when no binary is configured yet', async () => {
    stubFetch(jsonReply(200, { ...status(''), found: false, supported: false }))
    const promptSpy = vi.fn(() => '')
    vi.stubGlobal('prompt', promptSpy)

    await PickTesseractBinary()

    // A missing path must seed '' — never the string "undefined".
    expect(promptSpy).toHaveBeenCalledWith('Path to Tesseract binary:', '')
  })

  it('applies the typed path and resolves with the re-detected status', async () => {
    const spy = stubFetch(jsonReply(200, status('/opt/tesseract')))
    vi.stubGlobal('prompt', vi.fn(() => '/opt/tesseract'))

    expect((await PickTesseractBinary()).path).toBe('/opt/tesseract')
    const req = lastRequest(spy)
    expect(req.method).toBe('PUT')
    expect(JSON.parse(await req.text())).toEqual({ path: '/opt/tesseract' })
  })
})

// ── writers ───────────────────────────────────────────────────────────────

describe('writers', () => {
  it('204 resolves to undefined (the r.json()-on-204 regression)', async () => {
    stubFetch(emptyReply(204))
    await expect(SetWatchEnabled(true)).resolves.toBeUndefined()
  })

  it('202 resolves to undefined', async () => {
    stubFetch(emptyReply(202))
    await expect(ParseScreenshots()).resolves.toBeUndefined()
  })

  it('sends the body as JSON with the content-type header', async () => {
    const spy = stubFetch(emptyReply(204))
    await SetWatchEnabled(true)
    const req = lastRequest(spy)
    expect(req.method).toBe('PUT')
    expect(new URL(req.url).pathname).toBe('/api/v1/settings/watcher')
    expect(req.headers.get('content-type')).toBe('application/json')
    expect(await req.text()).toBe(JSON.stringify({ enabled: true }))
  })

  it('throws ApiError with the right status on a rejected write', async () => {
    stubFetch(textReply(422, 'invalid path'))
    const err = await ParseScreenshots().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
  })

  it('SetMatchReview maps "" to DELETE and a value to PUT', async () => {
    const spy = stubFetch(emptyReply(204))
    await SetMatchReview('match-2026-05-10T22-21-11', '')
    let req = lastRequest(spy)
    expect(req.method).toBe('DELETE')
    expect(new URL(req.url).pathname).toBe('/api/v1/matches/match-2026-05-10T22-21-11/review')

    await SetMatchReview('match-2026-05-10T22-21-11', 'self')
    req = lastRequest(spy)
    expect(req.method).toBe('PUT')
    expect(await req.text()).toBe(JSON.stringify({ reviewed_by: 'self' }))
  })

  // AnnotationInput is upsert-only server-side: partial TS inputs must
  // still send the complete six-field row so empty fields read as "" / []
  // rather than nulling out values the user typed elsewhere. (This pin
  // replaced the Wails-RPC Go-field-name pin when the RPC branch died.)
  it('SetMatchAnnotation always sends the complete annotation row', async () => {
    const spy = stubFetch(emptyReply(204))
    await SetMatchAnnotation('match:x', { note: 'just a note' })
    const req = lastRequest(spy)
    expect(req.method).toBe('PUT')
    expect(new URL(req.url).pathname).toBe('/api/v1/matches/match%3Ax/annotation')
    expect(JSON.parse(await req.text())).toEqual({
      leavers: [], throwers: [], note: 'just a note', replay_code: '', members: [], tags: [],
    })
  })

  // The same guarantee from the other direction: a leaver-only quick-add
  // must not null out a note the user typed a moment earlier.
  it('SetMatchAnnotation defaults every field the caller omitted', async () => {
    const spy = stubFetch(emptyReply(204))
    await SetMatchAnnotation('match:x', { leavers: ['team', 'self'] })
    expect(JSON.parse(await lastRequest(spy).text())).toEqual({
      leavers: ['team', 'self'], throwers: [], note: '', replay_code: '', members: [], tags: [],
    })
  })
})

// ── Data location ─────────────────────────────────────────────────────────

describe('GetDataLocation', () => {
  it('GETs /api/v1/system/data-location and resolves to the payload', async () => {
    const payload = {
      base_dir: '/Users/jacob/Library/Application Support/Recall',
      settings_path: '/Users/jacob/Library/Application Support/Recall/settings.json',
      database_path: '/Users/jacob/Library/Application Support/Recall/db/recall.db',
      screenshots_dir: '/Users/jacob/Documents/Overwatch/Screenshots',
    }
    const spy = stubFetch(jsonReply(200, payload))
    const got = await GetDataLocation()
    expect(new URL(lastRequest(spy).url).pathname).toBe('/api/v1/system/data-location')
    expect(got).toEqual(payload)
  })
})

// ── Binary paths (browser/server mode) ────────────────────────────────────
// These now ride the generated SDK like every other call (blob-parsed
// responses, File bodies streamed through bodySerializer: null); only the
// DOM plumbing — <a download>, <input type=file> — stays hand-written in
// api-platform.ts. The Wails half (native save/load dialogs) is pinned in
// api-platform.wails.test.ts.

describe('binary downloads (browser mode)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  // Patch only the object-URL methods — replacing the whole URL global
  // (the pre-SDK shape of this helper) would break `new URL(...)`, which
  // these tests now use to assert on the Request the client built.
  function stubDownloadDom() {
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
    return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  }

  function blobReply(disposition: string): (req: Request) => Response {
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
    if (disposition) headers['Content-Disposition'] = disposition
    return () => new Response(new Blob([new Uint8Array([0x53, 0x51, 0x4c, 0x69])]), { status: 200, headers })
  }

  it('BackupDatabase GETs /api/v1/database and returns the Content-Disposition filename', async () => {
    const spy = stubFetch(blobReply('attachment; filename="recall-backup-20260626-013000.db"'))
    const clickSpy = stubDownloadDom()

    const name = await BackupDatabase()
    const req = lastRequest(spy)
    expect(req.method).toBe('GET')
    expect(new URL(req.url).pathname).toBe('/api/v1/database')
    expect(name).toBe('recall-backup-20260626-013000.db')
    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('falls back to a generated .db filename when Content-Disposition is missing', async () => {
    stubFetch(blobReply(''))
    stubDownloadDom()
    expect(await BackupDatabase()).toMatch(/^recall-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/)
  })

  it('throws ApiError on a non-2xx response', async () => {
    stubFetch(textReply(500, 'server boom'))
    const err = await BackupDatabase().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
  })

  it('ExportBundle POSTs the typed selection body', async () => {
    const spy = stubFetch(blobReply('attachment; filename="recall-bundle-x.zip"'))
    stubDownloadDom()

    const name = await ExportBundle({ matchKeys: ['k1'], includeUnknown: true, includeHidden: false })
    const req = lastRequest(spy)
    expect(req.method).toBe('POST')
    expect(new URL(req.url).pathname).toBe('/api/v1/exports/bundle')
    expect(JSON.parse(await req.text())).toEqual({
      match_keys: ['k1'], include_unknown: true, include_hidden: false,
    })
    expect(name).toBe('recall-bundle-x.zip')
  })

  // The modal lets the player name the file. That name is the whole reason
  // the field exists, so it beats both the server's Content-Disposition and
  // the generated fallback — it was being collected and dropped.
  it('ExportBundle saves under the name the user typed', async () => {
    stubFetch(blobReply('attachment; filename="server-chosen.zip"'))
    stubDownloadDom()

    const name = await ExportBundle({
      matchKeys: ['k1'], includeUnknown: false, includeHidden: false,
      filename: 'my-season-review.zip',
    })

    expect(name).toBe('my-season-review.zip')
  })

  // The name the file actually lands under when the server sends no
  // Content-Disposition — the stem is the only thing on disk that says
  // which of the two exports this was, weeks later.
  it('ExportBundle falls back to a share-stemmed filename', async () => {
    stubFetch(blobReply(''))
    stubDownloadDom()

    const name = await ExportBundle({
      matchKeys: ['k1'], includeUnknown: false, includeHidden: false,
      share: { handle: 'Sable' },
    })

    expect(name).toMatch(/^recall-share-[\d-]+T[\d-]+\.zip$/)
  })

  // A share export is a different artifact: the manifest names the player,
  // the coach's session opens on it, and a mis-clicked Import refuses it.
  // The only thing that says so on the wire is this block.
  it('ExportBundle carries the share identity when the export is for a coach', async () => {
    const spy = stubFetch(blobReply('attachment; filename="recall-share-sable.zip"'))
    stubDownloadDom()

    await ExportBundle({
      matchKeys: ['k1'],
      includeUnknown: false,
      includeHidden: false,
      share: { handle: 'Sable', message: 'Mostly worried about ult timing.' },
    })

    expect(JSON.parse(await lastRequest(spy).text())).toEqual({
      match_keys: ['k1'],
      include_unknown: false,
      include_hidden: false,
      share: { handle: 'Sable', message: 'Mostly worried about ult timing.' },
    })
  })

  it('ExportCoachNotes POSTs the session export and saves the named zip', async () => {
    const spy = stubFetch(blobReply('attachment; filename="recall-coach-notes-sable-2026-08-15.zip"'))
    stubDownloadDom()

    const name = await ExportCoachNotes('<!doctype html><html></html>')
    const req = lastRequest(spy)
    expect(req.method).toBe('POST')
    expect(new URL(req.url).pathname).toBe('/api/v1/coach/session/export')
    expect(name).toBe('recall-coach-notes-sable-2026-08-15.zip')
    // The human copy travels UP with the request — it is rendered here,
    // where the app's real stylesheets are, not on the far side.
    expect(JSON.parse(await req.text())).toEqual({ sheet_html: '<!doctype html><html></html>' })
  })

  it('ExportDiagnosticBundle POSTs and saves the returned zip', async () => {
    const spy = stubFetch(blobReply('attachment; filename="recall-diagnostic-x.zip"'))
    stubDownloadDom()

    const name = await ExportDiagnosticBundle()
    expect(new URL(lastRequest(spy).url).pathname).toBe('/api/v1/exports/diagnostic')
    expect(name).toBe('recall-diagnostic-x.zip')
  })
})

describe('RestoreDatabase + ImportMatches (browser mode)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  // installFilePicker patches createElement so the next <input>'s
  // .click() synchronously dispatches the chosen event.
  function installFilePicker(event: 'change' | 'cancel', file?: File) {
    const orig = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = orig(tag) as HTMLElement
      if (tag === 'input') {
        const input = el as HTMLInputElement
        vi.spyOn(input, 'click').mockImplementation(() => {
          queueMicrotask(() => {
            if (event === 'change') {
              Object.defineProperty(input, 'files', { value: file ? [file] : [] })
              input.dispatchEvent(new Event('change'))
            } else {
              input.dispatchEvent(new Event('cancel'))
            }
          })
        })
      }
      return el
    })
  }

  it('RestoreDatabase returns "" when the user cancels the picker', async () => {
    installFilePicker('cancel')
    expect(await RestoreDatabase()).toBe('')
  })

  it('RestoreDatabase treats an empty selection like a cancel', async () => {
    // Some browsers fire `change` with an empty FileList when the dialog
    // closes; that must not PUT an undefined body at the database.
    installFilePicker('change')
    const spy = stubFetch(emptyReply(204))
    expect(await RestoreDatabase()).toBe('')
    expect(spy).not.toHaveBeenCalled()
  })

  it('RestoreDatabase PUTs the .db bytes to /api/v1/database', async () => {
    const file = new File([new Uint8Array([0x53, 0x51, 0x4c])], 'snap.db', { type: 'application/octet-stream' })
    installFilePicker('change', file)
    const spy = stubFetch(emptyReply(204))

    expect(await RestoreDatabase()).toBe('snap.db')
    const req = lastRequest(spy)
    expect(req.method).toBe('PUT')
    expect(new URL(req.url).pathname).toBe('/api/v1/database')
    // bodySerializer: null streams the File through untouched — the
    // octet-stream content type must survive.
    expect(req.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('RestoreDatabase throws ApiError when the server rejects the snapshot', async () => {
    const file = new File([new Uint8Array([0x00])], 'bad.db', { type: 'application/octet-stream' })
    installFilePicker('change', file)
    stubFetch(textReply(422, 'restore: not a valid Recall database'))

    const err = await RestoreDatabase().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
  })

  it('ImportMatches returns an empty-path result when the user cancels', async () => {
    installFilePicker('cancel')
    expect(await ImportMatches()).toEqual({ path: '', kind: 'bundle', imported: 0, skipped: 0 })
  })

  it('ImportMatches POSTs the bundle and returns the merge summary', async () => {
    const file = new File([new Uint8Array([0x50, 0x4B, 0x03, 0x04])], 'bundle.zip', { type: 'application/zip' })
    installFilePicker('change', file)
    const spy = stubFetch(jsonReply(200, { kind: 'bundle', imported: 2, skipped: 1 }))

    expect(await ImportMatches()).toEqual({ path: 'bundle.zip', kind: 'bundle', imported: 2, skipped: 1 })
    const req = lastRequest(spy)
    expect(req.method).toBe('POST')
    expect(new URL(req.url).pathname).toBe('/api/v1/imports')
    expect(req.headers.get('content-type')).toBe('application/zip')
  })

  // The union's second arm: a coach's notes archive stages a return sheet
  // and merges nothing, so the counts stay 0 and the sheet rides along.
  it("ImportMatches carries the staged return sheet on a coach's notes archive", async () => {
    const file = new File([new Uint8Array([0x50, 0x4B, 0x03, 0x04])], 'notes.zip', { type: 'application/zip' })
    installFilePicker('change', file)
    const sheet = { id: 7, coach_name: 'Ordo', notes: [], decisions: {}, pending: 0 }
    stubFetch(jsonReply(200, { kind: 'coach_notes', imported: 0, skipped: 0, return: sheet }))

    const outcome = await ImportMatches()
    expect(outcome.kind).toBe('coach_notes')
    expect(outcome.return).toEqual(sheet)
  })

  it('OpenCoachBundle POSTs the picked bundle to /api/v1/coach/session', async () => {
    const file = new File([new Uint8Array([0x50, 0x4B, 0x03, 0x04])], 'sable.zip', { type: 'application/zip' })
    installFilePicker('change', file)
    const spy = stubFetch(jsonReply(201, { player: { id: '', handle: 'Sable', message: '' }, notes: [] }))

    const view = await OpenCoachBundle()
    const req = lastRequest(spy)
    expect(req.method).toBe('POST')
    expect(new URL(req.url).pathname).toBe('/api/v1/coach/session')
    expect(req.headers.get('content-type')).toBe('application/zip')
    expect(view?.player.handle).toBe('Sable')
  })

  it('OpenCoachBundle resolves null — and sends nothing — when the coach cancels', async () => {
    installFilePicker('cancel')
    const spy = stubFetch(emptyReply(201))
    expect(await OpenCoachBundle()).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('ImportMatches throws ApiError when the server rejects the bundle', async () => {
    const file = new File([new Uint8Array([0x50, 0x4B])], 'bad.zip', { type: 'application/zip' })
    installFilePicker('change', file)
    stubFetch(textReply(400, 'import: malformed payload'))

    const err = await ImportMatches().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(400)
  })
})

// Wails-mode tests (native dialogs, events, single-transport pin) live in
// src/api-platform.wails.test.ts — the module-cache reset they require
// pollutes any later test in the same file that depends on global state,
// so Vitest's file-level worker isolation is the cleanest fix.
