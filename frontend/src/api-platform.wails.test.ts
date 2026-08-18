// Wails-mode tests for the surviving platform surface (api-platform.ts):
// the 8 native-dialog functions, OpenURL, the event bridge — plus the pin
// that JSON API calls use fetch even inside the Wails webview (the single
// transport that replaced the Call.ByName RPC branch).
//
// IS_WAILS is a module-level `const` evaluated at import time from the
// SERVING ORIGIN alone (the UA-marker fallback is gone — with one fetch
// transport it could only ever select a broken configuration). To exercise
// the Wails branch we stub window.location, vi.resetModules() so the
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

const realLocation = window.location

// macOS serves the app from the `wails:` custom scheme; Windows WebView2
// from the `wails.localhost` virtual host. Either origin means "native
// window" — and neither carries a UA marker on Windows, which is why
// origin is the whole signal.
function enableWailsOrigin(shape: 'darwin' | 'windows' = 'darwin') {
  const loc = shape === 'darwin'
    ? { protocol: 'wails:', hostname: 'localhost', href: 'wails://localhost/' }
    : { protocol: 'http:', hostname: 'wails.localhost', href: 'http://wails.localhost/' }
  Object.defineProperty(window, 'location', { value: loc, configurable: true })
}

beforeEach(() => {
  callByName.mockClear()
  eventsOn.mockClear()
  eventsOff.mockClear()
  browserOpenURL.mockClear()
  vi.resetModules()
})

afterEach(() => {
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true })
  vi.unstubAllGlobals()
})

// ── native dialog paths ───────────────────────────────────────────────────
// Each wraps a Wails save/open dialog + the same *App method the REST
// handler calls. The FQN string is the contract with pkg/app/app_wails.go.

describe('native dialog dispatch (Wails mode)', () => {
  beforeEach(() => { enableWailsOrigin() })

  const FQN = 'recall/pkg/app.App.'

  it.each([
    ['BackupDatabase', 'SaveBackupToFile'],
    ['ExportDiagnosticBundle', 'SaveDiagnosticBundleToFile'],
    ['RestoreDatabase', 'LoadRestoreFromFile'],
    ['ImportMatches', 'LoadMatchImportFromFile'],
    ['OpenCoachBundle', 'LoadCoachBundleFromFile'],
    ['ExportCoachNotes', 'SaveCoachNotesToFile'],
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

  // POST /imports answers with a union: merge counts for a bundle, a
  // staged return sheet for a coach's notes archive. The native path
  // carries the same shape, and a cancel (Go's zero MatchImportResult,
  // kind "") normalizes onto the bundle arm so callers can trust the
  // discriminant once they've checked `path`.
  it('ImportMatches carries the staged return sheet from the native path', async () => {
    const sheet = { id: 7, coach_name: 'Ordo', notes: [], decisions: {} }
    callByName.mockResolvedValueOnce({ path: '/n.zip', kind: 'coach_notes', imported: 0, skipped: 0, return: sheet })
    const { ImportMatches } = await import('@/api')
    const outcome = await ImportMatches()
    expect(outcome.kind).toBe('coach_notes')
    expect(outcome.return).toEqual(sheet)
  })

  it('ImportMatches normalizes a canceled native pick onto the bundle arm', async () => {
    callByName.mockResolvedValueOnce({ path: '', kind: '', imported: 0, skipped: 0 })
    const { ImportMatches } = await import('@/api')
    expect(await ImportMatches()).toEqual({ path: '', kind: 'bundle', imported: 0, skipped: 0 })
  })

  it('OpenCoachBundle resolves null when the coach cancels the native picker', async () => {
    callByName.mockResolvedValueOnce({ path: '' })
    const { OpenCoachBundle } = await import('@/api')
    expect(await OpenCoachBundle()).toBeNull()
  })

  it('ExportBundle passes the selection AND the chosen name to SaveBundleToFile', async () => {
    const { ExportBundle } = await import('@/api')
    await ExportBundle({
      matchKeys: ['match:x'], includeUnknown: true, includeHidden: false,
      filename: 'my-backup.zip',
    })
    expect(callByName).toHaveBeenCalledWith(
      FQN + 'SaveBundleToFile', ['match:x'], true, false, 'my-backup.zip')
  })

  // The name the modal showed is what the native dialog opens with. Left to
  // the Go side it was hard-coded `recall-bundle-...` in BOTH modes, so a
  // share was offered under the name of an ordinary backup.
  it('falls back to a mode-appropriate default name when none was chosen', async () => {
    const { ExportBundle } = await import('@/api')
    await ExportBundle({ matchKeys: ['match:x'], includeUnknown: true, includeHidden: false })
    expect(callByName).toHaveBeenCalledWith(
      FQN + 'SaveBundleToFile', ['match:x'], true, false,
      expect.stringMatching(/^recall-bundle-.*\.zip$/) as unknown as string)
  })

  // Share mode is a different native method, not a nullable argument: the
  // ordinary saver stays incapable of stamping an identity into a manifest.
  it('ExportBundle routes a share export to SaveShareBundleToFile', async () => {
    const { ExportBundle } = await import('@/api')
    await ExportBundle({
      matchKeys: ['match:x'],
      includeUnknown: false,
      includeHidden: true,
      share: { handle: 'Sable', message: 'Ult timing on control?' },
    })
    expect(callByName).toHaveBeenCalledWith(
      FQN + 'SaveShareBundleToFile',
      ['match:x'], false, true,
      { handle: 'Sable', message: 'Ult timing on control?' },
      expect.stringMatching(/^recall-share-.*\.zip$/) as unknown as string,
    )
  })
})

// ── single transport ──────────────────────────────────────────────────────
// The REST mux is served through the Wails asset server, so JSON API calls
// use fetch in BOTH modes. A regression back to Call.ByName dispatch for
// API methods would bypass the asset-server middleware contract.

describe('JSON API calls inside the Wails webview', () => {
  beforeEach(() => {
    // Windows WebView2 shape: wails.localhost origin, NO "wails" UA marker
    // — the case a UA-only detector got wrong (every call 404'd against
    // the desktop asset server).
    enableWailsOrigin('windows')
    vi.resetModules()
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
    enableWailsOrigin()
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
  beforeEach(() => { enableWailsOrigin() })

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
