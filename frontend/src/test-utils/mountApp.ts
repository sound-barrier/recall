import { vi } from 'vitest'
import { createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import type { MatchRecord, TesseractStatus, UpdateInfo } from '@/api'

// ─── SFC test setup ──────────────────────────────────────────────────
//
// App.vue (and every SFC under src/) talks to the Wails runtime / HTTP
// API exclusively through src/api.ts. Mocking that one module here
// neutralizes every side-effect entry point in one place:
//
//   - Wails desktop: window.go.app.App.* binding calls
//   - server mode:   fetch('/api/…')   and EventSource('/api/events')
//   - both:          EventsOn / EventsOff event subscriptions
//
// Per-test overrides flow through the `overrides` argument; sensible
// defaults (clean Tesseract install, no records, no parse in flight)
// match a fresh DB so each test only declares what differs.

export interface MountOverrides {
  records?:        MatchRecord[]
  screenshotsDir?: string
  tesseract?:      Partial<TesseractStatus>
  update?:         Partial<UpdateInfo>
  watchEnabled?:      boolean
  newScreenshotCount?: number
  // Seeds localStorage['recall.includeUndated'] so useIncludeUndated
  // picks it up on mount. Default false (the production default), so
  // tests that pass dateless records and expect to see the UNKNOWN
  // DATE bucket must set this to true.
  includeUndated?: boolean
  // Captured Startup failure surfaced to the user via the blocking
  // modal in App.vue. Empty default mirrors a clean boot; tests
  // exercising the modal pass a non-empty string.
  startupError?: string
}

// Mock factory captured at module scope so EventsOn handlers a test
// installs are kept alive across calls (mimicking the runtime SSE /
// Wails event firing). Tests that need to fire a captured handler can
// re-import this module and reach into eventHandlers via the getter
// pattern; for now the Map is internal and the EventsOn/EventsOff
// stubs just exercise the subscribe/unsubscribe code path.
let eventHandlers: Map<string, (data: unknown) => void> = new Map()

function defaultTesseract(overrides: Partial<TesseractStatus> = {}): TesseractStatus {
  return {
    path:      '/usr/local/bin/tesseract',
    found:     true,
    version:   '5.5.0',
    supported: true,
    error:     '',
    default:   '/usr/local/bin/tesseract',
    platform:  'darwin',
    ...overrides,
  }
}

function defaultUpdate(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    checked:    false,
    dev_build:  true,
    available:  false,
    latest:     '',
    url:        '',
    game_data:  { commit_sha: '', applied_commit: '', has_update: false },
    ...overrides,
  }
}

function mockApi(overrides: MountOverrides = {}) {
  // Reset event handlers each mock install so tests don't leak state.
  eventHandlers = new Map()

  const records = overrides.records ?? []
  vi.doMock('@/api', () => ({
    GetVersion:          vi.fn(async () => 'dev'),
    GetStartupError:     vi.fn(async () => overrides.startupError ?? ''),
    CheckForUpdate:      vi.fn(async () => defaultUpdate(overrides.update)),
    OpenURL:             vi.fn(),
    ParseScreenshots:    vi.fn(async () => undefined),
    ReParseAll:          vi.fn(async () => undefined),
    CancelParse:         vi.fn(async () => undefined),
    GetActiveParse:      vi.fn(async () => ({ running: false, done: 0, total: 0, scope: '' })),
    setEventStreamStatusHandler: vi.fn(),
    GetMatchResults:     vi.fn(async () => records),
    GetScreenshotsDir:   vi.fn(async () => overrides.screenshotsDir ?? ''),
    PickScreenshotsDir:  vi.fn(async () => overrides.screenshotsDir ?? ''),
    SetScreenshotsDir:   vi.fn(async () => undefined),
    ResetScreenshotsDir: vi.fn(async () => undefined),
    GetScreenshotsFolderCandidates: vi.fn(async () => []),
    RevealScreenshotsDir: vi.fn(async () => undefined),
    SetMatchAnnotation:    vi.fn(async () => undefined),
    SetMatchVisibility:    vi.fn(async () => undefined),
    HardDeleteMatch:       vi.fn(async () => undefined),
    UpdateMatchData:       vi.fn(async () => undefined),
    ResetMatchData:        vi.fn(async () => undefined),
    SetMatchReview:        vi.fn(async () => undefined),
    SetMatchQueue:         vi.fn(async () => undefined),
    SetMatchPlayMode:      vi.fn(async () => undefined),
    BulkSetMatchPlayMode:  vi.fn(async () => undefined),
    BulkSetMatchQueue:     vi.fn(async () => undefined),
    ResolveAmbiguousMatch: vi.fn(async () => undefined),
    IgnoreScreenshot:      vi.fn(async () => undefined),
    GetWatchEnabled:     vi.fn(async () => overrides.watchEnabled ?? false),
    SetWatchEnabled:     vi.fn(async () => undefined),
    GetTesseractStatus:  vi.fn(async () => defaultTesseract(overrides.tesseract)),
    PickTesseractBinary: vi.fn(async () => defaultTesseract(overrides.tesseract)),
    SetTesseractPath:    vi.fn(async () => defaultTesseract(overrides.tesseract)),
    ResetTesseractPath:  vi.fn(async () => defaultTesseract(overrides.tesseract)),
    ProbeTesseractBinary: vi.fn(async () => ({ found: false, tried: [] as string[] })),
    ClearDatabase:       vi.fn(async () => undefined),
    GetIgnoredScreenshots:   vi.fn(async () => [] as string[]),
    UnignoreScreenshot:      vi.fn(async () => undefined),
    ClearIgnoredScreenshots: vi.fn(async () => undefined),
    GetNewScreenshotCount: vi.fn(async () => overrides.newScreenshotCount ?? 0),
    GetDataLocation:     vi.fn(async () => ({
      base_dir: '/test/base',
      settings_path: '/test/base/settings.json',
      database_path: '/test/base/db/recall.db',
      screenshots_dir: overrides.screenshotsDir ?? '',
    })),
    ExportData:          vi.fn(async () => ''),
    ExportDataCSV:       vi.fn(async () => ''),
    ImportData:          vi.fn(async () => ''),
    // Profiles — single default profile is the natural test state.
    // Tests that need multi-profile state can override these with
    // their own vi.doMock before mounting.
    GetProfiles:         vi.fn(async () => ({ active: 'main', profiles: ['main'] })),
    CreateProfile:       vi.fn(async () => ({ active: 'main', profiles: ['main'] })),
    SwitchProfile:       vi.fn(async () => ({ active: 'main', profiles: ['main'] })),
    RenameProfile:       vi.fn(async () => ({ active: 'main', profiles: ['main'] })),
    MoveMatches:         vi.fn(async () => undefined),
    // Tests don't exercise canonical-name display; return an empty
    // OWData payload so useOWData's lookups fall through to the
    // stored lowercase form (the test fixtures already use the
    // lowercase form).
    GetOWData:           vi.fn(async () => ({ heroes_by_role: {}, maps_by_game_mode: {} })),
    EventsOn: vi.fn((name: string, cb: (data: unknown) => void) => {
      eventHandlers.set(name, cb)
    }),
    EventsOff: vi.fn((name: string) => {
      eventHandlers.delete(name)
    }),
  }))
}

// fireEvent reaches into the captured EventsOn handler map and invokes
// the named handler synchronously. Tests use this to simulate a Wails
// EventsEmit / SSE broadcast hitting the App in mid-flight.
//
// Note: the mocked GetMatchResults always returns whatever `records` the
// test seeded at mount time, so to verify a record-list change after a
// fire-event you'll typically want to re-mock the API or assert on a
// non-record-count side-effect (animations, pulses, etc.).
export function fireEvent(name: string, data: unknown = undefined): boolean {
  const cb = eventHandlers.get(name)
  if (!cb) return false
  cb(data)
  return true
}

// mountApp installs the API mock, dynamically imports App.vue (so the
// mock is in place before App's static `import '@/api'` resolves), and
// runs `flushPromises` to let the onMounted load() / Promise.all settle
// before tests assert on the rendered DOM.
export async function mountApp(overrides: MountOverrides = {}) {
  // Reset the module registry so the dynamic import of App + its Pinia stores
  // re-evaluates against the fresh vi.doMock('@/api') below (and resets any
  // module-level subscription guards, e.g. useEventStream). Without this a
  // prior store-importing test leaves '@/api' cached with the real module.
  // See reference_store_api_mock_isolation.
  vi.resetModules()
  mockApi(overrides)
  // happy-dom's localStorage is a noop without `--localstorage-file`
  // (vitest's default config doesn't pass it), so any test that
  // relies on App.vue reading a persisted preference needs a real
  // in-memory store. Stub one before mount so every persisted-pref
  // composable hydrates from these seeds rather than always falling
  // back to the default.
  const storage: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = String(value) },
    removeItem: (key: string) => { delete storage[key] },
    clear:      () => { for (const k of Object.keys(storage)) delete storage[k] },
    key:        (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length },
  })

  // Seed localStorage for any preferences App reads on mount via
  // composables (useIncludeUndated, …). We only write the keys the
  // test explicitly opted into so we don't surprise unrelated tests.
  if (overrides.includeUndated !== undefined) {
    localStorage.setItem('recall.includeUndated', overrides.includeUndated ? 'true' : 'false')
  }
  // Suppress the first-launch onboarding tour by default — the tour
  // installs a document-level capture-phase keydown listener that
  // intercepts arrow keys and Esc, which breaks unrelated tablist
  // / modal tests. Tests that want to exercise the tour itself
  // would need to delete this seed before mounting.
  localStorage.setItem('recall.onboardingCompleted', 'true')
  // Same first-run-suppression shape as the tour key — the modal
  // traps focus + makes the rest of the app inert. Unit tests that
  // want to exercise the modal can delete this key before mounting.
  localStorage.setItem('recall.firstRunAccountNamed', 'true')
  // Reset modules so a stale cached App.vue from a prior test doesn't
  // bypass the freshly-installed mock.
  vi.resetModules()
  // Pre-warm the dynamic-import cache for the four view components.
  // App.vue loads each via defineAsyncComponent(() => import(...));
  // in production the bundler emits a separate chunk fetched on first
  // view render, but in Vitest the dynamic import goes through Vite's
  // transform pipeline and takes longer than a microtask + macrotask
  // to resolve. Eager-importing them here lands them in the module
  // cache so defineAsyncComponent's loader resolves synchronously when
  // the test triggers a view render. Pre-warming does not undo the
  // production split — that's verified by App.lazy-views.test.ts.
  await Promise.all([
    import('@/components/ingest/IngestView.vue'),
    import('@/components/matches/MatchesView.vue'),
    import('@/components/settings/SettingsView.vue'),
    import('@/components/unknown/UnknownMapsView.vue'),
  ])
  const App = (await import('@/App.vue')).default
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { plugins: [createPinia()] },
  })
  // First flush: App.vue's onMounted load() chain
  // (CheckForUpdate, GetVersion, GetMatchResults). Second: the async
  // view component's now-cached loader resolves and the post-import
  // re-render commits.
  await flushPromises()
  await flushPromises()
  return wrapper
}
