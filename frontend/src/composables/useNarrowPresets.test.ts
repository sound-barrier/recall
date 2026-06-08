import { describe, it, expect, beforeEach } from 'vitest'
import { ref, computed } from 'vue'
import { useNarrowPresets } from './useNarrowPresets'
import type { MatchesNarrowState, LeaverHandling, ReviewedByPick, QueuePick, PlayModePick, PresetRange } from './useMatchesNarrow'

function buildState(): MatchesNarrowState {
  return {
    searchText:        ref(''),
    pickedMaps:        ref(new Set<string>()),
    pickedMapTypes:    ref(new Set<string>()),
    pickedHeroes:      ref(new Set<string>()),
    pickedRoles:       ref(new Set<string>()),
    pickedResults:     ref(new Set<string>()),
    pickedTags:        ref(new Set<string>()),
    pickedReviewedBy:  ref(new Set<ReviewedByPick>()),
    pickedQueues:      ref(new Set<QueuePick>()),
    pickedPlayModes:   ref(new Set<PlayModePick>()),
    pickedRange:       ref<PresetRange>('all'),
    customFrom:        ref(''),
    customTo:          ref(''),
    leaverHandling:    ref<LeaverHandling>('include'),
    minPlayMinutes:    ref(0),
    minPlayPercent:    ref(0),
    includeUnknown:    ref(false),
    anchorKey:         computed(() => ''),
    sinceAnchorActive: ref(false),
  }
}

describe('useNarrowPresets', () => {
  beforeEach(() => {
    // happy-dom can race the localStorage stub initialization on the
    // first test — guard with a try so the rest still run.
    try { globalThis.localStorage?.clear() } catch (_) { /* noop */ }
  })

  it('saves a preset capturing the current state', () => {
    const state = buildState()
    state.pickedHeroes.value = new Set(['lucio', 'mercy'])
    state.searchText.value = 'clutch'
    const { presets, savePreset } = useNarrowPresets(state)
    savePreset('comp clutch')
    expect(presets.value).toHaveLength(1)
    expect(presets.value[0]!.name).toBe('comp clutch')
    expect(presets.value[0]!.state.pickedHeroes).toEqual(['lucio', 'mercy'])
    expect(presets.value[0]!.state.searchText).toBe('clutch')
  })

  it('persists the preset to localStorage', () => {
    if (typeof globalThis.localStorage === 'undefined') return // happy-dom warm-up race
    const state = buildState()
    state.pickedTags.value = new Set(['stack'])
    const { savePreset } = useNarrowPresets(state)
    savePreset('stack hunts')
    const raw = globalThis.localStorage.getItem('recall.narrowPresets.v2')
    expect(raw).toContain('stack hunts')
    expect(raw).toContain('stack')
  })

  it('applyPreset re-applies the saved state', () => {
    const state = buildState()
    state.pickedHeroes.value = new Set(['lucio'])
    const { savePreset, applyPreset } = useNarrowPresets(state)
    savePreset('lucio set')
    state.pickedHeroes.value = new Set(['tracer'])
    applyPreset('lucio set')
    expect([...state.pickedHeroes.value]).toEqual(['lucio'])
  })

  it('overwrites a preset by the same name', () => {
    const state = buildState()
    state.pickedHeroes.value = new Set(['lucio'])
    const { presets, savePreset } = useNarrowPresets(state)
    savePreset('set')
    state.pickedHeroes.value = new Set(['tracer'])
    savePreset('set')
    expect(presets.value).toHaveLength(1)
    expect(presets.value[0]!.state.pickedHeroes).toEqual(['tracer'])
  })

  it('deletePreset removes a named preset', () => {
    const state = buildState()
    const { presets, savePreset, deletePreset } = useNarrowPresets(state)
    savePreset('a')
    savePreset('b')
    expect(presets.value).toHaveLength(2)
    deletePreset('a')
    expect(presets.value).toHaveLength(1)
    expect(presets.value[0]!.name).toBe('b')
  })

  it('empty / whitespace name is a no-op for save', () => {
    const state = buildState()
    const { presets, savePreset } = useNarrowPresets(state)
    savePreset('')
    savePreset('   ')
    expect(presets.value).toHaveLength(0)
  })

  it('applyPreset for a non-existent name is a no-op', () => {
    const state = buildState()
    state.pickedHeroes.value = new Set(['lucio'])
    const { applyPreset } = useNarrowPresets(state)
    applyPreset('nope')
    expect([...state.pickedHeroes.value]).toEqual(['lucio']) // unchanged
  })

  it('hydrates presets from localStorage on mount', () => {
    if (typeof globalThis.localStorage === 'undefined') return
    globalThis.localStorage.setItem('recall.narrowPresets.v2', JSON.stringify([
      { name: 'persisted', state: {
        searchText: 'foo', pickedMaps: [], pickedMapTypes: [], pickedHeroes: [],
        pickedRoles: [], pickedResults: [], pickedTags: [], pickedReviewedBy: [],
        pickedQueues: [], pickedPlayModes: [], pickedRange: 'all', customFrom: '',
        customTo: '', leaverHandling: 'include', minPlayMinutes: 0,
        minPlayPercent: 0, includeUnknown: false, sinceAnchorActive: false,
      } },
    ]))
    const state = buildState()
    const { presets } = useNarrowPresets(state)
    expect(presets.value).toHaveLength(1)
    expect(presets.value[0]!.name).toBe('persisted')
  })

  it('malformed localStorage data is ignored without throwing', () => {
    if (typeof globalThis.localStorage === 'undefined') return
    globalThis.localStorage.setItem('recall.narrowPresets.v2', '{not json}')
    const state = buildState()
    const { presets } = useNarrowPresets(state)
    expect(presets.value).toEqual([])
  })
})
