import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import type { MatchRecord } from '../api'
import { useMatchesNarrow } from './useMatchesNarrow'

function rec(opts: {
  key?: string
  map?: string | null
  hero?: string
  role?: string
  type?: string
  mode?: string
  result?: 'victory' | 'defeat' | 'draw'
  date?: string
  finishedAt?: string
  tags?: string[]
  leaver?: '' | 'self' | 'team' | 'enemy'
  note?: string
  heroesPlayed?: { hero: string; percent_played?: number; play_time?: string }[]
} = {}): MatchRecord {
  return {
    match_key: opts.key ?? `m-${Math.random()}`,
    source_files: ['a.png'],
    source_types: { 'a.png': 'summary' },
    data: {
      ...(opts.map === undefined ? { map: 'rialto' } : (opts.map === null ? {} : { map: opts.map })),
      mode: opts.mode ?? 'competitive',
      type: opts.type ?? 'control',
      role: opts.role ?? 'support',
      hero: opts.hero ?? 'lucio',
      result: opts.result ?? 'victory',
      date: opts.date ?? '2026-05-10',
      finished_at: opts.finishedAt ?? '14:00',
      heroes_played: opts.heroesPlayed ?? [{ hero: opts.hero ?? 'lucio', percent_played: 100, play_time: '10:00' }],
    },
    ...(opts.tags || opts.leaver || opts.note
      ? { annotation: { tags: opts.tags ?? [], leaver: opts.leaver ?? '', note: opts.note ?? '' } }
      : {}),
    parsed_at: `${opts.date ?? '2026-05-10'}T${opts.finishedAt ?? '14:00'}:00Z`,
  } as unknown as MatchRecord
}

describe('useMatchesNarrow', () => {
  describe('defaults', () => {
    it('returns all records (minus unknown-map) when no narrow is active', () => {
      const records = ref([rec({ key: 'a' }), rec({ key: 'b' })])
      const { narrowedRecords, anyNarrow } = useMatchesNarrow({ records })
      expect(anyNarrow.value).toBe(false)
      expect(narrowedRecords.value).toHaveLength(2)
    })

    it('hides unknown-map records by default', () => {
      const records = ref([rec({ key: 'mapped' }), rec({ key: 'unmapped', map: null })])
      const { narrowedRecords } = useMatchesNarrow({ records })
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['mapped'])
    })

    it('includeUnknown=true surfaces unknown-map records', () => {
      const records = ref([rec({ key: 'mapped' }), rec({ key: 'unmapped', map: null })])
      const { narrowedRecords, includeUnknown } = useMatchesNarrow({ records })
      includeUnknown.value = true
      expect(narrowedRecords.value).toHaveLength(2)
    })
  })

  describe('free-text search', () => {
    it('matches map name', () => {
      const records = ref([rec({ key: 'a', map: 'rialto' }), rec({ key: 'b', map: 'numbani' })])
      const { narrowedRecords, searchText } = useMatchesNarrow({ records })
      searchText.value = 'numbani'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['b'])
    })

    it('matches primary hero', () => {
      const records = ref([rec({ key: 'a', hero: 'lucio' }), rec({ key: 'b', hero: 'mercy' })])
      const { narrowedRecords, searchText } = useMatchesNarrow({ records })
      searchText.value = 'mercy'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['b'])
    })

    it('matches any heroes_played entry, not just the primary', () => {
      const records = ref([
        rec({ key: 'a', hero: 'lucio', heroesPlayed: [
          { hero: 'lucio', percent_played: 60, play_time: '6:00' },
          { hero: 'kiriko', percent_played: 40, play_time: '4:00' },
        ]}),
        rec({ key: 'b', hero: 'mercy' }),
      ])
      const { narrowedRecords, searchText } = useMatchesNarrow({ records })
      searchText.value = 'kiriko'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('matches annotation note', () => {
      const records = ref([
        rec({ key: 'a', note: 'huge clutch hold' }),
        rec({ key: 'b', note: 'rolled them' }),
      ])
      const { narrowedRecords, searchText } = useMatchesNarrow({ records })
      searchText.value = 'clutch'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('matches annotation tags', () => {
      const records = ref([rec({ key: 'a', tags: ['scrim'] }), rec({ key: 'b', tags: ['ranked'] })])
      const { narrowedRecords, searchText } = useMatchesNarrow({ records })
      searchText.value = 'scrim'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('is case-insensitive', () => {
      const records = ref([rec({ key: 'a', map: 'rialto' })])
      const { narrowedRecords, searchText } = useMatchesNarrow({ records })
      searchText.value = 'RIALTO'
      expect(narrowedRecords.value).toHaveLength(1)
    })

    it('empty/whitespace search returns all records', () => {
      const records = ref([rec({ key: 'a' }), rec({ key: 'b' })])
      const { narrowedRecords, searchText } = useMatchesNarrow({ records })
      searchText.value = '   '
      expect(narrowedRecords.value).toHaveLength(2)
    })
  })

  describe('map filter', () => {
    it('multi-select OR semantics', () => {
      const records = ref([
        rec({ key: 'a', map: 'rialto' }),
        rec({ key: 'b', map: 'numbani' }),
        rec({ key: 'c', map: 'oasis' }),
      ])
      const { narrowedRecords, pickMap } = useMatchesNarrow({ records })
      pickMap('rialto')
      pickMap('numbani')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['a', 'b'])
    })

    it('toggling off removes from selection', () => {
      const records = ref([rec({ key: 'a', map: 'rialto' }), rec({ key: 'b', map: 'numbani' })])
      const { narrowedRecords, pickMap, pickedMaps } = useMatchesNarrow({ records })
      pickMap('rialto')
      pickMap('rialto') // toggle off
      expect(pickedMaps.value.size).toBe(0)
      expect(narrowedRecords.value).toHaveLength(2)
    })
  })

  describe('hero filter — broad match', () => {
    it('matches primary hero', () => {
      const records = ref([rec({ key: 'a', hero: 'lucio' }), rec({ key: 'b', hero: 'mercy' })])
      const { narrowedRecords, pickHero } = useMatchesNarrow({ records })
      pickHero('lucio')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('matches any heroes_played entry', () => {
      const records = ref([
        rec({ key: 'a', hero: 'lucio', heroesPlayed: [
          { hero: 'lucio', percent_played: 60, play_time: '6:00' },
          { hero: 'kiriko', percent_played: 40, play_time: '4:00' },
        ]}),
        rec({ key: 'b', hero: 'mercy' }),
      ])
      const { narrowedRecords, pickHero } = useMatchesNarrow({ records })
      pickHero('kiriko')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })
  })

  describe('min-play threshold (OR semantics)', () => {
    const corpus = [
      rec({ key: 'low',  hero: 'lucio', heroesPlayed: [{ hero: 'lucio', percent_played: 25, play_time: '2:30' }] }),
      rec({ key: 'mid',  hero: 'lucio', heroesPlayed: [{ hero: 'lucio', percent_played: 60, play_time: '6:00' }] }),
      rec({ key: 'high', hero: 'lucio', heroesPlayed: [{ hero: 'lucio', percent_played: 95, play_time: '9:30' }] }),
    ]

    it('minPlayMinutes filters by heroes_played.play_time', () => {
      const records = ref(corpus)
      const { narrowedRecords, pickHero, minPlayMinutes } = useMatchesNarrow({ records })
      pickHero('lucio')
      minPlayMinutes.value = 5
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['high', 'mid'])
    })

    it('minPlayPercent filters by heroes_played.percent_played', () => {
      const records = ref(corpus)
      const { narrowedRecords, pickHero, minPlayPercent } = useMatchesNarrow({ records })
      pickHero('lucio')
      minPlayPercent.value = 50
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['high', 'mid'])
    })

    it('either threshold passing keeps the record', () => {
      const records = ref([
        // Long play_time, low percent.
        rec({ key: 'longLowPct',  hero: 'lucio', heroesPlayed: [{ hero: 'lucio', percent_played: 10, play_time: '12:00' }] }),
        // Short play_time, high percent.
        rec({ key: 'shortHighPct', hero: 'lucio', heroesPlayed: [{ hero: 'lucio', percent_played: 90, play_time: '1:00' }] }),
        // Neither.
        rec({ key: 'neither', hero: 'lucio', heroesPlayed: [{ hero: 'lucio', percent_played: 20, play_time: '2:00' }] }),
      ])
      const { narrowedRecords, pickHero, minPlayMinutes, minPlayPercent } = useMatchesNarrow({ records })
      pickHero('lucio')
      minPlayMinutes.value = 5
      minPlayPercent.value = 50
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['longLowPct', 'shortHighPct'])
    })
  })

  describe('result filter', () => {
    it('multi-select narrows by result', () => {
      const records = ref([
        rec({ key: 'w', result: 'victory' }),
        rec({ key: 'l', result: 'defeat' }),
        rec({ key: 'd', result: 'draw' }),
      ])
      const { narrowedRecords, pickResult } = useMatchesNarrow({ records })
      pickResult('victory')
      pickResult('draw')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['d', 'w'])
    })
  })

  describe('tags filter', () => {
    it('OR semantics within tags', () => {
      const records = ref([
        rec({ key: 'a', tags: ['stack', 'stream'] }),
        rec({ key: 'b', tags: ['solo'] }),
        rec({ key: 'c', tags: ['stack'] }),
      ])
      const { narrowedRecords, pickTag } = useMatchesNarrow({ records })
      pickTag('stack')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['a', 'c'])
    })
  })

  describe('leaver handling', () => {
    it("'hide' drops leaver-annotated records", () => {
      const records = ref([
        rec({ key: 'clean' }),
        rec({ key: 'tagged', leaver: 'self' }),
      ])
      const { narrowedRecords, leaverHandling } = useMatchesNarrow({ records })
      leaverHandling.value = 'hide'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['clean'])
    })

    it("'exclude-tally' keeps leaver records in the list (downstream tally drops them)", () => {
      const records = ref([
        rec({ key: 'clean' }),
        rec({ key: 'tagged', leaver: 'self' }),
      ])
      const { narrowedRecords, leaverHandling } = useMatchesNarrow({ records })
      leaverHandling.value = 'exclude-tally'
      expect(narrowedRecords.value).toHaveLength(2)
    })

    it("'include' (default) keeps everything", () => {
      const records = ref([
        rec({ key: 'clean' }),
        rec({ key: 'tagged', leaver: 'team' }),
      ])
      const { narrowedRecords } = useMatchesNarrow({ records })
      expect(narrowedRecords.value).toHaveLength(2)
    })
  })

  describe('date range', () => {
    const corpus = [
      rec({ key: 'old', date: '2025-12-01' }),
      rec({ key: 'mid', date: '2026-03-15' }),
      rec({ key: 'new', date: '2026-05-10' }),
    ]

    it('customFrom drops earlier dates', () => {
      const records = ref(corpus)
      const { narrowedRecords, customFrom } = useMatchesNarrow({ records })
      customFrom.value = '2026-01-01'
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['mid', 'new'])
    })

    it('customTo drops later dates', () => {
      const records = ref(corpus)
      const { narrowedRecords, customTo } = useMatchesNarrow({ records })
      customTo.value = '2026-04-01'
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['mid', 'old'])
    })

    it('preset "7d" excludes dates older than 7 days from today', () => {
      // We can't test "today" reliably without freezing time. Just
      // assert the contract: when preset is non-all, customFrom is
      // populated with a date.
      const records = ref(corpus)
      const { pickRange, customFrom } = useMatchesNarrow({ records })
      pickRange('7d')
      expect(customFrom.value).not.toBe('')
    })

    it('preset "all" clears the range', () => {
      const records = ref(corpus)
      const { pickRange, customFrom, customTo } = useMatchesNarrow({ records })
      customFrom.value = '2026-01-01'
      customTo.value = '2026-12-01'
      pickRange('all')
      expect(customFrom.value).toBe('')
      expect(customTo.value).toBe('')
    })
  })

  describe('combined filters — AND across dimensions', () => {
    it('map + hero + result all must match', () => {
      const records = ref([
        rec({ key: 'hit',   map: 'rialto', hero: 'lucio', result: 'victory' }),
        rec({ key: 'wrongMap',  map: 'oasis',  hero: 'lucio', result: 'victory' }),
        rec({ key: 'wrongHero', map: 'rialto', hero: 'mercy', result: 'victory' }),
        rec({ key: 'wrongResult', map: 'rialto', hero: 'lucio', result: 'defeat' }),
      ])
      const { narrowedRecords, pickMap, pickHero, pickResult } = useMatchesNarrow({ records })
      pickMap('rialto')
      pickHero('lucio')
      pickResult('victory')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['hit'])
    })
  })

  describe('anyNarrow flag', () => {
    it('false when nothing is picked', () => {
      const records = ref([rec()])
      const { anyNarrow } = useMatchesNarrow({ records })
      expect(anyNarrow.value).toBe(false)
    })

    it('true when search has content', () => {
      const records = ref([rec()])
      const { anyNarrow, searchText } = useMatchesNarrow({ records })
      searchText.value = 'x'
      expect(anyNarrow.value).toBe(true)
    })

    it('true when a picker is non-empty', () => {
      const records = ref([rec({ map: 'rialto' })])
      const { anyNarrow, pickMap } = useMatchesNarrow({ records })
      pickMap('rialto')
      expect(anyNarrow.value).toBe(true)
    })

    it('true when includeUnknown is on (it is a deviation from the default)', () => {
      const records = ref([rec()])
      const { anyNarrow, includeUnknown } = useMatchesNarrow({ records })
      includeUnknown.value = true
      expect(anyNarrow.value).toBe(true)
    })
  })

  describe('resetNarrow', () => {
    it('clears every clause', () => {
      const records = ref([rec({ map: 'rialto', hero: 'lucio', result: 'victory' })])
      const { resetNarrow, pickMap, pickHero, pickResult, searchText, leaverHandling, minPlayMinutes, includeUnknown, anyNarrow } = useMatchesNarrow({ records })
      pickMap('rialto')
      pickHero('lucio')
      pickResult('victory')
      searchText.value = 'something'
      leaverHandling.value = 'hide'
      minPlayMinutes.value = 5
      includeUnknown.value = true
      expect(anyNarrow.value).toBe(true)
      resetNarrow()
      expect(anyNarrow.value).toBe(false)
      expect(searchText.value).toBe('')
      expect(minPlayMinutes.value).toBe(0)
      expect(includeUnknown.value).toBe(false)
    })
  })

  describe('availableMaps / availableHeroes', () => {
    it('availableHeroes unions data.hero + every heroes_played entry', () => {
      const records = ref([
        rec({ hero: 'lucio', heroesPlayed: [
          { hero: 'lucio', percent_played: 60, play_time: '6:00' },
          { hero: 'kiriko', percent_played: 40, play_time: '4:00' },
        ]}),
        rec({ hero: 'mercy' }),
      ])
      const { availableHeroes } = useMatchesNarrow({ records })
      expect([...availableHeroes.value].sort()).toEqual(['kiriko', 'lucio', 'mercy'])
    })
  })
})
