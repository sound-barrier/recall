import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import type { MatchRecord } from '../api'
import { useMatchesDossier, type LeaverHandling } from './useMatchesDossier'

function rec(opts: {
  key?: string
  result?: 'victory' | 'defeat' | 'draw'
  map?: string
  hero?: string
  leaver?: '' | 'self' | 'team' | 'enemy'
}): MatchRecord {
  return {
    match_key: opts.key ?? `m-${Math.random()}`,
    source_files: ['a.png'],
    source_types: { 'a.png': 'summary' },
    data: {
      map: opts.map ?? 'rialto',
      hero: opts.hero ?? 'lucio',
      result: opts.result ?? 'victory',
      date: '2026-05-10', finished_at: '14:00',
      mode: 'competitive',
    },
    annotation: opts.leaver ? { leaver: opts.leaver } : undefined,
    parsed_at: '2026-05-10T14:00:00Z',
  } as unknown as MatchRecord
}

describe('useMatchesDossier', () => {
  describe('wld counts', () => {
    it('tallies wins / losses / draws across records', () => {
      const records = ref([
        rec({ result: 'victory' }),
        rec({ result: 'victory' }),
        rec({ result: 'defeat' }),
        rec({ result: 'draw' }),
      ])
      const { wld } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(wld.value).toEqual({ w: 2, l: 1, d: 1, total: 4 })
    })

    it('counts records without a result as nothing', () => {
      const records = ref([rec({}), { ...rec({}), data: undefined } as unknown as MatchRecord])
      const { wld } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(wld.value.total).toBe(1)
    })

    it('returns zeros for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { wld } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(wld.value).toEqual({ w: 0, l: 0, d: 0, total: 0 })
    })
  })

  describe('winrate', () => {
    it('excludes draws from the denominator', () => {
      const records = ref([
        rec({ result: 'victory' }),
        rec({ result: 'victory' }),
        rec({ result: 'defeat' }),
        rec({ result: 'draw' }),
        rec({ result: 'draw' }),
      ])
      const { winrate } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      // 2 wins / (2 wins + 1 loss) = 67%
      expect(winrate.value).toBe(67)
    })

    it('returns null when there are no wins or losses', () => {
      const records = ref([rec({ result: 'draw' }), rec({ result: 'draw' })])
      const { winrate } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(winrate.value).toBe(null)
    })

    it('returns null for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { winrate } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(winrate.value).toBe(null)
    })
  })

  describe('leaver handling', () => {
    it('exclude-tally drops leaver-annotated records from KPIs only', () => {
      const records = ref([
        rec({ key: 'w1', result: 'victory' }),
        rec({ key: 'l1', result: 'defeat', leaver: 'self' }),
        rec({ key: 'l2', result: 'defeat' }),
      ])
      const handling = ref<LeaverHandling>('exclude-tally')
      const { wld, winrate } = useMatchesDossier(records, handling)
      // The leaver-tagged loss is dropped from the tally → 1W / 1L.
      expect(wld.value).toEqual({ w: 1, l: 1, d: 0, total: 2 })
      expect(winrate.value).toBe(50)
    })

    it('include counts leaver-annotated records normally', () => {
      const records = ref([
        rec({ result: 'victory' }),
        rec({ result: 'defeat', leaver: 'team' }),
      ])
      const { wld } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(wld.value).toEqual({ w: 1, l: 1, d: 0, total: 2 })
    })
  })

  describe('topMaps', () => {
    it('orders by total count, descending', () => {
      const records = ref([
        rec({ map: 'rialto' }),
        rec({ map: 'rialto' }),
        rec({ map: 'rialto' }),
        rec({ map: 'numbani' }),
        rec({ map: 'numbani' }),
        rec({ map: 'lijiang' }),
      ])
      const { topMaps } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(topMaps.value.map((m) => m.key)).toEqual(['rialto', 'numbani', 'lijiang'])
      expect(topMaps.value[0]!.total).toBe(3)
    })

    it('caps at 5 entries', () => {
      const records = ref(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((m) => rec({ map: m })),
      )
      const { topMaps } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(topMaps.value).toHaveLength(5)
    })

    it('skips records with empty map', () => {
      const records = ref([rec({ map: 'rialto' }), rec({ map: '' })])
      const { topMaps } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(topMaps.value).toHaveLength(1)
    })

    it('reports per-map winrate', () => {
      const records = ref([
        rec({ map: 'rialto', result: 'victory' }),
        rec({ map: 'rialto', result: 'victory' }),
        rec({ map: 'rialto', result: 'defeat' }),
        rec({ map: 'rialto', result: 'defeat' }),
      ])
      const { topMaps } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(topMaps.value[0]!.winrate).toBe(50)
    })
  })

  describe('topHeroes', () => {
    it('orders by count, caps at 5', () => {
      const records = ref([
        ...['lucio', 'lucio', 'lucio', 'mercy', 'mercy', 'soldier', 'rein', 'kiriko', 'ana'].map((h) => rec({ hero: h })),
      ])
      const { topHeroes } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(topHeroes.value).toHaveLength(5)
      expect(topHeroes.value[0]!.key).toBe('lucio')
    })
  })

  describe('reactivity', () => {
    it('updates when records change', () => {
      const records = ref([rec({ result: 'victory' })])
      const { wld } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(wld.value.total).toBe(1)
      records.value = [...records.value, rec({ result: 'defeat' })]
      expect(wld.value.total).toBe(2)
    })

    it('updates when leaverHandling flips', () => {
      const records = ref([
        rec({ result: 'victory' }),
        rec({ result: 'defeat', leaver: 'self' }),
      ])
      const handling = ref<LeaverHandling>('include')
      const { wld } = useMatchesDossier(records, handling)
      expect(wld.value.total).toBe(2)
      handling.value = 'exclude-tally'
      expect(wld.value.total).toBe(1)
    })
  })
})
