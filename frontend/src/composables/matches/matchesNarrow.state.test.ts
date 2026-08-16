import { describe, expect, it } from 'vitest'

import {
  createMatchesNarrowState,
  restoreMatchesNarrowState,
  snapshotMatchesNarrowState,
} from '@/composables/matches/matchesNarrow.state'

// Design rule 12: a coaching session puts the coach's OWN narrow aside —
// her date range and picked map/hero describe her corpus, and applied to
// the player's they show an arbitrary subset that reads as a broken export.
// End puts it back exactly as it was, which is what these two functions owe.

describe('matches narrow — snapshot and restore', () => {
  it('puts every picked dimension back after the state was cleared', () => {
    const state = createMatchesNarrowState()
    state.searchText.value = 'ana'
    state.pickedMaps.value = new Set(['numbani'])
    state.pickedHeroes.value = new Set(['ana', 'kiriko'])
    state.pickedRange.value = '30d'
    state.customFrom.value = '2026-07-01'
    state.minPlayMinutes.value = 4
    state.includeUnknown.value = true
    state.sinceAnchorActive.value = true

    const snapshot = snapshotMatchesNarrowState(state)

    state.searchText.value = ''
    state.pickedMaps.value = new Set()
    state.pickedHeroes.value = new Set()
    state.pickedRange.value = 'all'
    state.customFrom.value = ''
    state.minPlayMinutes.value = 0
    state.includeUnknown.value = false
    state.sinceAnchorActive.value = false

    restoreMatchesNarrowState(state, snapshot)

    expect(state.searchText.value).toBe('ana')
    expect([...state.pickedMaps.value]).toEqual(['numbani'])
    expect([...state.pickedHeroes.value]).toEqual(['ana', 'kiriko'])
    expect(state.pickedRange.value).toBe('30d')
    expect(state.customFrom.value).toBe('2026-07-01')
    expect(state.minPlayMinutes.value).toBe(4)
    expect(state.includeUnknown.value).toBe(true)
    expect(state.sinceAnchorActive.value).toBe(true)
  })

  it('keeps the snapshot independent of later edits to the same set', () => {
    const state = createMatchesNarrowState()
    state.pickedMaps.value = new Set(['numbani'])

    const snapshot = snapshotMatchesNarrowState(state)
    state.pickedMaps.value.add('busan')
    state.pickedMaps.value = new Set()
    restoreMatchesNarrowState(state, snapshot)

    expect([...state.pickedMaps.value]).toEqual(['numbani'])
  })

  it('leaves the persisted anchor alone — it is owned by useMatchAnchor', () => {
    const state = createMatchesNarrowState()

    // A readonly ComputedRef: a snapshot that tried to write it back would
    // throw a Vue "computed is readonly" warning on every End.
    expect(() => restoreMatchesNarrowState(state, snapshotMatchesNarrowState(state))).not.toThrow()
    expect(state.anchorKey.value).toBe('')
  })
})
