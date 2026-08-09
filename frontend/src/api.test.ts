import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ApiError,
  ClearDatabase,
  GetDataLocation,
  GetMatchResults,
  GetNewScreenshotCount,
  GetVersion,
  IgnoreScreenshot,
  ParseScreenshots,
  ReParseAll,
  SetMatchAnnotation,
  SetMatchReview,
  SetWatchEnabled,
} from '@/api'

// The generated hey-api client dispatches every JSON call as a single
// Request object through global fetch — ONE transport for both the Wails
// asset-server origin and server mode. These tests stub global fetch and
// assert on the Request the client built. The binary/dialog paths keep
// their own raw fetch(url, init) shape — see the blocks at the bottom.

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

// ── BackupDatabase (browser/server mode) ──────────────────────────────────
// The binary download/upload paths deliberately bypass the generated SDK
// (blob + Content-Disposition + native-dialog twins live in api-platform),
// so they keep the raw fetch(url, init) call shape.

function mockFetch(status: number, payload: unknown, contentType?: string) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const ct = contentType ?? (typeof payload === 'string' ? 'text/plain' : 'application/json')
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? ct : null) },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(payload),
  })
}

describe('BackupDatabase (browser mode)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function fetchBinaryOK(disposition: string) {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k: string) => k === 'Content-Disposition' ? disposition : null },
      blob: () => Promise.resolve(new Blob([new Uint8Array([0x53, 0x51, 0x4c, 0x69])], { type: 'application/octet-stream' })),
      text: () => Promise.resolve(''),
    })
  }

  it('GETs /api/v1/database and returns the Content-Disposition filename', async () => {
    const fetchSpy = fetchBinaryOK('attachment; filename="recall-backup-20260626-013000.db"')
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { BackupDatabase } = await import('@/api')
    const name = await BackupDatabase()
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/database')
    expect(name).toBe('recall-backup-20260626-013000.db')
    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('falls back to a generated .db filename when Content-Disposition is missing', async () => {
    vi.stubGlobal('fetch', fetchBinaryOK(''))
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { BackupDatabase } = await import('@/api')
    const name = await BackupDatabase()
    expect(name).toMatch(/^recall-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/)
  })

  it('throws ApiError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: () => Promise.resolve('server boom'),
    }))
    const { BackupDatabase } = await import('@/api')
    const err = await BackupDatabase().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
  })
})

// ── RestoreDatabase + ImportMatches (browser/server mode) ─────────────────

describe('RestoreDatabase + ImportMatches (browser mode)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

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
            if (event === 'change' && file) {
              Object.defineProperty(input, 'files', { value: [file] })
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
    const { RestoreDatabase } = await import('@/api')
    expect(await RestoreDatabase()).toBe('')
  })

  it('RestoreDatabase PUTs the .db bytes to /api/v1/database', async () => {
    const file = new File([new Uint8Array([0x53, 0x51, 0x4c])], 'snap.db', { type: 'application/octet-stream' })
    installFilePicker('change', file)
    const fetchSpy = mockFetch(204, '')
    vi.stubGlobal('fetch', fetchSpy)

    const { RestoreDatabase } = await import('@/api')
    const result = await RestoreDatabase()
    expect(result).toBe('snap.db')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/database',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: expect.any(ArrayBuffer),
      }),
    )
  })

  it('RestoreDatabase throws ApiError when the server rejects the snapshot', async () => {
    const file = new File([new Uint8Array([0x00])], 'bad.db', { type: 'application/octet-stream' })
    installFilePicker('change', file)
    vi.stubGlobal('fetch', mockFetch(422, 'restore: not a valid Recall database'))

    const { RestoreDatabase } = await import('@/api')
    const err = await RestoreDatabase().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
  })

  it('ImportMatches returns an empty-path result when the user cancels', async () => {
    installFilePicker('cancel')
    const { ImportMatches } = await import('@/api')
    expect(await ImportMatches()).toEqual({ path: '', imported: 0, skipped: 0 })
  })

  it('ImportMatches POSTs the bundle and returns the merge summary', async () => {
    const zipBytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04])
    const file = new File([zipBytes], 'bundle.zip', { type: 'application/zip' })
    installFilePicker('change', file)
    const fetchSpy = mockFetch(200, { imported: 2, skipped: 1 })
    vi.stubGlobal('fetch', fetchSpy)

    const { ImportMatches } = await import('@/api')
    const result = await ImportMatches()
    expect(result).toEqual({ path: 'bundle.zip', imported: 2, skipped: 1 })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/imports',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: expect.any(ArrayBuffer),
      }),
    )
  })

  it('ImportMatches throws ApiError when the server rejects the bundle', async () => {
    const file = new File([new Uint8Array([0x50, 0x4B])], 'bad.zip', { type: 'application/zip' })
    installFilePicker('change', file)
    vi.stubGlobal('fetch', mockFetch(400, 'import: malformed payload'))

    const { ImportMatches } = await import('@/api')
    const err = await ImportMatches().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(400)
  })
})

// Wails-mode tests (native dialogs, events, single-transport pin) live in
// src/api-platform.wails.test.ts — the module-cache reset they require
// pollutes any later test in the same file that depends on global state,
// so Vitest's file-level worker isolation is the cleanest fix.
