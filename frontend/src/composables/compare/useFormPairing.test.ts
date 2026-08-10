import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

import type { MatchRecord } from '@/api'
import type { Season } from '@/composables/shared/useOWData'
import { N_OPTIONS, useFormPairing } from '@/composables/compare/useFormPairing'

// The Form mode's pairing state machine, driven directly. Everything here is
// pure state + computeds — no DOM, no store — so the preset transitions, the
// mirror/unlock rule, and the by-count slicing are pinned without a render.

// Fixed "now" so the trailing-window presets have a deterministic answer.
// Constructed from LOCAL components at midday: trailingWindow formats local
// calendar days, so the expected strings hold in every timezone.
const NOW = new Date(2026, 4, 20, 12, 0, 0)

function record(date: string, over: Partial<MatchRecord['data']> = {}): MatchRecord {
  return {
    match_key: `match-${date}T12-00-00`,
    source_files: [`${date}.png`],
    data: { map: 'rialto', result: 'victory', date, finished_at: '12:00', ...over },
    parsed_at: `${date}T13:00:00Z`,
  }
}

// A season boundary built from local components so its local calendar day is
// timezone-independent (Date.parse of an RFC3339 string, then local format).
function seasonAt(name: string, start: Date, end: Date): Season {
  return { name, chapter: 'Chapter', number: 1, start: start.toISOString(), end: end.toISOString() }
}

function pairing(records: MatchRecord[] = [], seasons: Season[] = []) {
  return useFormPairing({
    visibleRecords: computed(() => records),
    seasons: computed(() => seasons),
  })
}

describe('useFormPairing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => { vi.useRealTimers() })

  it('opens on the trailing 7 days with the baseline mirrored to the adjacent prior 7', () => {
    const p = pairing()
    expect(p.pairBy.value).toBe('time')
    expect(p.activePreset.value).toBe('7d')
    expect(p.aLocked.value).toBe(true)
    expect(p.bWindow.value).toEqual({ from: '2026-05-14', to: '2026-05-20' })
    // Adjacent (ends the day before B starts), same length, never overlapping.
    expect(p.aWindow.value).toEqual({ from: '2026-05-07', to: '2026-05-13' })
  })

  it('a trailing preset re-locks the baseline and returns to time pairing from by-matches', () => {
    const p = pairing()
    p.applyMatchesPreset()
    p.aLocked.value = false
    p.applyTrailingPreset(30, '30d')
    expect(p.pairBy.value).toBe('time')
    expect(p.aLocked.value).toBe(true)
    expect(p.activePreset.value).toBe('30d')
    expect(p.bWindow.value).toEqual({ from: '2026-04-21', to: '2026-05-20' })
    expect(p.aWindow.value).toEqual({ from: '2026-03-22', to: '2026-04-20' })
  })

  it('by-matches splits the last N against the N before, unevenly when history is short', () => {
    // 25 dated matches, the by-matches preset window is 20 → B takes the last
    // 20 and A only the 5 that remain: the asymmetric-sample case.
    const records = Array.from({ length: 25 }, (_, i) => record(`2026-05-${String(i + 1).padStart(2, '0')}`))
    const p = pairing(records)
    p.applyMatchesPreset()
    expect(p.pairBy.value).toBe('matches')
    expect(p.nPick.value).toBe('20')
    expect(p.activePreset.value).toBe('20m')
    expect(p.pair.value.b).toHaveLength(20)
    expect(p.pair.value.a).toHaveLength(5)
    expect(p.pair.value.bWindow).toEqual({ from: '2026-05-06', to: '2026-05-25' })
    expect(p.pair.value.aWindow).toEqual({ from: '2026-05-01', to: '2026-05-05' })
  })

  it('by-matches over an empty corpus yields two empty windows rather than throwing', () => {
    const p = pairing([])
    p.applyMatchesPreset()
    expect(p.pair.value).toEqual({ a: [], b: [], aWindow: null, bWindow: null, untimed: 0 })
  })

  it('changing the window size re-slices and clears the preset highlight', () => {
    const records = Array.from({ length: 25 }, (_, i) => record(`2026-05-${String(i + 1).padStart(2, '0')}`))
    const p = pairing(records)
    p.applyMatchesPreset()
    p.nPick.value = '10'
    p.onManualEdit()
    expect(N_OPTIONS).toContain('10')
    expect(p.activePreset.value).toBe('')
    expect(p.pair.value.b).toHaveLength(10)
    expect(p.pair.value.a).toHaveLength(10)
  })

  it('re-picking the active pairing mode is a no-op; switching modes drops the preset', () => {
    const p = pairing()
    p.setPairBy('time')
    expect(p.activePreset.value).toBe('7d')
    p.setPairBy('matches')
    expect(p.pairBy.value).toBe('matches')
    expect(p.activePreset.value).toBe('')
  })

  it('an inverted or half-filled window pairs nothing instead of guessing bounds', () => {
    const p = pairing([record('2026-05-18')])
    p.bFrom.value = '2026-05-20'
    p.bTo.value = '2026-05-10'
    expect(p.bWindow.value).toBeNull()
    expect(p.aWindow.value).toBeNull()
    expect(p.pair.value).toEqual({ a: [], b: [], aWindow: null, bWindow: null, untimed: 0 })

    // A valid B with an unlocked-but-empty A is equally unpairable.
    p.bTo.value = '2026-05-20'
    p.aLocked.value = false
    p.aFrom.value = '2026-05-01'
    p.aTo.value = ''
    expect(p.bWindow.value).toEqual({ from: '2026-05-20', to: '2026-05-20' })
    expect(p.aWindow.value).toBeNull()
    expect(p.pair.value.b).toEqual([])
  })

  it('places records into the two windows and counts the ones with no derivable date', () => {
    const undated: MatchRecord = {
      match_key: 'unmatched-abc',
      source_files: ['x.png'],
      data: { map: 'rialto', result: 'victory' },
      parsed_at: '2026-05-20T00:00:00Z',
    }
    const p = pairing([
      record('2026-05-18'), // in B (trailing 7d)
      record('2026-05-10'), // in A (mirrored prior 7d)
      record('2026-04-01'), // outside both
      undated,
    ])
    expect(p.pair.value.b).toHaveLength(1)
    expect(p.pair.value.a).toHaveLength(1)
    expect(p.pair.value.untimed).toBe(1)
  })

  it('same-point-last-season is offered only inside a season that has a predecessor', () => {
    const p = pairing([], [seasonAt('S1', new Date(2026, 1, 10, 12), new Date(2026, 3, 14, 12))])
    // NOW (2026-05-20) falls outside the only season → no preset to offer.
    expect(p.samePoint.value).toBeNull()
    p.applySamePointPreset()
    expect(p.activePreset.value).toBe('7d')
  })

  it('same-point unlocks the baseline and truncates last season to the elapsed days', () => {
    const p = pairing([], [
      seasonAt('S1', new Date(2026, 1, 10, 12), new Date(2026, 3, 14, 12)),
      seasonAt('S2', new Date(2026, 3, 14, 12), new Date(2026, 5, 16, 12)),
    ])
    p.applySamePointPreset()
    expect(p.activePreset.value).toBe('same-point')
    expect(p.aLocked.value).toBe(false)
    // B = this season so far (start → today, 37 days).
    expect(p.bWindow.value).toEqual({ from: '2026-04-14', to: '2026-05-20' })
    // A = last season truncated to the same 37 days, so the two are comparable.
    expect(p.aWindow.value).toEqual({ from: '2026-02-10', to: '2026-03-18' })
  })
})
