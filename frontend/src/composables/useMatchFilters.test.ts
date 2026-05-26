import { describe, it, expect, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useMatchFilters } from './useMatchFilters'
import type { MatchRecord } from '../api'

// Call the composable inside an effectScope so computed() and ref()
// work without needing a mounted component.
//
// Most existing tests don't bother with date+finished_at on their
// fixtures — they care about a single dimension at a time (mode,
// map, role, etc.). The composable now hides undated records by
// default, so this helper opts INTO including them via a `ref(true)`
// unless the caller overrides. Tests that exercise the toggle pin
// it to a specific value.
function setup(
  initial: MatchRecord[] = [],
  includeUndated = ref(true),
  minPlayPercent = ref(0),
  minPlayMinutes = ref(0),
  setMinPlayPercent = vi.fn(),
  setMinPlayMinutes = vi.fn(),
  leaverHandling = ref<'include' | 'exclude-tally' | 'hide'>('include'),
  showHidden = ref(false),
) {
  const records = ref<MatchRecord[]>(initial)
  let result!: ReturnType<typeof useMatchFilters>
  const scope = effectScope()
  scope.run(() => {
    result = useMatchFilters(
      records,
      includeUndated,
      minPlayPercent,
      minPlayMinutes,
      setMinPlayPercent,
      setMinPlayMinutes,
      leaverHandling,
      showHidden,
    )
  })
  return {
    ...result,
    records, includeUndated, minPlayPercent, minPlayMinutes,
    setMinPlayPercent, setMinPlayMinutes,
    leaverHandling, showHidden,
  }
}

// ── Minimal record builder ────────────────────────────────────────────
//
// Tests historically used a numeric `id` to identify fixture records.
// With the per-screenshot-type schema the canonical identity is
// `match_key` (a string). To keep the existing assertion style readable
// (`r.match_key === 'k1'` instead of `r.match_key === 'match:…1'`), the
// builder accepts a short numeric tag that gets stringified into the
// match_key. Tests that already pass a custom match_key keep working.

function rec(overrides: Partial<MatchRecord> & { id?: number } = {}): MatchRecord {
  const { id, ...rest } = overrides
  const match_key =
    rest.match_key ?? (id != null ? `k${id}` : 'match:2026-05-01T12:00:00')
  return {
    match_key,
    source_files: [],
    source_types: undefined,
    data: {},
    ...rest,
  }
}

function matchRec(data: Partial<NonNullable<MatchRecord['data']>>, id = 1): MatchRecord {
  return rec({ id, data: { map: 'kings-row', mode: 'competitive', ...data } })
}

// ── filterList ────────────────────────────────────────────────────────

describe('filterList', () => {
  it('returns [] for an unknown field', () => {
    const { filterList } = setup()
    expect(filterList('nonexistent')).toEqual([])
  })

  it('returns the current array for a known field', () => {
    const { filterList, filterMode } = setup()
    filterMode.value = ['competitive']
    expect(filterList('mode')).toEqual(['competitive'])
  })
})

// ── roster computeds ─────────────────────────────────────────────────

describe('modes computed', () => {
  it('returns sorted unique modes from records', () => {
    const { modes, records } = setup()
    records.value = [
      matchRec({ mode: 'competitive' }),
      matchRec({ mode: 'quickplay' }),
      matchRec({ mode: 'competitive' }),
    ]
    expect(modes.value).toEqual(['competitive', 'quickplay'])
  })
})

describe('heroes computed', () => {
  it('includes both primary hero and heroes_played secondaries', () => {
    const { heroes, records } = setup()
    records.value = [
      matchRec({
        hero: 'lucio',
        heroes_played: [
          { hero: 'lucio', percent_played: 60 },
          { hero: 'ana', percent_played: 40 },
        ],
      }),
    ]
    expect(heroes.value).toContain('lucio')
    expect(heroes.value).toContain('ana')
  })

  it('deduplicates heroes across records', () => {
    const { heroes, records } = setup()
    records.value = [
      matchRec({ hero: 'lucio' }, 1),
      matchRec({ hero: 'lucio' }, 2),
    ]
    expect(heroes.value).toEqual(['lucio'])
  })
})

// ── filtered ─────────────────────────────────────────────────────────

describe('filtered', () => {
  it('excludes records without a map', () => {
    const { filtered, records } = setup()
    records.value = [
      matchRec({}),                   // has map (kings-row)
      rec({ id: 2, data: {} }),       // no map
    ]
    expect(filtered.value).toHaveLength(1)
    expect(filtered.value[0]!.match_key).toBe('k1')
  })

  it('returns all records when no filters are active', () => {
    const { filtered, records } = setup()
    records.value = [matchRec({}, 1), matchRec({}, 2)]
    expect(filtered.value).toHaveLength(2)
  })

  describe('mode filter', () => {
    it('includes only matching modes', () => {
      const { filtered, filterMode, records } = setup()
      records.value = [
        matchRec({ mode: 'competitive' }, 1),
        matchRec({ mode: 'quickplay' }, 2),
      ]
      filterMode.value = ['competitive']
      expect(filtered.value).toHaveLength(1)
      expect(filtered.value[0]!.match_key).toBe('k1')
    })

    it('is a union across multiple selected modes', () => {
      const { filtered, filterMode, records } = setup()
      records.value = [
        matchRec({ mode: 'competitive' }, 1),
        matchRec({ mode: 'quickplay' }, 2),
      ]
      filterMode.value = ['competitive', 'quickplay']
      expect(filtered.value).toHaveLength(2)
    })

    it('empty array means no mode filter', () => {
      const { filtered, filterMode, records } = setup()
      records.value = [matchRec({ mode: 'quickplay' })]
      filterMode.value = []
      expect(filtered.value).toHaveLength(1)
    })
  })

  describe('hero filter', () => {
    it('matches on the primary hero', () => {
      const { filtered, filterHero, records } = setup()
      records.value = [
        matchRec({ hero: 'lucio' }, 1),
        matchRec({ hero: 'ana' }, 2),
      ]
      filterHero.value = ['lucio']
      expect(filtered.value).toHaveLength(1)
      expect(filtered.value[0]!.match_key).toBe('k1')
    })

    it('matches a secondary hero from heroes_played', () => {
      const { filtered, filterHero, records } = setup()
      records.value = [
        matchRec({
          hero: 'lucio',
          heroes_played: [
            { hero: 'lucio', percent_played: 60 },
            { hero: 'juno', percent_played: 40 },
          ],
        }, 1),
        matchRec({ hero: 'ana' }, 2),
      ]
      filterHero.value = ['juno']
      expect(filtered.value).toHaveLength(1)
      expect(filtered.value[0]!.match_key).toBe('k1')
    })

    it('multi-pick is a union — match appears if ANY picked hero is present', () => {
      const { filtered, filterHero, records } = setup()
      records.value = [
        matchRec({ hero: 'lucio' }, 1),
        matchRec({ hero: 'ana' }, 2),
        matchRec({ hero: 'kiriko' }, 3),
      ]
      filterHero.value = ['lucio', 'ana']
      const ids = filtered.value.map(r => r.match_key)
      expect(ids).toContain('k1')
      expect(ids).toContain('k2')
      expect(ids).not.toContain('k3')
    })
  })

  describe('date range filter', () => {
    it('excludes undated rows when either bound is set', () => {
      const { filtered, filterFrom, records } = setup()
      records.value = [
        matchRec({ date: '2026-05-01', finished_at: '20:00' }, 1),
        matchRec({}, 2), // no date
      ]
      filterFrom.value = '2026-04-01T00:00'
      expect(filtered.value).toHaveLength(1)
      expect(filtered.value[0]!.match_key).toBe('k1')
    })

    it('respects the from bound', () => {
      const { filtered, filterFrom, records } = setup()
      records.value = [
        matchRec({ date: '2026-05-01', finished_at: '20:00' }, 1),
        matchRec({ date: '2026-03-01', finished_at: '20:00' }, 2),
      ]
      filterFrom.value = '2026-04-01T00:00'
      expect(filtered.value).toHaveLength(1)
      expect(filtered.value[0]!.match_key).toBe('k1')
    })

    it('respects the to bound', () => {
      const { filtered, filterTo, records } = setup()
      records.value = [
        matchRec({ date: '2026-03-01', finished_at: '20:00' }, 1),
        matchRec({ date: '2026-05-01', finished_at: '20:00' }, 2),
      ]
      filterTo.value = '2026-04-01T00:00'
      expect(filtered.value).toHaveLength(1)
      expect(filtered.value[0]!.match_key).toBe('k1')
    })
  })

  describe('sshot filter', () => {
    it('uses stored source_types when present', () => {
      const { filtered, filterSshot, records } = setup()
      records.value = [
        rec({ id: 1, data: { map: 'kings-row' }, source_types: { 'a.png': 'summary' } }),
        rec({ id: 2, data: { map: 'kings-row' }, source_types: { 'b.png': 'scoreboard' } }),
      ]
      filterSshot.value = ['summary']
      expect(filtered.value).toHaveLength(1)
      expect(filtered.value[0]!.match_key).toBe('k1')
    })

    it('falls back to slot inference for rows without source_types', () => {
      const { filtered, filterSshot, records } = setup()
      // scoreboard: combatTotal > 0 triggers the inference
      records.value = [
        rec({ id: 1, data: { map: 'kings-row', eliminations: 10, assists: 5, deaths: 3, damage: 1000, healing: 0, mitigation: 0 }, source_types: undefined }),
      ]
      filterSshot.value = ['scoreboard']
      expect(filtered.value).toHaveLength(1)
    })
  })

  it('AND logic across fields: must satisfy every active filter', () => {
    const { filtered, filterMode, filterMap, records } = setup()
    records.value = [
      matchRec({ mode: 'competitive', map: 'kings-row' }, 1),
      matchRec({ mode: 'quickplay', map: 'kings-row' }, 2),
      matchRec({ mode: 'competitive', map: 'rialto' }, 3),
    ]
    filterMode.value = ['competitive']
    filterMap.value  = ['kings-row']
    expect(filtered.value).toHaveLength(1)
    expect(filtered.value[0]!.match_key).toBe('k1')
  })
})

// ── filteredSorted + toggleSort ───────────────────────────────────────

describe('filteredSorted', () => {
  it('sorts newest first by default (desc)', () => {
    const { filteredSorted, records } = setup()
    records.value = [
      matchRec({ date: '2026-03-01', finished_at: '20:00' }, 1),
      matchRec({ date: '2026-05-01', finished_at: '20:00' }, 2),
    ]
    expect(filteredSorted.value.map(r => r.match_key)).toEqual(['k2', 'k1'])
  })

  it('toggleSort switches to oldest first', () => {
    const { filteredSorted, toggleSort, records } = setup()
    records.value = [
      matchRec({ date: '2026-03-01', finished_at: '20:00' }, 1),
      matchRec({ date: '2026-05-01', finished_at: '20:00' }, 2),
    ]
    toggleSort()
    expect(filteredSorted.value.map(r => r.match_key)).toEqual(['k1', 'k2'])
  })

  it('double-toggle returns to newest first', () => {
    const { filteredSorted, toggleSort, records } = setup()
    records.value = [
      matchRec({ date: '2026-03-01', finished_at: '20:00' }, 1),
      matchRec({ date: '2026-05-01', finished_at: '20:00' }, 2),
    ]
    toggleSort()
    toggleSort()
    expect(filteredSorted.value.map(r => r.match_key)).toEqual(['k2', 'k1'])
  })
})

// ── toggleFilter ──────────────────────────────────────────────────────

describe('toggleFilter', () => {
  it('adds a value to an empty filter array', () => {
    const { filterMode, toggleFilter } = setup()
    toggleFilter('mode', 'competitive')
    expect(filterMode.value).toEqual(['competitive'])
  })

  it('removes a value that is already in the array', () => {
    const { filterMode, toggleFilter } = setup()
    filterMode.value = ['competitive', 'quickplay']
    toggleFilter('mode', 'competitive')
    expect(filterMode.value).toEqual(['quickplay'])
  })

  it('is a no-op for an empty value string', () => {
    const { filterMode, toggleFilter } = setup()
    toggleFilter('mode', '')
    expect(filterMode.value).toEqual([])
  })

  it('is a no-op for an unknown field', () => {
    const { toggleFilter } = setup()
    expect(() => toggleFilter('nonexistent', 'foo')).not.toThrow()
  })
})

// ── isActive ──────────────────────────────────────────────────────────

describe('isActive', () => {
  it('returns true when value is in the filter set', () => {
    const { filterMode, isActive } = setup()
    filterMode.value = ['competitive']
    expect(isActive('mode', 'competitive')).toBe(true)
  })

  it('returns false when value is absent', () => {
    const { isActive } = setup()
    expect(isActive('mode', 'competitive')).toBe(false)
  })
})

// ── selectAllFilter / clearFilterField ───────────────────────────────

describe('selectAllFilter', () => {
  it('replaces the field array with all provided options', () => {
    const { filterMode, selectAllFilter } = setup()
    selectAllFilter('mode', ['competitive', 'quickplay'])
    expect(filterMode.value).toEqual(['competitive', 'quickplay'])
  })
})

describe('clearFilterField', () => {
  it('empties a single filter field', () => {
    const { filterMode, filterMap, clearFilterField } = setup()
    filterMode.value = ['competitive']
    filterMap.value  = ['kings-row']
    clearFilterField('mode')
    expect(filterMode.value).toEqual([])
    expect(filterMap.value).toEqual(['kings-row']) // untouched
  })
})

// ── clearFilters ──────────────────────────────────────────────────────

describe('clearFilters', () => {
  it('resets all filter arrays and date range', () => {
    const { filterMode, filterMap, filterFrom, filterTo, clearFilters } = setup()
    filterMode.value = ['competitive']
    filterMap.value  = ['kings-row']
    filterFrom.value = '2026-01-01T00:00'
    filterTo.value   = '2026-12-31T23:59'
    clearFilters()
    expect(filterMode.value).toEqual([])
    expect(filterMap.value).toEqual([])
    expect(filterFrom.value).toBe('')
    expect(filterTo.value).toBe('')
  })
})

// ── anyFilter / activeFilterCount ────────────────────────────────────

describe('anyFilter', () => {
  it('is false when nothing is active', () => {
    const { anyFilter } = setup()
    expect(anyFilter.value).toBe(false)
  })

  it('is true when any field has a value', () => {
    const { anyFilter, filterMode } = setup()
    filterMode.value = ['competitive']
    expect(anyFilter.value).toBe(true)
  })

  it('is true when only the date-from bound is set', () => {
    const { anyFilter, filterFrom } = setup()
    filterFrom.value = '2026-01-01T00:00'
    expect(anyFilter.value).toBe(true)
  })
})

describe('activeFilterCount', () => {
  it('returns 0 when nothing is active', () => {
    const { activeFilterCount } = setup()
    expect(activeFilterCount.value).toBe(0)
  })

  it('counts each non-empty field as 1', () => {
    const { activeFilterCount, filterMode, filterMap, filterFrom } = setup()
    filterMode.value = ['competitive']
    filterMap.value  = ['kings-row']
    filterFrom.value = '2026-01-01T00:00'
    expect(activeFilterCount.value).toBe(3)
  })
})

// ── undatedMatchCount ─────────────────────────────────────────────────

describe('undatedMatchCount', () => {
  it('counts records missing date or finished_at', () => {
    const { undatedMatchCount, records } = setup()
    records.value = [
      matchRec({ date: '2026-05-01', finished_at: '20:00' }),
      matchRec({}), // no date
    ]
    expect(undatedMatchCount.value).toBe(1)
  })
})

// ── resetDateRange ────────────────────────────────────────────────────

describe('resetDateRange', () => {
  it('clears filterFrom and filterTo without touching other filters', () => {
    const { filterMode, filterFrom, filterTo, resetDateRange } = setup()
    filterMode.value = ['competitive']
    filterFrom.value = '2026-01-01T00:00'
    filterTo.value   = '2026-12-31T23:59'
    resetDateRange()
    expect(filterFrom.value).toBe('')
    expect(filterTo.value).toBe('')
    expect(filterMode.value).toEqual(['competitive']) // untouched
  })
})

// ── includeUndated toggle ─────────────────────────────────────────────
//
// Default: undated records (missing data.date or data.finished_at) are
// dropped from `filtered`. Passing a `ref(true)` opts them back in.
// The toggle is independent of the date-range filter, which always
// drops undated rows when a range is set.

describe('includeUndated', () => {
  it('hides undated records by default (no includeUndated ref provided)', () => {
    const records = ref<MatchRecord[]>([
      matchRec({ date: '2026-05-10', finished_at: '21:29' }, 1),
      matchRec({}, 2), // undated
    ])
    let api!: ReturnType<typeof useMatchFilters>
    effectScope().run(() => { api = useMatchFilters(records) })
    // Only the dated record survives. (No includeUndated ref → default off.)
    expect(api.filtered.value.map(r => r.match_key)).toEqual(['k1'])
  })

  it('hides undated records when includeUndated ref is false', () => {
    const include = ref(false)
    const { filtered, records } = setup([], include)
    records.value = [
      matchRec({ date: '2026-05-10', finished_at: '21:29' }, 1),
      matchRec({}, 2),
    ]
    expect(filtered.value.map(r => r.match_key)).toEqual(['k1'])
  })

  it('shows undated records when includeUndated ref is true', () => {
    const include = ref(true)
    const { filtered, records } = setup([], include)
    records.value = [
      matchRec({ date: '2026-05-10', finished_at: '21:29' }, 1),
      matchRec({}, 2),
    ]
    expect(filtered.value.map(r => r.match_key)).toEqual(['k1', 'k2'])
  })

  it('reactively re-filters when the ref flips', async () => {
    const include = ref(false)
    const { filtered, records } = setup([], include)
    records.value = [
      matchRec({ date: '2026-05-10', finished_at: '21:29' }, 1),
      matchRec({}, 2),
    ]
    expect(filtered.value).toHaveLength(1)

    include.value = true
    expect(filtered.value).toHaveLength(2)

    include.value = false
    expect(filtered.value).toHaveLength(1)
  })

  it('still excludes undated when a date range is active even with includeUndated=true', () => {
    const include = ref(true)
    const { filtered, filterFrom, records } = setup([], include)
    records.value = [
      matchRec({ date: '2026-05-10', finished_at: '21:29' }, 1),
      matchRec({}, 2),
    ]
    filterFrom.value = '2026-01-01T00:00'
    // Range filter still drops undated rows regardless of the toggle.
    expect(filtered.value.map(r => r.match_key)).toEqual(['k1'])
  })

  it('treats data.date missing OR data.finished_at missing as undated', () => {
    const include = ref(false)
    const { filtered, records } = setup([], include)
    records.value = [
      matchRec({ date: '2026-05-10', finished_at: '21:29' }, 1),
      matchRec({ date: '2026-05-10' }, 2),                  // no finished_at
      matchRec({ finished_at: '21:29' }, 3),                // no date
      matchRec({}, 4),                                      // neither
    ]
    expect(filtered.value.map(r => r.match_key)).toEqual(['k1'])
  })
})

// ── min-play threshold filter ────────────────────────────────────────
//
// A match qualifies if AT LEAST ONE candidate hero meets EITHER the
// percent threshold OR the minutes threshold. "Candidate hero" is the
// selected hero(es) when the hero filter is set; otherwise every entry
// in heroes_played. Both thresholds default to 0 (filter is a no-op).
// Game length is encoded "MM:SS"; minutes-played is gameLength × pct.

describe('min-play threshold filter', () => {
  function makeHeroRec(
    id: number,
    heroes: Array<{ hero: string; percent_played: number }>,
    game_length = '10:00',
  ): MatchRecord {
    const primary = heroes[0]?.hero ?? ''
    return matchRec({ hero: primary, game_length, heroes_played: heroes }, id)
  }

  it('no-op when both thresholds are 0', () => {
    const { filtered } = setup([
      makeHeroRec(1, [{ hero: 'lucio', percent_played: 2 }], '10:00'),
    ], ref(true), ref(0), ref(0))
    expect(filtered.value.map(r => r.match_key)).toEqual(['k1'])
  })

  it('excludes a match where the only hero falls below the percent threshold', () => {
    const { filtered } = setup([
      makeHeroRec(1, [{ hero: 'lucio', percent_played: 2 }], '10:00'),
      makeHeroRec(2, [{ hero: 'sigma', percent_played: 80 }], '10:00'),
    ], ref(true), ref(5), ref(0))
    expect(filtered.value.map(r => r.match_key)).toEqual(['k2'])
  })

  it('admits a match where ANY hero meets the percent threshold (max-of, not all-of)', () => {
    const { filtered } = setup([
      makeHeroRec(1, [
        { hero: 'lucio',   percent_played: 2 },
        { hero: 'kiriko',  percent_played: 70 },
      ], '10:00'),
    ], ref(true), ref(5), ref(0))
    expect(filtered.value.map(r => r.match_key)).toEqual(['k1'])
  })

  it('excludes a match where the only hero falls below the minutes threshold', () => {
    // 2% of a 10-minute game = 0.2 min. Threshold 1 min excludes.
    const { filtered } = setup([
      makeHeroRec(1, [{ hero: 'lucio', percent_played: 2 }], '10:00'),
    ], ref(true), ref(0), ref(1))
    expect(filtered.value).toHaveLength(0)
  })

  it('OR semantics: meeting EITHER threshold qualifies the match', () => {
    // Lucio: 8% of 10 min = 0.8 min. Below 1 min — but 8% >= 5%. Passes.
    const { filtered } = setup([
      makeHeroRec(1, [{ hero: 'lucio', percent_played: 8 }], '10:00'),
    ], ref(true), ref(5), ref(1))
    expect(filtered.value.map(r => r.match_key)).toEqual(['k1'])
  })

  it('with the hero filter set, threshold applies to the selected hero only', () => {
    // Lucio 2% (fails 5%); Kiriko 70% (passes). With hero filter=[lucio],
    // we only judge lucio — and lucio fails. Match excluded.
    const { filtered, filterHero } = setup([
      makeHeroRec(1, [
        { hero: 'lucio',  percent_played: 2  },
        { hero: 'kiriko', percent_played: 70 },
      ], '10:00'),
    ], ref(true), ref(5), ref(0))
    filterHero.value = ['lucio']
    expect(filtered.value).toHaveLength(0)
  })

  it('with hero filter selecting kiriko, the match qualifies via kiriko', () => {
    const { filtered, filterHero } = setup([
      makeHeroRec(1, [
        { hero: 'lucio',  percent_played: 2  },
        { hero: 'kiriko', percent_played: 70 },
      ], '10:00'),
    ], ref(true), ref(5), ref(0))
    filterHero.value = ['kiriko']
    expect(filtered.value.map(r => r.match_key)).toEqual(['k1'])
  })

  it('missing game_length disables the minutes check but the percent check still applies', () => {
    // No game_length → can't compute minutes. With minMinutes=1 only, the
    // match should still pass (we can't say it failed). With minPercent=5
    // also set and a hero at 70%, it passes via percent.
    const { filtered } = setup([
      makeHeroRec(1, [{ hero: 'lucio', percent_played: 70 }], ''),
    ], ref(true), ref(5), ref(1))
    expect(filtered.value.map(r => r.match_key)).toEqual(['k1'])
  })

  it('counts the threshold in activeFilterCount when either threshold is > 0', () => {
    // With both thresholds 0, no count.
    const noThresh = setup([], ref(true), ref(0), ref(0))
    expect(noThresh.activeFilterCount.value).toBe(0)

    const justPercent = setup([], ref(true), ref(5), ref(0))
    expect(justPercent.activeFilterCount.value).toBe(1)

    const justMinutes = setup([], ref(true), ref(0), ref(1))
    expect(justMinutes.activeFilterCount.value).toBe(1)

    // Both > 0 still counts as one logical filter (OR group).
    const both = setup([], ref(true), ref(5), ref(1))
    expect(both.activeFilterCount.value).toBe(1)
  })

  it('clearFilters resets both min-play thresholds via the persisted setters', () => {
    // Bug being fixed: clearFilters used to leave the min-play knobs
    // alone because the composable only had read refs. Now the setters
    // are wired in so "Clear Filters" really clears EVERY filter, not
    // just the array-shaped ones.
    const setPct = vi.fn()
    const setMin = vi.fn()
    const { clearFilters } = setup(
      [],
      ref(true),
      ref(5),     // percent threshold engaged
      ref(0.5),   // minutes threshold engaged
      setPct,
      setMin,
    )
    clearFilters()
    expect(setPct).toHaveBeenCalledWith(0)
    expect(setMin).toHaveBeenCalledWith(0)
  })

  it('clearFilters is a no-op for thresholds already at 0 (but still safe to call)', () => {
    const setPct = vi.fn()
    const setMin = vi.fn()
    const { clearFilters } = setup(
      [],
      ref(true),
      ref(0),
      ref(0),
      setPct,
      setMin,
    )
    clearFilters()
    // We still call the setters — they're cheap and idempotent —
    // rather than branching on current values. The behaviour the user
    // sees is unchanged because the value was already 0.
    expect(setPct).toHaveBeenCalledWith(0)
    expect(setMin).toHaveBeenCalledWith(0)
  })
})

describe('showHidden + hiddenMatchCount', () => {
  it('drops hidden records from filtered by default', () => {
    const { filtered } = setup([
      matchRec({ map: 'kings-row' }, 1),
      { ...matchRec({ map: 'rialto' }, 2), hidden: true },
    ])
    const keys = filtered.value.map(r => r.match_key)
    expect(keys).toEqual(['k1'])
  })

  it('includes hidden records when showHidden is on', () => {
    const showHidden = ref(true)
    const { filtered } = setup(
      [
        matchRec({ map: 'kings-row' }, 1),
        { ...matchRec({ map: 'rialto' }, 2), hidden: true },
      ],
      undefined, undefined, undefined, undefined, undefined,
      undefined,
      showHidden,
    )
    const keys = filtered.value.map(r => r.match_key).sort()
    expect(keys).toEqual(['k1', 'k2'])
  })

  it('hiddenMatchCount totals every hidden record regardless of other filters', () => {
    // Set a mode filter that excludes k2 (mode mismatch) and verify
    // hiddenMatchCount still reports 2 — it counts source rows, not
    // post-filter rows, so the FilterRail label stays stable as the
    // user adjusts other filters.
    const { filterMode, hiddenMatchCount } = setup([
      { ...matchRec({ map: 'kings-row', mode: 'competitive' }, 1), hidden: true },
      { ...matchRec({ map: 'rialto', mode: 'quickplay' }, 2), hidden: true },
      matchRec({ map: 'ilios', mode: 'competitive' }, 3),
    ])
    filterMode.value = ['competitive']
    expect(hiddenMatchCount.value).toBe(2)
  })

  it('hiddenMatchCount is 0 when no records are hidden', () => {
    const { hiddenMatchCount } = setup([
      matchRec({ map: 'kings-row' }, 1),
      matchRec({ map: 'rialto' }, 2),
    ])
    expect(hiddenMatchCount.value).toBe(0)
  })
})
