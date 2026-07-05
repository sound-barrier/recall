// Wails-mode tests for the api.ts shim.
//
// IS_WAILS in api.ts is a module-level `const` evaluated at import time from
// `navigator.userAgent` (the native Wails v3 webview carries a "wails" marker).
// To exercise the Wails branch we stub the UA, vi.resetModules() so the cached
// api module is dropped, then dynamic-import api for a fresh IS_WAILS eval. The
// v3 runtime's Call.ByName is mocked so the dispatch is observable.
//
// Split from api.test.ts because vi.resetModules() drops every cached module —
// vitest's file-level worker isolation keeps the Wails-on state local here.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const { callByName } = vi.hoisted(() => ({ callByName: vi.fn(async () => undefined) }))

vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: callByName },
  Events: { On: vi.fn(), Off: vi.fn() },
  Browser: { OpenURL: vi.fn() },
}))

describe('SetMatchAnnotation (Wails mode)', () => {
  const realUA = navigator.userAgent

  beforeEach(() => {
    // The native Wails webview's UA carries the "wails" marker; stub it so the
    // fresh api import below evaluates IS_WAILS to true.
    Object.defineProperty(navigator, 'userAgent', { value: `${realUA} wails.io`, configurable: true })
    callByName.mockClear()
    vi.resetModules()
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: realUA, configurable: true })
  })

  // The Go method's signature is `SetMatchAnnotation(in AnnotationInput)` — one
  // arg. The v3 runtime resolves the call by FQN (package.struct.method) and
  // passes the single struct. This pins both the FQN and the one-arg shape.
  it('dispatches Call.ByName with the App FQN + exactly one AnnotationInput arg', async () => {
    const { SetMatchAnnotation } = await import('@/api')
    await SetMatchAnnotation('match-2026-05-10T22-21-11', {
      leaver: 'team', note: 'ally rage-quit', replay_code: '7H1K9P', members: ['Apollo#1'],
    })
    expect(callByName).toHaveBeenCalledTimes(1)
    expect(callByName.mock.lastCall).toEqual([
      'recall/pkg/app.App.SetMatchAnnotation',
      {
        MatchKey:   'match-2026-05-10T22-21-11',
        Leaver:     'team',
        Note:       'ally rage-quit',
        ReplayCode: '7H1K9P',
        Members:    ['Apollo#1'],
        Tags:       [],
      },
    ])
  })

  // AnnotationInput in pkg/app/match_annotation.go has no `json:` tags, so
  // encoding/json on the Go side uses exact Go field names. Partial TS inputs
  // must still send a complete struct so empty fields read as "" / [] server-side.
  it('defaults missing input fields to empty so Go sees a complete struct', async () => {
    const { SetMatchAnnotation } = await import('@/api')
    await SetMatchAnnotation('match:x', { note: 'just a note' })
    expect(callByName.mock.lastCall).toEqual([
      'recall/pkg/app.App.SetMatchAnnotation',
      { MatchKey: 'match:x', Leaver: '', Note: 'just a note', ReplayCode: '', Members: [], Tags: [] },
    ])
  })
})

// Regression: the native Windows WebView2 does NOT put the "wails" marker in
// navigator.userAgent — Wails only appends it to the outgoing request header
// (see wails v3 webview_window_windows.go processRequest). It DOES serve the app
// from the `wails.localhost` virtual host. A UA-only detector reads false there,
// so every call wrongly takes the fetch path and 404s against the desktop
// AssetServer (no /api/v1 routes). Detection must key off the serving origin.
describe('Wails detection on Windows WebView2 (origin-based, no UA marker)', () => {
  const realUA = navigator.userAgent
  const realLocation = window.location
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => [],
    text: async () => '[]',
  }))

  beforeEach(() => {
    // Windows Edge UA — deliberately WITHOUT any "wails" token.
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
      configurable: true,
    })
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', hostname: 'wails.localhost', href: 'http://wails.localhost/' },
      configurable: true,
    })
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
    callByName.mockClear()
    vi.resetModules()
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: realUA, configurable: true })
    Object.defineProperty(window, 'location', { value: realLocation, configurable: true })
    vi.unstubAllGlobals()
  })

  it('routes calls through the Wails bridge, not fetch, when served from wails.localhost', async () => {
    const { GetMatchResults } = await import('@/api')
    await GetMatchResults()
    expect(callByName).toHaveBeenCalledWith('recall/pkg/app.App.GetMatchResults')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
