import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, GetMatchResults, GetNewScreenshotCount, ParseScreenshots, SetWatchEnabled } from './api'

// IS_WAILS is evaluated at module load time. In the test environment
// window.go is absent, so IS_WAILS = false and all calls go through fetch.

function mockFetch(status: number, payload: unknown) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
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
      '/api/watch-enabled',
      expect.objectContaining({
        method: 'POST',
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

  it('GETs /api/data-location and resolves to the payload', async () => {
    const payload = {
      base_dir: '/Users/jacob/Library/Application Support/Recall',
      settings_path: '/Users/jacob/Library/Application Support/Recall/settings.json',
      database_path: '/Users/jacob/Library/Application Support/Recall/db/recall.db',
      screenshots_dir: '/Users/jacob/Documents/Overwatch/Screenshots',
    }
    const spy = mockFetch(200, payload)
    vi.stubGlobal('fetch', spy)
    const { GetDataLocation } = await import('./api')
    const got = await GetDataLocation()
    // fetch is called as fetch(url, init) — the GET path passes undefined.
    expect(spy).toHaveBeenCalledWith('/api/data-location', undefined)
    expect(got).toEqual(payload)
  })
})

// ── ExportData (browser/server mode) ──────────────────────────────────────

describe('ExportData (browser mode)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function fetchExportOK(body: string, disposition: string) {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k: string) => k === 'Content-Disposition' ? disposition : null },
      blob: () => Promise.resolve(new Blob([body], { type: 'application/json' })),
      text: () => Promise.resolve(''),
    })
  }

  it('parses the filename out of Content-Disposition and returns it', async () => {
    vi.stubGlobal('fetch', fetchExportOK('{}', 'attachment; filename="recall-export-20260526-013000.json"'))
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { ExportData } = await import('./api')
    const name = await ExportData()
    expect(name).toBe('recall-export-20260526-013000.json')
    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('falls back to a generated filename when Content-Disposition is missing', async () => {
    vi.stubGlobal('fetch', fetchExportOK('{}', ''))
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { ExportData } = await import('./api')
    const name = await ExportData()
    expect(name).toMatch(/^recall-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/)
  })

  it('throws ApiError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: () => Promise.resolve('server boom'),
    }))
    const { ExportData } = await import('./api')
    const err = await ExportData().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
  })
})

// ── ImportData (browser/server mode) ──────────────────────────────────────

describe('ImportData (browser mode)', () => {
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

  it('returns "" when the user cancels the file picker', async () => {
    installFilePicker('cancel')
    const { ImportData } = await import('./api')
    const result = await ImportData()
    expect(result).toBe('')
  })

  it('POSTs JSON files as application/json with the byte body', async () => {
    const file = new File(['{"schema":"recall-export/v1"}'], 'my-backup.json', { type: 'application/json' })
    installFilePicker('change', file)
    const fetchSpy = mockFetch(200, { ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    const { ImportData } = await import('./api')
    const result = await ImportData()
    expect(result).toBe('my-backup.json')
    // The shim posts an ArrayBuffer; we assert the type rather than
    // the exact bytes (Buffer comparison is awkward in this env).
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(ArrayBuffer),
      }),
    )
  })

  it('POSTs ZIP files as application/zip (auto-detected from .zip extension)', async () => {
    // Fake ZIP magic so file.arrayBuffer() returns recognizable bytes.
    const zipBytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00])
    const file = new File([zipBytes], 'backup.zip', { type: 'application/zip' })
    installFilePicker('change', file)
    const fetchSpy = mockFetch(200, { ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    const { ImportData } = await import('./api')
    const result = await ImportData()
    expect(result).toBe('backup.zip')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: expect.any(ArrayBuffer),
      }),
    )
  })

  it('throws ApiError when the server rejects the payload', async () => {
    const file = new File(['{not json'], 'bad.json', { type: 'application/json' })
    installFilePicker('change', file)
    vi.stubGlobal('fetch', mockFetch(400, 'import: decode: invalid character'))

    const { ImportData } = await import('./api')
    const err = await ImportData().catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(400)
  })
})

// ── ExportDataCSV ────────────────────────────────────────────────────────

describe('ExportDataCSV (browser mode)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('GETs /api/export.csv and uses the suggested filename', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k: string) => k === 'Content-Disposition' ? 'attachment; filename="recall-export-20260526-020000.zip"' : null },
      blob: () => Promise.resolve(new Blob([new Uint8Array([0x50, 0x4B, 0x03, 0x04])], { type: 'application/zip' })),
      text: () => Promise.resolve(''),
    })
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { ExportDataCSV } = await import('./api')
    const name = await ExportDataCSV()
    expect(fetchSpy).toHaveBeenCalledWith('/api/export.csv')
    expect(name).toBe('recall-export-20260526-020000.zip')
  })

  it('falls back to a generated .zip filename when Content-Disposition is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      blob: () => Promise.resolve(new Blob([new Uint8Array([0x50, 0x4B])])),
      text: () => Promise.resolve(''),
    }))
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { ExportDataCSV } = await import('./api')
    const name = await ExportDataCSV()
    expect(name).toMatch(/^recall-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/)
  })
})
