import { describe, it, expect } from 'vitest'
import { effectScope, ref } from 'vue'
import { useMatchFilters } from './useMatchFilters'
import type { MatchRecord } from '../api'

// Call the composable inside an effectScope so computed() and ref()
// work without needing a mounted component.
function setup(initial: MatchRecord[] = []) {
  const records = ref<MatchRecord[]>(initial)
  let result!: ReturnType<typeof useMatchFilters>
  const scope = effectScope()
  scope.run(() => { result = useMatchFilters(records) })
  return { ...result, records }
}

// ── Minimal record builder ────────────────────────────────────────────

function rec(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 1,
    match_key: 'match:2026-05-01T12:00:00',
    source_files: [],
    source_types: undefined,
    data: {},
    ...overrides,
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
    expect(filtered.value[0]!.id).toBe(1)
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
      expect(filtered.value[0]!.id).toBe(1)
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
      expect(filtered.value[0]!.id).toBe(1)
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
      expect(filtered.value[0]!.id).toBe(1)
    })

    it('multi-pick is a union — match appears if ANY picked hero is present', () => {
      const { filtered, filterHero, records } = setup()
      records.value = [
        matchRec({ hero: 'lucio' }, 1),
        matchRec({ hero: 'ana' }, 2),
        matchRec({ hero: 'kiriko' }, 3),
      ]
      filterHero.value = ['lucio', 'ana']
      const ids = filtered.value.map(r => r.id)
      expect(ids).toContain(1)
      expect(ids).toContain(2)
      expect(ids).not.toContain(3)
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
      expect(filtered.value[0]!.id).toBe(1)
    })

    it('respects the from bound', () => {
      const { filtered, filterFrom, records } = setup()
      records.value = [
        matchRec({ date: '2026-05-01', finished_at: '20:00' }, 1),
        matchRec({ date: '2026-03-01', finished_at: '20:00' }, 2),
      ]
      filterFrom.value = '2026-04-01T00:00'
      expect(filtered.value).toHaveLength(1)
      expect(filtered.value[0]!.id).toBe(1)
    })

    it('respects the to bound', () => {
      const { filtered, filterTo, records } = setup()
      records.value = [
        matchRec({ date: '2026-03-01', finished_at: '20:00' }, 1),
        matchRec({ date: '2026-05-01', finished_at: '20:00' }, 2),
      ]
      filterTo.value = '2026-04-01T00:00'
      expect(filtered.value).toHaveLength(1)
      expect(filtered.value[0]!.id).toBe(1)
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
      expect(filtered.value[0]!.id).toBe(1)
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
    expect(filtered.value[0]!.id).toBe(1)
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
    expect(filteredSorted.value.map(r => r.id)).toEqual([2, 1])
  })

  it('toggleSort switches to oldest first', () => {
    const { filteredSorted, toggleSort, records } = setup()
    records.value = [
      matchRec({ date: '2026-03-01', finished_at: '20:00' }, 1),
      matchRec({ date: '2026-05-01', finished_at: '20:00' }, 2),
    ]
    toggleSort()
    expect(filteredSorted.value.map(r => r.id)).toEqual([1, 2])
  })

  it('double-toggle returns to newest first', () => {
    const { filteredSorted, toggleSort, records } = setup()
    records.value = [
      matchRec({ date: '2026-03-01', finished_at: '20:00' }, 1),
      matchRec({ date: '2026-05-01', finished_at: '20:00' }, 2),
    ]
    toggleSort()
    toggleSort()
    expect(filteredSorted.value.map(r => r.id)).toEqual([2, 1])
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
