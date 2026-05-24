import { describe, it, expect, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import type { Ref } from 'vue'
import { useMatchGrouping } from './useMatchGrouping'
import type { GroupableRecord } from '../match-helpers'

// Fixture builder. Each record has a date / finished_at and an optional
// result so tallies fire deterministically. match_key is the row's
// stable id for sort tie-breakers.
function rec(date: string, time: string, result?: string, key = `${date}T${time}`): GroupableRecord {
  return { match_key: key, data: { date, finished_at: time, result: result ?? '' } }
}

const SAMPLE = [
  rec('2026-05-10', '21:29', 'victory'), // Sun
  rec('2026-05-10', '22:05', 'defeat'),
  rec('2026-05-08', '20:00', 'victory'), // Fri
  rec('2026-04-15', '20:00', 'defeat'),  // Wed
]

describe('useMatchGrouping — tree building', () => {
  it('rebuilds the tree when sortDir changes', async () => {
    const records = ref(SAMPLE)
    const sort = ref<'asc' | 'desc'>('desc')
    const { groups } = useMatchGrouping(records, sort)

    expect(groups.value.map(g => g.label)).toEqual(['MAY 2026', 'APRIL 2026'])

    sort.value = 'asc'
    await nextTick()
    expect(groups.value.map(g => g.label)).toEqual(['APRIL 2026', 'MAY 2026'])
  })

  it('returns an empty tree for an empty record set', () => {
    const records = ref<GroupableRecord[]>([])
    const sort = ref<'asc' | 'desc'>('desc')
    const { groups } = useMatchGrouping(records, sort)
    expect(groups.value).toEqual([])
  })
})

describe('useMatchGrouping — default expansion', () => {
  it('auto-expands the newest path on first non-empty tree', () => {
    const records = ref(SAMPLE)
    const sort = ref<'asc' | 'desc'>('desc')
    const { groups, isGroupExpanded } = useMatchGrouping(records, sort)

    const may = groups.value[0]!
    const may10Week = may.children![0]!
    const may10Day = may10Week.children![0]!

    expect(isGroupExpanded(may.key)).toBe(true)
    expect(isGroupExpanded(may10Week.key)).toBe(true)
    expect(isGroupExpanded(may10Day.key)).toBe(true)
    // The April month must NOT be auto-expanded.
    const april = groups.value[1]!
    expect(isGroupExpanded(april.key)).toBe(false)
  })

  it('re-defaults when records first arrive (empty → populated)', async () => {
    const records = ref<GroupableRecord[]>([])
    const sort = ref<'asc' | 'desc'>('desc')
    const { groups, isGroupExpanded } = useMatchGrouping(records, sort)

    expect(groups.value).toHaveLength(0)

    records.value = SAMPLE
    await nextTick()
    expect(isGroupExpanded(groups.value[0]!.key)).toBe(true)
  })

  it('does not re-default after the user has toggled', async () => {
    const records = ref(SAMPLE)
    const sort = ref<'asc' | 'desc'>('desc')
    const { groups, isGroupExpanded, toggleGroup } = useMatchGrouping(records, sort)

    const newestMonth = groups.value[0]!.key
    // The user collapses the newest month.
    toggleGroup(newestMonth)
    expect(isGroupExpanded(newestMonth)).toBe(false)

    // Apply a filter that drops some records — the tree changes shape.
    records.value = SAMPLE.slice(0, 3)
    await nextTick()
    // The newest month must STILL be collapsed — the user's choice survives.
    expect(isGroupExpanded(groups.value[0]!.key)).toBe(false)
  })
})

describe('useMatchGrouping — toggle / expand-all / collapse-all', () => {
  let records: Ref<GroupableRecord[]>
  let sort: Ref<'asc' | 'desc'>
  let api: ReturnType<typeof useMatchGrouping<GroupableRecord>>

  beforeEach(() => {
    records = ref<GroupableRecord[]>(SAMPLE) as Ref<GroupableRecord[]>
    sort = ref<'asc' | 'desc'>('desc') as Ref<'asc' | 'desc'>
    api = useMatchGrouping<GroupableRecord>(records, sort)
  })

  it('toggleGroup flips the membership of a key', () => {
    const k = api.groups.value[1]!.key // April month — not expanded by default
    expect(api.isGroupExpanded(k)).toBe(false)
    api.toggleGroup(k)
    expect(api.isGroupExpanded(k)).toBe(true)
    api.toggleGroup(k)
    expect(api.isGroupExpanded(k)).toBe(false)
  })

  it('expandAll fills the expanded set with every group key', () => {
    api.expandAll()
    // Every month, week, and day should be in expanded.
    expect(api.allExpanded.value).toBe(true)
  })

  it('collapseAll empties the expanded set', () => {
    api.expandAll()
    expect(api.anyExpanded.value).toBe(true)
    api.collapseAll()
    expect(api.anyExpanded.value).toBe(false)
    expect(api.allExpanded.value).toBe(false)
  })

  it('allExpanded is false when the tree is empty', () => {
    const empty = ref<GroupableRecord[]>([])
    const { allExpanded } = useMatchGrouping<GroupableRecord>(empty, ref<'asc' | 'desc'>('desc'))
    expect(allExpanded.value).toBe(false)
  })
})
