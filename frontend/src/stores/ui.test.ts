import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useUiStore } from '@/stores/ui'
import { useMatchesStore } from '@/stores/matches'
import type { MatchRecord } from '@/api'

// onManualMatchCreated's close→reload→open ordering + the markRaw-bundle
// survival. (backgroundFrozen is a computed getter, and its inert/aria-hidden
// behaviour is covered by the a11y e2e, so it isn't unit-tested here.) Wails
// event-stream + reference-data + profiles fetch no-op'd so the store stays
// offline.
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  EventsOn:       vi.fn(),
  EventsOff:      vi.fn(),
  GetActiveParse: vi.fn(async () => null),
  GetOWData:      vi.fn(async () => ({ heroes: [], maps: [], roles: {}, gameModes: [] })),
  GetProfiles:    vi.fn(async () => ({ active: 'main', profiles: ['main'] })),
}))

const rec = (key: string): MatchRecord => ({ match_key: key, source_files: [], data: { map: 'rialto', date: '2026-05-10' } })

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
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
