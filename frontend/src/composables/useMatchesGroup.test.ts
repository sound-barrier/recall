import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import type { MatchRecord } from '../api'
import { useMatchesGroup, type GroupBy, type SortOrder } from './useMatchesGroup'

function rec(date: string, finishedAt: string, key: string): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    source_types: { [`${key}.png`]: 'summary' },
    data: { date, finished_at: finishedAt, map: 'rialto', mode: 'competitive', hero: 'lucio' },
    parsed_at: `${date}T${finishedAt}:00Z`,
  } as unknown as MatchRecord
}

describe('useMatchesGroup', () => {
  const corpus = [
    rec('2026-05-10', '14:30', 'a'),
    rec('2026-05-10', '15:45', 'b'),
    rec('2026-05-11', '12:00', 'c'),
    rec('2026-05-17', '20:15', 'd'), // Sunday — new week vs the Mon-Sun bracket
    rec('2026-06-02', '08:00', 'e'),
    rec('2027-01-15', '19:00', 'f'),
  ]

  describe('sort order', () => {
    it('newest puts the latest record first', () => {
      const records = ref(corpus)
      const { sortedRecords } = useMatchesGroup(records, ref<GroupBy>('none'), ref<SortOrder>('newest'))
      expect(sortedRecords.value[0]!.match_key).toBe('f')
      expect(sortedRecords.value[sortedRecords.value.length - 1]!.match_key).toBe('a')
    })

    it('oldest puts the earliest record first', () => {
      const records = ref(corpus)
      const { sortedRecords } = useMatchesGroup(records, ref<GroupBy>('none'), ref<SortOrder>('oldest'))
      expect(sortedRecords.value[0]!.match_key).toBe('a')
      expect(sortedRecords.value[sortedRecords.value.length - 1]!.match_key).toBe('f')
    })

    it('uses date+finished_at to break ties within a day', () => {
      const records = ref([rec('2026-05-10', '15:45', 'late'), rec('2026-05-10', '09:00', 'early')])
      const { sortedRecords } = useMatchesGroup(records, ref<GroupBy>('none'), ref<SortOrder>('newest'))
      expect(sortedRecords.value.map((r) => r.match_key)).toEqual(['late', 'early'])
    })
  })

  describe('group by none', () => {
    it('returns a single section with all records and no header', () => {
      const records = ref(corpus)
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('none'), ref<SortOrder>('newest'))
      expect(groupedSections.value).toHaveLength(1)
      expect(groupedSections.value[0]!.header).toBe(null)
      expect(groupedSections.value[0]!.records).toHaveLength(corpus.length)
    })
  })

  describe('group by day', () => {
    it('creates one section per unique date', () => {
      const records = ref(corpus)
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('day'), ref<SortOrder>('newest'))
      // 2027-01-15, 2026-06-02, 2026-05-17, 2026-05-11, 2026-05-10
      expect(groupedSections.value).toHaveLength(5)
    })

    it('puts multi-match days in their own section', () => {
      const records = ref(corpus)
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('day'), ref<SortOrder>('newest'))
      const may10 = groupedSections.value.find((s) => s.key === '2026-05-10')
      expect(may10).toBeDefined()
      expect(may10!.records).toHaveLength(2)
    })

    it('headers are non-empty + human readable', () => {
      const records = ref(corpus)
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('day'), ref<SortOrder>('newest'))
      for (const s of groupedSections.value) {
        expect(s.header).toBeTruthy()
        expect(s.header!.length).toBeGreaterThan(2)
      }
    })
  })

  describe('group by week', () => {
    it('Monday-anchored weeks — Sunday May 17 sits in the May 11 (Mon) bucket', () => {
      // 2026-05-10 is a Sunday → its Monday-week starts 2026-05-04
      // 2026-05-11 (Mon) starts week 2026-05-11
      // 2026-05-17 (Sun) sits in that same 2026-05-11 week
      const records = ref(corpus)
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('week'), ref<SortOrder>('oldest'))
      const monMay4Week = groupedSections.value.find((s) => s.key === '2026-05-04')
      const monMay11Week = groupedSections.value.find((s) => s.key === '2026-05-11')
      expect(monMay4Week?.records.map((r) => r.match_key).sort()).toEqual(['a', 'b'])
      expect(monMay11Week?.records.map((r) => r.match_key).sort()).toEqual(['c', 'd'])
    })

    it('header reads "Week of Mon DD"', () => {
      const records = ref([rec('2026-05-11', '12:00', 'c')])
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('week'), ref<SortOrder>('newest'))
      expect(groupedSections.value[0]!.header).toMatch(/Week of/)
    })
  })

  describe('group by month', () => {
    it('one section per YYYY-MM bucket', () => {
      const records = ref(corpus)
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('month'), ref<SortOrder>('newest'))
      // 2027-01, 2026-06, 2026-05
      expect(groupedSections.value).toHaveLength(3)
      const may = groupedSections.value.find((s) => s.key === '2026-05')
      expect(may?.records).toHaveLength(4) // a, b, c, d
    })
  })

  describe('group by year', () => {
    it('one section per YYYY bucket', () => {
      const records = ref(corpus)
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('year'), ref<SortOrder>('newest'))
      expect(groupedSections.value).toHaveLength(2)
      expect(groupedSections.value.find((s) => s.key === '2027')?.records).toHaveLength(1)
      expect(groupedSections.value.find((s) => s.key === '2026')?.records).toHaveLength(5)
    })
  })

  describe('reactivity', () => {
    it('flips sort order when the ref changes', () => {
      const records = ref(corpus)
      const order = ref<SortOrder>('newest')
      const { sortedRecords } = useMatchesGroup(records, ref<GroupBy>('none'), order)
      expect(sortedRecords.value[0]!.match_key).toBe('f')
      order.value = 'oldest'
      expect(sortedRecords.value[0]!.match_key).toBe('a')
    })

    it('re-buckets when groupBy flips', () => {
      const records = ref(corpus)
      const gb = ref<GroupBy>('day')
      const { groupedSections } = useMatchesGroup(records, gb, ref<SortOrder>('newest'))
      expect(groupedSections.value).toHaveLength(5)
      gb.value = 'year'
      expect(groupedSections.value).toHaveLength(2)
    })
  })

  describe('empty input', () => {
    it('returns no sections when there are no records and groupBy is set', () => {
      const records = ref<MatchRecord[]>([])
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('day'), ref<SortOrder>('newest'))
      expect(groupedSections.value).toHaveLength(0)
    })

    it('returns one empty section when there are no records and groupBy is none', () => {
      const records = ref<MatchRecord[]>([])
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('none'), ref<SortOrder>('newest'))
      expect(groupedSections.value).toHaveLength(1)
      expect(groupedSections.value[0]!.records).toHaveLength(0)
    })
  })

  describe('records lacking a date', () => {
    it('groups them under a "no-date" bucket when grouping is active', () => {
      const records = ref([
        rec('2026-05-10', '12:00', 'dated'),
        { ...rec('', '', 'undated'), data: { ...rec('', '', 'undated').data, date: '' } },
      ])
      const { groupedSections } = useMatchesGroup(records, ref<GroupBy>('day'), ref<SortOrder>('newest'))
      const undatedSection = groupedSections.value.find((s) => s.key === 'no-date')
      expect(undatedSection?.records.map((r) => r.match_key)).toContain('undated')
    })
  })
})
