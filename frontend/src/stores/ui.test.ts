import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useUiStore } from '@/stores/ui'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import type { MatchRecord } from '@/api'

// backgroundFrozen is an OR across six modal flags spanning three stores — the
// kind of cross-store wiring where a dropped flag silently regresses the
// inert/aria-hidden a11y contract. Plus onManualMatchCreated's ordering and the
// markRaw-bundle survival. Wails event-stream + reference-data + profiles fetch
// no-op'd so creating the store stays offline.
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  EventsOn:       vi.fn(),
  EventsOff:      vi.fn(),
  GetActiveParse: vi.fn(async () => null),
  GetOWData:      vi.fn(async () => ({ heroes: [], maps: [], roles: {}, gameModes: [] })),
  GetProfiles:    vi.fn(async () => ({ active: 'main', profiles: ['main'] })),
}))

const rec = (key: string): MatchRecord => ({ match_key: key, source_files: [], data: { map: 'rialto', date: '2026-05-10' } })

// The first-run gate is part of backgroundFrozen and is "pending" on a fresh
// install (no localStorage in this env), so it dominates by default. Switch the
// tour on (a plain ref set) to neutralize it + isolate the OTHER flags.
async function neutralized() {
  const matches = useMatchesStore()
  await matches.onTourActiveChange(true) // tourActive=true → firstRunModalOpen=false
  return { matches, app: useAppStore(), ui: useUiStore() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('ui store — backgroundFrozen', () => {
  it('freezes the background for the first-run gate by default (fresh install)', () => {
    expect(useUiStore().backgroundFrozen).toBe(true)
  })

  it('is false when no modal surface is up (first-run neutralized)', async () => {
    const { ui } = await neutralized()
    expect(ui.backgroundFrozen).toBe(false)
  })

  it('flips true for the narrow panel', async () => {
    const { ui } = await neutralized()
    ui.setNarrowOpen(true)
    expect(ui.backgroundFrozen).toBe(true)
  })

  it('flips true for the manual-match modal', async () => {
    const { ui } = await neutralized()
    ui.openManualMatch()
    expect(ui.backgroundFrozen).toBe(true)
  })

  it('flips true for the app store’s startup-error gate', async () => {
    const { ui, app } = await neutralized()
    app.setStartupError('SQLite init failed')
    expect(ui.backgroundFrozen).toBe(true)
  })

  it('flips true for the matches store’s unsupported-OCR modal', async () => {
    const { ui, matches } = await neutralized()
    matches.showUnsupportedModal = true
    expect(ui.backgroundFrozen).toBe(true)
  })

  it('flips true when the detail-panel selection opens', async () => {
    const { ui, matches } = await neutralized()
    matches.records = [rec('m-1')]
    ui.selection.open('m-1')
    expect(ui.backgroundFrozen).toBe(true)
  })
})

describe('ui store — onManualMatchCreated', () => {
  it('closes the modal, reloads, then opens the new match in the panel', async () => {
    const matches = useMatchesStore()
    matches.records = [rec('new-key')]
    const load = vi.spyOn(matches, 'load').mockResolvedValue(undefined)
    const ui = useUiStore()
    ui.openManualMatch()

    await ui.onManualMatchCreated(rec('new-key'))

    expect(ui.manualMatchOpen).toBe(false)
    expect(load).toHaveBeenCalledOnce()
    expect(ui.selection.selectedKey.value).toBe('new-key')
  })
})

describe('ui store — markRaw bundles', () => {
  it('exposes selection as a raw bundle whose inner refs survive as refs (not deep-unwrapped)', () => {
    const ui = useUiStore()
    // If markRaw were missing, Pinia would deep-unwrap isOpen to a bare boolean
    // and `.value` would be undefined.
    expect(ui.selection.isOpen.value).toBe(false)
  })
})
