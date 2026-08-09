// Wails-mode tests for the surviving platform surface (api-platform.ts):
// the 8 native-dialog functions, OpenURL, the event bridge — plus the pin
// that JSON API calls use fetch even inside the Wails webview (the single
// transport that replaced the Call.ByName RPC branch).
//
// IS_WAILS is a module-level `const` evaluated at import time. To exercise
// the Wails branch we stub the UA (or origin), vi.resetModules() so the
// cached module is dropped, then dynamic-import for a fresh eval. Split
// from api.test.ts because the module-cache reset pollutes global state.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const { callByName, eventsOn, eventsOff, browserOpenURL } = vi.hoisted(() => ({
  callByName: vi.fn(async (): Promise<unknown> => ''),
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
  browserOpenURL: vi.fn(),
}))

vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: callByName },
  Events: { On: eventsOn, Off: eventsOff },
  Browser: { OpenURL: browserOpenURL },
}))

const realUA = navigator.userAgent

function enableWailsUA() {
  Object.defineProperty(navigator, 'userAgent', { value: `${realUA} wails.io`, configurable: true })
}

beforeEach(() => {
  callByName.mockClear()
  eventsOn.mockClear()
  eventsOff.mockClear()
  browserOpenURL.mockClear()
  vi.resetModules()
})

afterEach(() => {
  Object.defineProperty(navigator, 'userAgent', { value: realUA, configurable: true })
  vi.unstubAllGlobals()
})

// ── native dialog paths ───────────────────────────────────────────────────
// Each wraps a Wails save/open dialog + the same *App method the REST
// handler calls. The FQN string is the contract with pkg/app/app_wails.go.

describe('native dialog dispatch (Wails mode)', () => {
  beforeEach(enableWailsUA)

  const FQN = 'recall/pkg/app.App.'

  it.each([
    ['BackupDatabase', 'SaveBackupToFile'],
    ['ExportDiagnosticBundle', 'SaveDiagnosticBundleToFile'],
    ['RestoreDatabase', 'LoadRestoreFromFile'],
    ['ImportMatches', 'LoadMatchImportFromFile'],
    ['PickScreenshotsDir', 'PickScreenshotsDir'],
    ['PickTesseractBinary', 'PickTesseractBinary'],
  ] as const)('%s dispatches Call.ByName(%s)', async (fn, goMethod) => {
    const api = await import('@/api')
    await (api[fn] as () => Promise<unknown>)()
    expect(callByName).toHaveBeenCalledWith(FQN + goMethod)
  })

  it('ExportMatchesCSV passes (name, csv) to SaveTextToFile', async () => {
    const { ExportMatchesCSV } = await import('@/api')
    await ExportMatchesCSV('a,b\n1,2', 'matches.csv')
    expect(callByName).toHaveBeenCalledWith(FQN + 'SaveTextToFile', 'matches.csv', 'a,b\n1,2')
  })

  it('ExportBundle passes (keys, includeUnknown, includeHidden) to SaveBundleToFile', async () => {
    const { ExportBundle } = await import('@/api')
    await ExportBundle({ matchKeys: ['match:x'], includeUnknown: true, includeHidden: false })
    expect(callByName).toHaveBeenCalledWith(FQN + 'SaveBundleToFile', ['match:x'], true, false)
  })
})

// ── single transport ──────────────────────────────────────────────────────
// The REST mux is served through the Wails asset server, so JSON API calls
// use fetch in BOTH modes. A regression back to Call.ByName dispatch for
// API methods would bypass the asset-server middleware contract.

describe('JSON API calls inside the Wails webview', () => {
  const realLocation = window.location

  beforeEach(() => {
    // Windows WebView2 shape: wails.localhost origin, NO "wails" UA marker.
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', hostname: 'wails.localhost', href: 'http://wails.localhost/' },
      configurable: true,
    })
    vi.resetModules()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: realLocation, configurable: true })
  })

  it('go through fetch, never Call.ByName', async () => {
    const fetchSpy = vi.fn(async () => new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const { GetMatchResults } = await import('@/api')
    await GetMatchResults()

    expect(fetchSpy).toHaveBeenCalled()
    expect(callByName).not.toHaveBeenCalled()
  })
})

// ── OpenURL ───────────────────────────────────────────────────────────────

describe('OpenURL', () => {
  it('routes through Browser.OpenURL in Wails mode', async () => {
    enableWailsUA()
    const { OpenURL } = await import('@/api')
    OpenURL('https://sound-barrier.github.io/recall/')
    expect(browserOpenURL).toHaveBeenCalledWith('https://sound-barrier.github.io/recall/')
  })

  it('routes through window.open in browser mode', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { OpenURL } = await import('@/api')
    OpenURL('https://example.com')
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    expect(browserOpenURL).not.toHaveBeenCalled()
  })
})

// ── events bridge ─────────────────────────────────────────────────────────

describe('EventsOn (Wails mode)', () => {
  beforeEach(enableWailsUA)

  it('unwraps the v3 WailsEvent envelope and replaces prior listeners', async () => {
    const { EventsOn } = await import('@/api')
    const cb = vi.fn()
    EventsOn('parse-complete', cb)

    // Off-then-On gives replace semantics (HMR double-mount guard).
    expect(eventsOff).toHaveBeenCalledWith('parse-complete')
    expect(eventsOn).toHaveBeenCalledWith('parse-complete', expect.any(Function))

    const handler = eventsOn.mock.lastCall?.[1] as (ev: { data: unknown }) => void
    handler({ data: { count: 3 } })
    expect(cb).toHaveBeenCalledWith({ count: 3 })
  })

  it('EventsOff forwards to the Wails bus', async () => {
    const { EventsOff } = await import('@/api')
    EventsOff('parse-complete')
    expect(eventsOff).toHaveBeenCalledWith('parse-complete')
  })
})
