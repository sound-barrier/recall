import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { useAppStore } from '@/stores/app'
import { useParseStore } from '@/stores/parse'
import { SelfUpdateEvents } from '@/self-update-events'

// checkForUpdates' busy-gate state machine + goToView's Parse-tab side effect
// + the self-update event bridge. The Wails event-stream + the dossier's
// reference-data fetch are no-op'd so creating the matches store (goToView
// reaches for it) stays offline.
const api = vi.hoisted(() => ({
  CheckForUpdate:  vi.fn(),
  GetVersion:      vi.fn(),
  StartSelfUpdate: vi.fn(),
  RestartToApply:  vi.fn(),
}))
// Captured wails:updater:* handlers so tests can drive the state machine.
const events = vi.hoisted(() => ({ handlers: new Map<string, (data: unknown) => void>() }))
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  ...api,
  EventsOn:       vi.fn((name: string, cb: (data: unknown) => void) => { events.handlers.set(name, cb) }),
  EventsOff:      vi.fn(),
  GetActiveParse: vi.fn(async () => null),
  GetOWData:      vi.fn(async () => ({ heroes: [], maps: [], roles: {}, gameModes: [] })),
}))

// Invoke a captured host→page updater event, mirroring api.ts's EventsOn
// bridge (which unwraps the `.data` payload before the callback runs).
function fire(name: string, data: unknown = undefined) {
  const cb = events.handlers.get(name)
  if (!cb) throw new Error(`no handler wired for ${name}`)
  cb(data)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  events.handlers.clear()
})

describe('app store — About + checkForUpdates', () => {
  it('never fires CheckForUpdate at store setup — the check is user-pulled only', async () => {
    useAppStore()
    await flushPromises()
    expect(api.CheckForUpdate).not.toHaveBeenCalled()
  })

  it('openAbout opens the dialog, kicks the check, and lands updateInfo', async () => {
    api.CheckForUpdate.mockResolvedValue({ checked: true, current: '1.0.0', latest: '1.1.0' })
    const app = useAppStore()
    expect(app.aboutOpen).toBe(false)

    app.openAbout()
    expect(app.aboutOpen).toBe(true)
    await flushPromises()

    expect(api.CheckForUpdate).toHaveBeenCalledTimes(1)
    expect(app.updateInfo).toMatchObject({ latest: '1.1.0' })
    expect(app.updateCheckBusy).toBe(false)
  })

  it('is idempotent while a check is in flight — a re-click fires no second request', async () => {
    let release!: (v: unknown) => void
    api.CheckForUpdate.mockReturnValue(new Promise((r) => { release = r }))
    const app = useAppStore()

    const first = app.checkForUpdates()
    const second = app.checkForUpdates() // in-flight → guarded
    release({ checked: true, current: '1', latest: '1' })
    await Promise.all([first, second])

    expect(api.CheckForUpdate).toHaveBeenCalledTimes(1)
  })

  it('swallows a check failure: openAbout still opens, clears busy, leaves updateInfo null', async () => {
    api.CheckForUpdate.mockRejectedValue(new Error('network down'))
    const app = useAppStore()

    app.openAbout()
    expect(app.aboutOpen).toBe(true)
    await flushPromises()

    expect(app.updateCheckBusy).toBe(false)
    expect(app.updateInfo).toBeNull()
  })

  it('ignores a check that reports checked:false (cache miss) — leaves updateInfo null', async () => {
    api.CheckForUpdate.mockResolvedValue({ checked: false })
    const app = useAppStore()
    await app.checkForUpdates()
    expect(app.updateInfo).toBeNull()
  })
})

describe('app store — self-update', () => {
  it('starts in the idle phase', () => {
    const app = useAppStore()
    expect(app.selfUpdate).toEqual({ phase: 'idle', pct: null, error: '' })
  })

  it('startSelfUpdate enters the starting phase and POSTs the request', async () => {
    api.StartSelfUpdate.mockResolvedValue(undefined)
    const app = useAppStore()

    await app.startSelfUpdate()

    expect(api.StartSelfUpdate).toHaveBeenCalledTimes(1)
    // Success leaves it in 'starting' — the updater events carry it onward.
    expect(app.selfUpdate.phase).toBe('starting')
  })

  it('drives the full download → ready lifecycle from updater events', async () => {
    api.StartSelfUpdate.mockResolvedValue(undefined)
    const app = useAppStore()
    await app.startSelfUpdate()

    fire(SelfUpdateEvents.CheckStarted)
    expect(app.selfUpdate.phase).toBe('starting')

    fire(SelfUpdateEvents.DownloadStarted)
    expect(app.selfUpdate).toMatchObject({ phase: 'downloading', pct: null })

    fire(SelfUpdateEvents.DownloadProgress, { written: 50, total: 100 })
    expect(app.selfUpdate).toMatchObject({ phase: 'downloading', pct: 50 })

    fire(SelfUpdateEvents.DownloadComplete)
    expect(app.selfUpdate).toMatchObject({ phase: 'verifying', pct: 100 })

    fire(SelfUpdateEvents.Installing)
    expect(app.selfUpdate.phase).toBe('installing')

    fire(SelfUpdateEvents.UpdateReady)
    expect(app.selfUpdate).toMatchObject({ phase: 'ready', pct: 100 })
  })

  it('reports indeterminate progress (pct null) when total is unknown', async () => {
    api.StartSelfUpdate.mockResolvedValue(undefined)
    const app = useAppStore()
    await app.startSelfUpdate()

    fire(SelfUpdateEvents.DownloadProgress, { written: 10, total: 0 })
    expect(app.selfUpdate).toMatchObject({ phase: 'downloading', pct: null })
  })

  it('surfaces an updater error event as the error phase with its message', async () => {
    api.StartSelfUpdate.mockResolvedValue(undefined)
    const app = useAppStore()
    await app.startSelfUpdate()

    fire(SelfUpdateEvents.Error, { stage: 'download', message: 'checksum mismatch' })
    expect(app.selfUpdate).toMatchObject({ phase: 'error', error: 'checksum mismatch' })
  })

  it('resets to idle on a no-update event', async () => {
    api.StartSelfUpdate.mockResolvedValue(undefined)
    const app = useAppStore()
    await app.startSelfUpdate()

    fire(SelfUpdateEvents.NoUpdate)
    expect(app.selfUpdate.phase).toBe('idle')
  })

  it('lands in the error phase when the start request rejects (409 unavailable)', async () => {
    api.StartSelfUpdate.mockRejectedValue(new Error('self-update unavailable'))
    const app = useAppStore()

    await app.startSelfUpdate()

    expect(app.selfUpdate.phase).toBe('error')
    expect(app.selfUpdate.error).not.toBe('')
  })

  it('restartToApply enters restarting and delegates to RestartToApply', async () => {
    api.RestartToApply.mockResolvedValue(undefined)
    const app = useAppStore()

    await app.restartToApply()

    expect(api.RestartToApply).toHaveBeenCalledTimes(1)
    expect(app.selfUpdate.phase).toBe('restarting')
  })

  it('surfaces a restart failure as the error phase', async () => {
    api.RestartToApply.mockRejectedValue(new Error('swap failed'))
    const app = useAppStore()

    await app.restartToApply()

    expect(app.selfUpdate.phase).toBe('error')
    expect(app.selfUpdate.error).not.toBe('')
  })
})

describe('app store — goToView', () => {
  it('refreshes the pending-screenshot count when entering the Parse tab', async () => {
    const app = useAppStore()
    const parse = useParseStore()
    const refresh = vi.spyOn(parse, 'refreshNewCount').mockResolvedValue(undefined)

    await app.goToView('ingest')

    expect(app.view).toBe('ingest')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does NOT refresh the count for the other tabs', async () => {
    const app = useAppStore()
    const parse = useParseStore()
    const refresh = vi.spyOn(parse, 'refreshNewCount').mockResolvedValue(undefined)

    await app.goToView('matches')

    expect(app.view).toBe('matches')
    expect(refresh).not.toHaveBeenCalled()
  })
})
