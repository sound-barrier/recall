import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useParseStalenessNotice } from '@/composables/ingest/useParseStalenessNotice'
import { profileScopedKey } from '@/composables/profile/profileStorage'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import { useMatchesStore } from '@/stores/matches'

// This happy-dom version ships no window.localStorage, and the dismissal is
// persisted through it — without a stand-in every dismissal assertion below
// would pass vacuously.
const memStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem:    (k: string) => memStore.get(k) ?? null,
  setItem:    (k: string, v: string) => { memStore.set(k, String(v)) },
  removeItem: (k: string) => { memStore.delete(k) },
  clear:      () => { memStore.clear() },
  key:        (i: number) => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size },
})

// The gate, not the rendering — the e2e already drives the banner through the
// real transport. What it cannot reach is the set of conditions that must
// SILENCE the notice, and each of those exists for its own reason.
function seedStaleness(staleMatches: number, parserGeneration: number) {
  // Seeded BEFORE the first store call so the observer sees fresh data and
  // never fires the fetch that would clobber it.
  seedQuery(qk.system.parseStaleness, {
    stale_matches: staleMatches,
    parser_generation: parserGeneration,
  })
}

describe('useParseStalenessNotice', () => {
  beforeEach(() => {
    memStore.clear()
    setActivePinia(createPinia())
    // A fresh pinia reads as a FIRST RUN, where tourActive defaults to true and
    // the notice is correctly suppressed (the tour renders synthetic records, so
    // a parse-vintage count means nothing against them). Every case below is
    // about the post-tour app, so opt out explicitly rather than letting the
    // default silently make each assertion vacuous.
    useMatchesStore().tourActive = false
  })

  it('stays silent when nothing is stale', () => {
    seedStaleness(0, 3)
    expect(useParseStalenessNotice().shouldShow.value).toBe(false)
  })

  it('shows when matches were read by an older parser', () => {
    seedStaleness(42, 3)
    const notice = useParseStalenessNotice()
    expect(notice.shouldShow.value).toBe(true)
    expect(notice.staleMatches.value).toBe(42)
  })

  it('stays silent once dismissed for the current generation', () => {
    seedStaleness(42, 3)
    const notice = useParseStalenessNotice()
    notice.dismiss()
    expect(notice.shouldShow.value).toBe(false)
  })

  // The reason the dismissal is keyed on the generation rather than a boolean:
  // the next parser improvement is the one moment the notice carries new
  // information, so it has to come back exactly then — and only then.
  it('comes back when a newer parser ships', () => {
    memStore.set(profileScopedKey('staleParseDismissedGeneration'), '3')
    seedStaleness(42, 4)
    expect(useParseStalenessNotice().shouldShow.value).toBe(true)
  })

  it('stays silent during the onboarding tour, whose records are synthetic', () => {
    seedStaleness(42, 3)
    const matches = useMatchesStore()
    matches.tourActive = true
    expect(useParseStalenessNotice().shouldShow.value).toBe(false)
  })
})
