import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'

// checkForUpdates' busy-gate state machine + goToView's Parse-tab side effect.
// The Wails event-stream + the dossier's reference-data fetch are no-op'd so
// creating the matches store (goToView reaches for it) stays offline.
const api = vi.hoisted(() => ({ CheckForUpdate: vi.fn(), GetVersion: vi.fn() }))
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  ...api,
  EventsOn:       vi.fn(),
  EventsOff:      vi.fn(),
  GetActiveParse: vi.fn(async () => null),
  GetOWData:      vi.fn(async () => ({ heroes: [], maps: [], roles: {}, gameModes: [] })),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('app store — About + checkForUpdates', () => {
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

describe('app store — goToView', () => {
  it('refreshes the pending-screenshot count when entering the Parse tab', async () => {
    const app = useAppStore()
    const matches = useMatchesStore()
    const refresh = vi.spyOn(matches, 'refreshNewCount').mockResolvedValue(undefined)

    await app.goToView('ingest')

    expect(app.view).toBe('ingest')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does NOT refresh the count for the other tabs', async () => {
    const app = useAppStore()
    const matches = useMatchesStore()
    const refresh = vi.spyOn(matches, 'refreshNewCount').mockResolvedValue(undefined)

    await app.goToView('matches')

    expect(app.view).toBe('matches')
    expect(refresh).not.toHaveBeenCalled()
  })
})
