import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'

// This happy-dom version ships NO window.localStorage, which made every
// guarded test below silently vacuous (the `typeof localStorage ===
// 'undefined'` early-returns fired on every run). Install an in-memory
// stand-in up front so the suite actually executes; the old guards stay
// as inert belt-and-braces.
const memStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => { memStore.set(k, String(v)) },
  removeItem: (k: string) => { memStore.delete(k) },
  clear: () => { memStore.clear() },
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size },
})
import { useNarrowPresets } from '@/composables/matches/useNarrowPresets'
import type { MatchesNarrowState, ReviewedByPick, QueuePick, PlayModePick, SourcePick, LeaverPick, ThrowerPick, PresetRange } from '@/composables/matches/useMatchesNarrow'
import type { LeaverHandling } from '@/composables/matches/useMatchesDossier'

function buildState(): MatchesNarrowState {
  return {
    searchText:        ref(''),
    pickedMaps:        ref(new Set<string>()),
    pickedGameModes:    ref(new Set<string>()),
    pickedHeroes:      ref(new Set<string>()),
    pickedRoles:       ref(new Set<string>()),
    pickedResults:     ref(new Set<string>()),
    pickedTags:        ref(new Set<string>()),
    pickedMembers:     ref(new Set<string>()),
    pickedReviewedBy:  ref(new Set<ReviewedByPick>()),
    pickedQueues:      ref(new Set<QueuePick>()),
    pickedPlayModes:   ref(new Set<PlayModePick>()),
    pickedSources:     ref(new Set<SourcePick>()),
    pickedLeavers:     ref(new Set<LeaverPick>()),
    pickedThrowers:    ref(new Set<ThrowerPick>()),
    pickedModifiers:   ref(new Set<string>()),
    pickedRanks:       ref(new Set<string>()),
    pickedRange:       ref<PresetRange>('all'),
    customFrom:        ref(''),
    customTo:          ref(''),
    customFromTime:    ref(''),
    customToTime:      ref(''),
    pickedSeason:      ref(''),
    leaverHandling:    ref<LeaverHandling>('include'),
    minPlayMinutes:    ref(0),
    minPlayPercent:    ref(0),
    includeUnknown:    ref(false),
    anchorKey:         computed(() => ''),
    sinceAnchorActive: ref(false),
    poolFilter:        ref(null),
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
        searchText: 'foo', pickedMaps: [], pickedGameModes: [], pickedHeroes: [],
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

describe('preset shape completeness', () => {
  // Guards the shotgun class the clause registry killed elsewhere: a new
  // narrow dimension adds a state field, and this fails until the preset
  // shape learns it too (the pickedLeavers/Modifiers/Ranks bug shipped
  // exactly because nothing tied the two together).
  it('serializes every narrow state field except the session anchor', () => {
    if (typeof globalThis.localStorage === 'undefined') return // happy-dom warm-up race
    const state = buildState()
    const { savePreset } = useNarrowPresets(state)
    savePreset('shape-probe')
    const stored = (JSON.parse(localStorage.getItem('recall.narrowPresets.v2')!) as Array<{ state: Record<string, unknown> }>)[0]!.state
    // anchorKey is owned by useMatchAnchor and persists on its own (presets
    // capture only the toggle leg); poolFilter is a transient band-driven filter
    // carrying a snapshot of derived pool keys — persisting it would restore
    // stale keys, so it is deliberately excluded from presets.
    const transient = new Set(['anchorKey', 'poolFilter'])
    const expected = Object.keys(state).filter((k) => !transient.has(k))
    for (const key of expected) {
      expect(stored, `preset shape is missing narrow state field "${key}"`).toHaveProperty(key)
    }
  })
})

describe('time-of-day bounds in presets', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips customFromTime / customToTime', () => {
    if (typeof globalThis.localStorage === 'undefined') return
    const state = buildState()
    const { savePreset, applyPreset } = useNarrowPresets(state)
    state.customFrom.value = '2026-01-07'
    state.customFromTime.value = '11:00'
    state.customTo.value = '2026-03-13'
    state.customToTime.value = '10:59'
    state.pickedRange.value = 'custom'
    savePreset('season-window')

    state.customFromTime.value = ''
    state.customToTime.value = ''
    applyPreset('season-window')
    expect(state.customFromTime.value).toBe('11:00')
    expect(state.customToTime.value).toBe('10:59')
  })

  it('round-trips the picked season by name', () => {
    if (typeof globalThis.localStorage === 'undefined') return
    const state = buildState()
    const { savePreset, applyPreset } = useNarrowPresets(state)
    state.pickedSeason.value = 'Reign of Talon — Season 2'
    savePreset('s2')
    state.pickedSeason.value = ''
    applyPreset('s2')
    expect(state.pickedSeason.value).toBe('Reign of Talon — Season 2')
  })

  it('legacy presets without time keys apply as blank times', () => {
    if (typeof globalThis.localStorage === 'undefined') return
    const state = buildState()
    const { savePreset, applyPreset } = useNarrowPresets(state)
    savePreset('legacy')
    const raw = JSON.parse(localStorage.getItem('recall.narrowPresets.v2')!) as Array<{ state: Record<string, unknown> }>
    delete raw[0]!.state['customFromTime']
    delete raw[0]!.state['customToTime']
    localStorage.setItem('recall.narrowPresets.v2', JSON.stringify(raw))

    state.customFromTime.value = '09:30'
    state.customToTime.value = '18:00'
    applyPreset('legacy')
    expect(state.customFromTime.value).toBe('')
    expect(state.customToTime.value).toBe('')
  })
})

describe('preset round-trip of newer filter dimensions', () => {
  // pickedLeavers / pickedModifiers / pickedRanks joined MatchesNarrowState
  // after the v2 preset shape shipped — a preset must carry them, and
  // applying one must reset them (not leave stale picks merged in).
  it('saves and applies leaver-side, modifier, and rank picks', () => {
    const state = buildState()
    state.pickedLeavers.value = new Set<LeaverPick>(['team'])
    state.pickedThrowers.value = new Set<ThrowerPick>(['enemy', 'team'])
    state.pickedModifiers.value = new Set(['win streak'])
    state.pickedRanks.value = new Set(['diamond'])
    const { savePreset, applyPreset } = useNarrowPresets(state)
    savePreset('leaver hunts')

    state.pickedLeavers.value = new Set<LeaverPick>()
    state.pickedThrowers.value = new Set<ThrowerPick>()
    state.pickedModifiers.value = new Set(['loss streak'])
    state.pickedRanks.value = new Set()
    applyPreset('leaver hunts')

    expect([...state.pickedLeavers.value]).toEqual(['team'])
    expect([...state.pickedThrowers.value].sort()).toEqual(['enemy', 'team'])
    expect([...state.pickedModifiers.value]).toEqual(['win streak'])
    expect([...state.pickedRanks.value]).toEqual(['diamond'])
  })

  it('applies a legacy preset (saved before the dimensions existed) by clearing them', () => {
    if (typeof globalThis.localStorage === 'undefined') return // happy-dom warm-up race
    const state = buildState()
    const { savePreset } = useNarrowPresets(state)
    savePreset('legacy')
    // Simulate a pre-fix stored preset: strip the new keys.
    const raw = JSON.parse(localStorage.getItem('recall.narrowPresets.v2')!) as Array<{ state: Record<string, unknown> }>
    delete raw[0]!.state['pickedLeavers']
    delete raw[0]!.state['pickedThrowers']
    delete raw[0]!.state['pickedModifiers']
    delete raw[0]!.state['pickedRanks']
    localStorage.setItem('recall.narrowPresets.v2', JSON.stringify(raw))

    const fresh = useNarrowPresets(state)
    state.pickedModifiers.value = new Set(['volatile'])
    fresh.applyPreset('legacy')
    expect(state.pickedModifiers.value.size).toBe(0)
  })
})
