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
    vi.stubGlobal('fetch', mockFetch(200, [{ id: 1, match_key: 'match:x', source_files: [], data: {} }]))
    const result = await GetMatchResults()
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(1)
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
