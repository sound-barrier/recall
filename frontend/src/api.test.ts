import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, GetMatchResults, GetNewScreenshotCount, ParseScreenshots, SetWatchEnabled } from '@/api'

// IS_WAILS is evaluated at module load time. In the test environment
// window.go is absent, so IS_WAILS = false and all calls go through fetch.

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

// ── fetch success path ────────────────────────────────────────────────────

describe('GET success', () => {
  beforeEach(() => { vi.stubGlobal('fetch', mockFetch(200, [])) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('resolves with the parsed JSON body', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [{ match_key: 'match:x', source_files: [], data: {} }]))
    const result = await GetMatchResults()
    expect(result).toHaveLength(1)
    expect(result[0]?.match_key).toBe('match:x')
  })

  it('resolves a numeric unwrap correctly', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { count: 7 }))
    const n = await GetNewScreenshotCount()
    expect(n).toBe(7)
  })
})

// ── fetch error path ──────────────────────────────────────────────────────

describe('GET 4xx error', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('throws ApiError with the HTTP status', async () => {
    vi.stubGlobal('fetch', mockFetch(400, 'bad request'))
    await expect(GetMatchResults()).rejects.toBeInstanceOf(ApiError)
  })

  it('preserves the status code', async () => {
    vi.stubGlobal('fetch', mockFetch(403, 'forbidden'))
    const err = await GetMatchResults().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(403)
  })

  it('preserves the response body text', async () => {
    vi.stubGlobal('fetch', mockFetch(400, 'validation error detail'))
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
    vi.stubGlobal('fetch', mockFetch(400, problem, 'application/problem+json'))
    const err = await GetMatchResults().catch(e => e) as ApiError
    expect(err.status).toBe(400)
    // The detail is kept on .body so existing display call sites keep working.
    expect(err.body).toBe('body must be {"hidden":<bool>}')
    expect(err.problem?.type).toContain('invalid-body')
    expect(err.problem?.errors?.[0]?.field).toBe('hidden')
  })
})

describe('GET 5xx error', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('throws ApiError for 500', async () => {
    vi.stubGlobal('fetch', mockFetch(500, 'internal server error'))
    const err = await GetMatchResults().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
  })

  it('is distinguishable from 4xx by status', async () => {
    vi.stubGlobal('fetch', mockFetch(502, 'bad gateway'))
    const err = await GetMatchResults().catch(e => e) as ApiError
    expect(err.status >= 500).toBe(true)
  })
})

// ── POST path ─────────────────────────────────────────────────────────────

describe('POST success', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('resolves without throwing on 200', async () => {
    vi.stubGlobal('fetch', mockFetch(200, null))
    await expect(ParseScreenshots()).resolves.not.toThrow()
  })

  it('sends the body as JSON', async () => {
    const spy = mockFetch(200, null)
    vi.stubGlobal('fetch', spy)
    await SetWatchEnabled(true)
    expect(spy).toHaveBeenCalledWith(
      '/api/v1/settings/watcher',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
    )
  })
})

describe('POST 4xx error', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('throws ApiError with the right status', async () => {
    vi.stubGlobal('fetch', mockFetch(422, 'invalid path'))
    const err = await ParseScreenshots().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
  })
})

// ── Data location + export/import ────────────────────────────────────────

describe('GetDataLocation', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('GETs /api/v1/system/data-location and resolves to the payload', async () => {
    const payload = {
      base_dir: '/Users/jacob/Library/Application Support/Recall',
      settings_path: '/Users/jacob/Library/Application Support/Recall/settings.json',
      database_path: '/Users/jacob/Library/Application Support/Recall/db/recall.db',
      screenshots_dir: '/Users/jacob/Documents/Overwatch/Screenshots',
    }
    const spy = mockFetch(200, payload)
    vi.stubGlobal('fetch', spy)
    const { GetDataLocation } = await import('@/api')
    const got = await GetDataLocation()
    // fetch is called as fetch(url, init) — the GET path passes undefined.
    expect(spy).toHaveBeenCalledWith('/api/v1/system/data-location', undefined)
    expect(got).toEqual(payload)
  })
})

// ── BackupDatabase (browser/server mode) ──────────────────────────────────

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

// Wails-mode tests for api.ts live in src/api.wails.test.ts — the
// module-cache reset they require pollutes any later test in the
// same file that depends on global state (e.g. happy-dom's URL),
// so Vitest's file-level worker isolation is the cleanest fix.
