import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { applyWatchState } from '@/queries/settings'
import type { TesseractStatus, WatcherStatus } from '@/api'

// Direct unit tests for the settings store's OWN logic — the candidate-load,
// detected-source commit, and watch-enable gate. The composables it wires
// (tesseract status, screenshots dir, theme, week-start) are exercised through
// their own suites; here we drive the store actions and assert the api calls +
// store state they produce. The matches-store deps are no-op'd because
// pickDetectedSource's success path reaches into refreshNewCount.
const api = vi.hoisted(() => ({
  GetScreenshotsFolderCandidates: vi.fn(),
  SetScreenshotsDir:              vi.fn(),
  SetWatchEnabled:                vi.fn(),
}))
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  ...api,
  EventsOn:              vi.fn(),
  EventsOff:             vi.fn(),
  GetActiveParse:        vi.fn(async () => null),
  GetNewScreenshotCount: vi.fn(async () => ({ count: 0, parked: 0 })),
  GetOWData:             vi.fn(async () => ({ heroes: [], maps: [], roles: {}, gameModes: [] })),
}))

function notReady(): TesseractStatus {
  return { state: 'unavailable', path: '', found: false, version: '', supported: true, error: 'not found', default: '', platform: 'darwin' }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('settings store — screenshot candidates', () => {
  it('hydrates the candidate list from its query at store setup', async () => {
    api.GetScreenshotsFolderCandidates.mockResolvedValue([{ name: 'Steam', path: '/captures/steam', exists: true }])
    const s = useSettingsStore()
    await new Promise(r => setTimeout(r, 0))
    expect(s.screenshotCandidates).toHaveLength(1)
    expect(s.screenshotCandidates[0]?.path).toBe('/captures/steam')
  })

  it('falls back to [] when the probe fails', async () => {
    api.GetScreenshotsFolderCandidates.mockRejectedValue(new Error('probe failed'))
    const s = useSettingsStore()
    await new Promise(r => setTimeout(r, 0))
    expect(s.screenshotCandidates).toEqual([])
  })
})

describe('settings store — pickDetectedSource', () => {
  it('commits the detected path on success', async () => {
    api.SetScreenshotsDir.mockResolvedValue(undefined)
    const s = useSettingsStore()
    await s.pickDetectedSource('/captures/ow')
    expect(api.SetScreenshotsDir).toHaveBeenCalledWith('/captures/ow')
    expect(s.screenshotsDir).toBe('/captures/ow')
  })

  it('surfaces an error and leaves the dir unchanged on failure', async () => {
    api.SetScreenshotsDir.mockRejectedValue(new Error('permission denied'))
    const s = useSettingsStore()
    const appStore = useAppStore()
    const spy = vi.spyOn(appStore, 'setErrorFromRaw')
    await s.pickDetectedSource('/bad/path')
    expect(spy).toHaveBeenCalled()
    expect(s.screenshotsDir).not.toBe('/bad/path')
  })
})

describe('settings store — watch gate', () => {
  it('refuses to enable Watch while Tesseract is not ready', async () => {
    const s = useSettingsStore()
    s.setTesseractStatus(notReady())
    const appStore = useAppStore()
    const spy = vi.spyOn(appStore, 'setErrorFromRaw')
    await s.toggleWatch()
    expect(spy).toHaveBeenCalled()
    expect(api.SetWatchEnabled).not.toHaveBeenCalled()
    expect(s.watchEnabled).toBe(false)
  })
})

// The settings reads are server truth in the query cache; the store used to
// copy them into refs. The boot GET of the Watch flag answering AFTER the user
// had already flipped it then overwrote the flip — the switch snapped back
// while the server held the new value.
describe('settings store — writes land in the cache', () => {
  it('a Watch toggle made while the boot read is in flight survives that read', async () => {
    let answerBoot: (status: WatcherStatus) => void = () => {}
    const GetWatcherStatus = vi.fn(() => new Promise<WatcherStatus>((resolve) => { answerBoot = resolve }))
    const { setApiBacking } = await import('@/api-client')
    const api2 = await import('@/api')
    setApiBacking({ ...api2, GetWatcherStatus, SetWatchEnabled: vi.fn(async () => undefined) })
    const s = useSettingsStore()
    s.setTesseractStatus({ ...notReady(), state: 'ready', found: true, error: '' })
    await new Promise(r => setTimeout(r, 0))
    expect(GetWatcherStatus).toHaveBeenCalled()

    await s.toggleWatch()
    expect(s.watchEnabled).toBe(true)

    answerBoot({ enabled: false, watch_state: 'off' })
    await new Promise(r => setTimeout(r, 0))
    expect(s.watchEnabled).toBe(true)
    setApiBacking(api2)
  })
})

// The Watch setting and what the watcher is doing are ONE read and one cache
// entry: the toggle reads its `enabled`, the masthead dot its `watch_state`.
describe('settings store — the watcher entry', () => {
  async function bootWith(read: () => Promise<WatcherStatus>) {
    const { setApiBacking } = await import('@/api-client')
    const api2 = await import('@/api')
    setApiBacking({ ...api2, GetWatcherStatus: vi.fn(read), SetWatchEnabled: vi.fn(async () => undefined) })
    return () => { setApiBacking(api2) }
  }

  it('a watch-state event that lands during the boot read survives that read', async () => {
    let answerBoot: (status: WatcherStatus) => void = () => {}
    const restore = await bootWith(() => new Promise((resolve) => { answerBoot = resolve }))
    const s = useSettingsStore()
    await new Promise(r => setTimeout(r, 0))

    applyWatchState('unavailable')
    answerBoot({ enabled: true, watch_state: 'watching' })
    await new Promise(r => setTimeout(r, 0))

    expect(s.watchState).toBe('unavailable')
    expect(s.watchEnabled).toBe(true)
    restore()
  })

  it('turning Watch off says the watcher is off; turning it on waits for the event', async () => {
    const restore = await bootWith(async () => ({ enabled: true, watch_state: 'watching' }))
    const s = useSettingsStore()
    s.setTesseractStatus({ ...notReady(), state: 'ready', found: true, error: '' })
    await new Promise(r => setTimeout(r, 0))

    await s.toggleWatch()
    expect(s.watchEnabled).toBe(false)
    expect(s.watchState).toBe('off')

    await s.toggleWatch()
    expect(s.watchEnabled).toBe(true)
    expect(s.watchState).toBe('off')
    applyWatchState('unavailable')
    expect(s.watchState).toBe('unavailable')
    restore()
  })
})

describe('settings store — detect folder (probe)', () => {
  it('commits the first existing candidate and reports success', async () => {
    api.GetScreenshotsFolderCandidates.mockResolvedValue([
      { name: '', path: '', exists: false }, // dropped by the path filter(Boolean)
      { name: 'OW', path: '/captures/auto', exists: true },
    ])
    api.SetScreenshotsDir.mockResolvedValue(undefined)
    const s = useSettingsStore()
    await s.detectDir()
    expect(api.SetScreenshotsDir).toHaveBeenCalledWith('/captures/auto')
    expect(s.screenshotsDir).toBe('/captures/auto')
    expect(s.probeStatus).toBe('success')
  })

  it('reports blocked when no candidate exists on disk', async () => {
    api.GetScreenshotsFolderCandidates.mockResolvedValue([{ name: 'OW', path: '/maybe', exists: false }])
    const s = useSettingsStore()
    await s.detectDir()
    expect(s.probeStatus).toBe('blocked')
    expect(s.probeTried).toContain('/maybe')
  })
})

describe('settings store — Engine deep-link', () => {
  it('gotoEngineSettings switches to the Settings view and scrolls to Engine', async () => {
    const el = document.createElement('div')
    el.id = 'sec-engine'
    el.scrollIntoView = vi.fn()
    document.body.appendChild(el)
    const s = useSettingsStore()
    const appStore = useAppStore()
    await s.gotoEngineSettings()
    expect(appStore.view).toBe('settings')
    expect(el.scrollIntoView).toHaveBeenCalled()
    document.body.removeChild(el)
  })
})
