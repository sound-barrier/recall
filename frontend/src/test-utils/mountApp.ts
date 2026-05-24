import { vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { MatchRecord, TesseractStatus, UpdateInfo } from '../api'

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
  prometheusEnabled?: boolean
  watchEnabled?:      boolean
  newScreenshotCount?: number
}

// Mock factory captured at module scope so EventsOn handlers a test
// installs can be invoked later by name (mimicking the runtime SSE /
// Wails event firing). `eventHandlers.get('parse-complete')?.(undefined)`
// triggers the App's re-load path.
let eventHandlers: Map<string, (data: unknown) => void> = new Map()

export function getEventHandler(name: string): ((data: unknown) => void) | undefined {
  return eventHandlers.get(name)
}

function defaultTesseract(overrides: Partial<TesseractStatus> = {}): TesseractStatus {
  return {
    path:      '/usr/local/bin/tesseract',
    found:     true,
    version:   '5.5.0',
    supported: true,
    error:     '',
    default:   '/usr/local/bin/tesseract',
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
    ...overrides,
  }
}

export function mockApi(overrides: MountOverrides = {}) {
  // Reset event handlers each mock install so tests don't leak state.
  eventHandlers = new Map()

  const records = overrides.records ?? []
  vi.doMock('../api', () => ({
    GetVersion:          vi.fn(async () => 'dev'),
    CheckForUpdate:      vi.fn(async () => defaultUpdate(overrides.update)),
    OpenURL:             vi.fn(),
    ParseScreenshots:    vi.fn(async () => undefined),
    GetMatchResults:     vi.fn(async () => records),
    GetScreenshotsDir:   vi.fn(async () => overrides.screenshotsDir ?? ''),
    PickScreenshotsDir:  vi.fn(async () => overrides.screenshotsDir ?? ''),
    GetPrometheusEnabled: vi.fn(async () => overrides.prometheusEnabled ?? false),
    SetPrometheusEnabled: vi.fn(async () => undefined),
    GetWatchEnabled:     vi.fn(async () => overrides.watchEnabled ?? false),
    SetWatchEnabled:     vi.fn(async () => undefined),
    GetTesseractStatus:  vi.fn(async () => defaultTesseract(overrides.tesseract)),
    PickTesseractBinary: vi.fn(async () => defaultTesseract(overrides.tesseract)),
    SetTesseractPath:    vi.fn(async () => defaultTesseract(overrides.tesseract)),
    ResetTesseractPath:  vi.fn(async () => defaultTesseract(overrides.tesseract)),
    ClearDatabase:       vi.fn(async () => undefined),
    GetNewScreenshotCount: vi.fn(async () => overrides.newScreenshotCount ?? 0),
    EventsOn: vi.fn((name: string, cb: (data: unknown) => void) => {
      eventHandlers.set(name, cb)
    }),
    EventsOff: vi.fn((name: string) => {
      eventHandlers.delete(name)
    }),
  }))
}

// mountApp installs the API mock, dynamically imports App.vue (so the
// mock is in place before App's static `import './api'` resolves), and
// runs `flushPromises` to let the onMounted load() / Promise.all settle
// before tests assert on the rendered DOM.
export async function mountApp(overrides: MountOverrides = {}) {
  mockApi(overrides)
  // Reset modules so a stale cached App.vue from a prior test doesn't
  // bypass the freshly-installed mock.
  vi.resetModules()
  const App = (await import('../App.vue')).default
  const wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  return wrapper
}
