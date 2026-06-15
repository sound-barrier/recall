import { describe, it, expect } from 'vitest'
import { computed, ref } from 'vue'
import type { MatchRecord } from '@/api'
import { useMatchesNarrow, createMatchesNarrowState } from '@/composables/matches/useMatchesNarrow'

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
  parsedAt?: string
  tags?: string[]
  leaver?: '' | 'self' | 'team' | 'enemy'
  note?: string
  members?: string[]
  replay?: string
  reviewedBy?: 'self' | 'coach'
  source?: 'ocr' | 'ocr_edited' | 'manual'
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
    ...(opts.tags || opts.leaver || opts.note || opts.members || opts.replay
      ? { annotation: {
        tags: opts.tags ?? [], leaver: opts.leaver ?? '', note: opts.note ?? '',
        members: opts.members ?? [], replay_code: opts.replay ?? '',
      } }
      : {}),
    ...(opts.reviewedBy ? { reviewed_by: opts.reviewedBy } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    parsed_at: opts.parsedAt ?? `${opts.date ?? '2026-05-10'}T${opts.finishedAt ?? '14:00'}:00Z`,
  } as unknown as MatchRecord
}

describe('useMatchesNarrow', () => {
  describe('defaults', () => {
    it('returns all records (minus unknown-map) when no narrow is active', () => {
      const records = ref([rec({ key: 'a' }), rec({ key: 'b' })])
      const { narrowedRecords, anyNarrow } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(anyNarrow.value).toBe(false)
      expect(narrowedRecords.value).toHaveLength(2)
    })

    it('hides unknown-map records by default', () => {
      const records = ref([rec({ key: 'mapped' }), rec({ key: 'unmapped', map: null })])
      const { narrowedRecords } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['mapped'])
    })

    it('includeUnknown=true surfaces unknown-map records', () => {
      const records = ref([rec({ key: 'mapped' }), rec({ key: 'unmapped', map: null })])
      const { narrowedRecords, includeUnknown } = useMatchesNarrow(records, createMatchesNarrowState())
      includeUnknown.value = true
      expect(narrowedRecords.value).toHaveLength(2)
    })

    it('drops soft-deleted (hidden=true) records unconditionally', () => {
      const records = ref([
        rec({ key: 'visible' }),
        { ...rec({ key: 'gone' }), hidden: true } as MatchRecord,
      ])
      const { narrowedRecords } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['visible'])
    })
  })

  describe('free-text search', () => {
    it('matches map name', () => {
      const records = ref([rec({ key: 'a', map: 'rialto' }), rec({ key: 'b', map: 'numbani' })])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'numbani'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['b'])
    })

    it('matches primary hero', () => {
      const records = ref([rec({ key: 'a', hero: 'lucio' }), rec({ key: 'b', hero: 'mercy' })])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
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
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'kiriko'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('matches annotation note', () => {
      const records = ref([
        rec({ key: 'a', note: 'huge clutch hold' }),
        rec({ key: 'b', note: 'rolled them' }),
      ])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'clutch'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('matches annotation tags', () => {
      const records = ref([rec({ key: 'a', tags: ['scrim'] }), rec({ key: 'b', tags: ['ranked'] })])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'scrim'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('is case-insensitive', () => {
      const records = ref([rec({ key: 'a', map: 'rialto' })])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'RIALTO'
      expect(narrowedRecords.value).toHaveLength(1)
    })

    it('empty/whitespace search returns all records', () => {
      const records = ref([rec({ key: 'a' }), rec({ key: 'b' })])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = '   '
      expect(narrowedRecords.value).toHaveLength(2)
    })
  })

  describe('scoped-clause search', () => {
    it('note: matches only the annotation note, not the broad blob', () => {
      const records = ref([
        rec({ key: 'note-hit', note: 'rialto angles were rough' }),
        rec({ key: 'map-hit', map: 'rialto' }),
      ])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'note:rialto'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['note-hit'])
    })

    it('tag: matches only the tag surface', () => {
      const records = ref([rec({ key: 'a', tags: ['stack'] }), rec({ key: 'b', tags: ['solo'] })])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'tag:stack'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('member: matches group members, case-insensitively', () => {
      const records = ref([rec({ key: 'a', members: ['Apollo#1234'] }), rec({ key: 'b', members: ['Zen#9'] })])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'member:apollo'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('replay: matches the replay code, case-insensitively', () => {
      const records = ref([rec({ key: 'a', replay: '7H1XYZ' }), rec({ key: 'b', replay: 'ABC123' })])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'replay:7h1'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('a bare token still spans the broad blob, now incl. members + replay', () => {
      const records = ref([
        rec({ key: 'via-member', members: ['Apollo#1'] }),
        rec({ key: 'via-replay', replay: 'ZZZ9' }),
        rec({ key: 'neither', hero: 'mercy' }),
      ])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'apollo'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['via-member'])
    })

    it('multiple clauses AND together', () => {
      const records = ref([
        rec({ key: 'both', note: 'rialto', tags: ['stack'] }),
        rec({ key: 'note-only', note: 'rialto' }),
      ])
      const { narrowedRecords, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'note:rialto tag:stack'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['both'])
    })
  })

  describe('map filter', () => {
    it('multi-select OR semantics', () => {
      const records = ref([
        rec({ key: 'a', map: 'rialto' }),
        rec({ key: 'b', map: 'numbani' }),
        rec({ key: 'c', map: 'oasis' }),
      ])
      const { narrowedRecords, pickMap } = useMatchesNarrow(records, createMatchesNarrowState())
      pickMap('rialto')
      pickMap('numbani')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['a', 'b'])
    })

    it('toggling off removes from selection', () => {
      const records = ref([rec({ key: 'a', map: 'rialto' }), rec({ key: 'b', map: 'numbani' })])
      const { narrowedRecords, pickMap, pickedMaps } = useMatchesNarrow(records, createMatchesNarrowState())
      pickMap('rialto')
      pickMap('rialto') // toggle off
      expect(pickedMaps.value.size).toBe(0)
      expect(narrowedRecords.value).toHaveLength(2)
    })
  })

  describe('hero filter — broad match', () => {
    it('matches primary hero', () => {
      const records = ref([rec({ key: 'a', hero: 'lucio' }), rec({ key: 'b', hero: 'mercy' })])
      const { narrowedRecords, pickHero } = useMatchesNarrow(records, createMatchesNarrowState())
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
      const { narrowedRecords, pickHero } = useMatchesNarrow(records, createMatchesNarrowState())
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
      const { narrowedRecords, pickHero, minPlayMinutes } = useMatchesNarrow(records, createMatchesNarrowState())
      pickHero('lucio')
      minPlayMinutes.value = 5
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['high', 'mid'])
    })

    it('minPlayPercent filters by heroes_played.percent_played', () => {
      const records = ref(corpus)
      const { narrowedRecords, pickHero, minPlayPercent } = useMatchesNarrow(records, createMatchesNarrowState())
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
      const { narrowedRecords, pickHero, minPlayMinutes, minPlayPercent } = useMatchesNarrow(records, createMatchesNarrowState())
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
      const { narrowedRecords, pickResult } = useMatchesNarrow(records, createMatchesNarrowState())
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
      const { narrowedRecords, pickTag } = useMatchesNarrow(records, createMatchesNarrowState())
      pickTag('stack')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['a', 'c'])
    })
  })

  describe('members filter', () => {
    it('AND semantics — only games with EVERY picked teammate (the stack)', () => {
      const records = ref([
        rec({ key: 'a', members: ['Alice', 'Bob'] }),
        rec({ key: 'b', members: ['Alice'] }),
        rec({ key: 'c', members: ['Bob'] }),
        rec({ key: 'd', members: [] }),
      ])
      const { narrowedRecords, pickMember } = useMatchesNarrow(records, createMatchesNarrowState())
      pickMember('Alice')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['a', 'b'])
      pickMember('Bob')
      // Intersection: only 'a' has BOTH Alice and Bob.
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['a'])
    })

    it('availableMembers is the sorted union across the corpus', () => {
      const records = ref([
        rec({ key: 'a', members: ['Bob', 'Alice'] }),
        rec({ key: 'b', members: ['Alice', 'Cara'] }),
      ])
      const { availableMembers } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(availableMembers.value).toEqual(['Alice', 'Bob', 'Cara'])
    })
  })

  describe('leaver handling', () => {
    it("'hide' drops leaver-annotated records", () => {
      const records = ref([
        rec({ key: 'clean' }),
        rec({ key: 'tagged', leaver: 'self' }),
      ])
      const { narrowedRecords, leaverHandling } = useMatchesNarrow(records, createMatchesNarrowState())
      leaverHandling.value = 'hide'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['clean'])
    })

    it("'exclude-tally' keeps leaver records in the list (downstream tally drops them)", () => {
      const records = ref([
        rec({ key: 'clean' }),
        rec({ key: 'tagged', leaver: 'self' }),
      ])
      const { narrowedRecords, leaverHandling } = useMatchesNarrow(records, createMatchesNarrowState())
      leaverHandling.value = 'exclude-tally'
      expect(narrowedRecords.value).toHaveLength(2)
    })

    it("'include' (default) keeps everything", () => {
      const records = ref([
        rec({ key: 'clean' }),
        rec({ key: 'tagged', leaver: 'team' }),
      ])
      const { narrowedRecords } = useMatchesNarrow(records, createMatchesNarrowState())
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
      const { narrowedRecords, customFrom } = useMatchesNarrow(records, createMatchesNarrowState())
      customFrom.value = '2026-01-01'
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['mid', 'new'])
    })

    it('customTo drops later dates', () => {
      const records = ref(corpus)
      const { narrowedRecords, customTo } = useMatchesNarrow(records, createMatchesNarrowState())
      customTo.value = '2026-04-01'
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['mid', 'old'])
    })

    it('preset "7d" excludes dates older than 7 days from today', () => {
      // We can't test "today" reliably without freezing time. Just
      // assert the contract: when preset is non-all, customFrom is
      // populated with a date.
      const records = ref(corpus)
      const { pickRange, customFrom } = useMatchesNarrow(records, createMatchesNarrowState())
      pickRange('7d')
      expect(customFrom.value).not.toBe('')
    })

    it('preset "all" clears the range', () => {
      const records = ref(corpus)
      const { pickRange, customFrom, customTo } = useMatchesNarrow(records, createMatchesNarrowState())
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
      const { narrowedRecords, pickMap, pickHero, pickResult } = useMatchesNarrow(records, createMatchesNarrowState())
      pickMap('rialto')
      pickHero('lucio')
      pickResult('victory')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['hit'])
    })
  })

  describe('anyNarrow flag', () => {
    it('false when nothing is picked', () => {
      const records = ref([rec()])
      const { anyNarrow } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(anyNarrow.value).toBe(false)
    })

    it('true when search has content', () => {
      const records = ref([rec()])
      const { anyNarrow, searchText } = useMatchesNarrow(records, createMatchesNarrowState())
      searchText.value = 'x'
      expect(anyNarrow.value).toBe(true)
    })

    it('true when a picker is non-empty', () => {
      const records = ref([rec({ map: 'rialto' })])
      const { anyNarrow, pickMap } = useMatchesNarrow(records, createMatchesNarrowState())
      pickMap('rialto')
      expect(anyNarrow.value).toBe(true)
    })

    it('true when includeUnknown is on (it is a deviation from the default)', () => {
      const records = ref([rec()])
      const { anyNarrow, includeUnknown } = useMatchesNarrow(records, createMatchesNarrowState())
      includeUnknown.value = true
      expect(anyNarrow.value).toBe(true)
    })
  })

  describe('resetNarrow', () => {
    it('clears every clause', () => {
      const records = ref([rec({ map: 'rialto', hero: 'lucio', result: 'victory' })])
      const { resetNarrow, pickMap, pickHero, pickResult, searchText, leaverHandling, minPlayMinutes, includeUnknown, anyNarrow } = useMatchesNarrow(records, createMatchesNarrowState())
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
      const { availableHeroes } = useMatchesNarrow(records, createMatchesNarrowState())
      expect([...availableHeroes.value].sort()).toEqual(['kiriko', 'lucio', 'mercy'])
    })
  })

  describe('reviewed-by filter', () => {
    function corpus() {
      return ref([
        rec({ key: 'self-1',       reviewedBy: 'self' }),
        rec({ key: 'self-2',       reviewedBy: 'self' }),
        rec({ key: 'coach-1',      reviewedBy: 'coach' }),
        rec({ key: 'unreviewed-1' }),
        rec({ key: 'unreviewed-2' }),
      ])
    }

    it('empty picked set means no filter — every record passes', () => {
      const records = corpus()
      const { narrowedRecords } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(
        ['coach-1', 'self-1', 'self-2', 'unreviewed-1', 'unreviewed-2'],
      )
    })

    it('picking "self" includes only self-reviewed records', () => {
      const records = corpus()
      const { narrowedRecords, pickReviewedBy } = useMatchesNarrow(records, createMatchesNarrowState())
      pickReviewedBy('self')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['self-1', 'self-2'])
    })

    it('picking "coach" includes only coach-reviewed records', () => {
      const records = corpus()
      const { narrowedRecords, pickReviewedBy } = useMatchesNarrow(records, createMatchesNarrowState())
      pickReviewedBy('coach')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['coach-1'])
    })

    it('picking "unreviewed" includes only records with no reviewed_by', () => {
      const records = corpus()
      const { narrowedRecords, pickReviewedBy } = useMatchesNarrow(records, createMatchesNarrowState())
      pickReviewedBy('unreviewed')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['unreviewed-1', 'unreviewed-2'])
    })

    it('picking "self" + "coach" is an OR — surfaces any reviewed record', () => {
      const records = corpus()
      const { narrowedRecords, pickReviewedBy } = useMatchesNarrow(records, createMatchesNarrowState())
      pickReviewedBy('self')
      pickReviewedBy('coach')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['coach-1', 'self-1', 'self-2'])
    })

    it('anyNarrow flips on once a reviewed-by chip is picked', () => {
      const records = corpus()
      const { anyNarrow, pickReviewedBy } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(anyNarrow.value).toBe(false)
      pickReviewedBy('self')
      expect(anyNarrow.value).toBe(true)
    })

    it('resetNarrow clears the reviewed-by picks', () => {
      const records = corpus()
      const { pickReviewedBy, pickedReviewedBy, resetNarrow } = useMatchesNarrow(records, createMatchesNarrowState())
      pickReviewedBy('self')
      pickReviewedBy('coach')
      expect(pickedReviewedBy.value.size).toBe(2)
      resetNarrow()
      expect(pickedReviewedBy.value.size).toBe(0)
    })
  })

  describe('provenance filter', () => {
    function corpus() {
      return ref([
        rec({ key: 'ocr-1' }),
        rec({ key: 'ocr-2' }),
        rec({ key: 'edited-1', source: 'ocr_edited' }),
        rec({ key: 'manual-1', source: 'manual' }),
        rec({ key: 'manual-2', source: 'manual' }),
      ])
    }

    it('empty picked set means no filter — every record passes', () => {
      const records = corpus()
      const { narrowedRecords } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(
        ['edited-1', 'manual-1', 'manual-2', 'ocr-1', 'ocr-2'],
      )
    })

    it('picking "ocr_edited" includes only edited records and drops pure OCR', () => {
      const records = corpus()
      const { narrowedRecords, pickSource } = useMatchesNarrow(records, createMatchesNarrowState())
      pickSource('ocr_edited')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['edited-1'])
    })

    it('picking "manual" includes only hand-entered records', () => {
      const records = corpus()
      const { narrowedRecords, pickSource } = useMatchesNarrow(records, createMatchesNarrowState())
      pickSource('manual')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['manual-1', 'manual-2'])
    })

    it('picking "ocr_edited" + "manual" is an OR — every touched record, no pure OCR', () => {
      const records = corpus()
      const { narrowedRecords, pickSource } = useMatchesNarrow(records, createMatchesNarrowState())
      pickSource('ocr_edited')
      pickSource('manual')
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['edited-1', 'manual-1', 'manual-2'])
    })

    it('a record with no source field falls back to the OCR bucket and drops out', () => {
      const records = corpus()
      const { narrowedRecords, pickSource } = useMatchesNarrow(records, createMatchesNarrowState())
      pickSource('manual')
      expect(narrowedRecords.value.some((r) => r.match_key === 'ocr-1')).toBe(false)
    })

    it('anyNarrow flips on once a provenance chip is picked', () => {
      const records = corpus()
      const { anyNarrow, pickSource } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(anyNarrow.value).toBe(false)
      pickSource('manual')
      expect(anyNarrow.value).toBe(true)
    })

    it('resetNarrow clears the provenance picks', () => {
      const records = corpus()
      const { pickSource, pickedSources, resetNarrow } = useMatchesNarrow(records, createMatchesNarrowState())
      pickSource('ocr_edited')
      pickSource('manual')
      expect(pickedSources.value.size).toBe(2)
      resetNarrow()
      expect(pickedSources.value.size).toBe(0)
    })
  })

  describe('since-anchor filter', () => {
    function corpus() {
      // Five matches across five consecutive days. Anchor is the
      // middle one (day 3); the contract is "strictly after anchor."
      return ref([
        rec({ key: 'd1', parsedAt: '2026-05-01T12:00:00Z' }),
        rec({ key: 'd2', parsedAt: '2026-05-02T12:00:00Z' }),
        rec({ key: 'd3', parsedAt: '2026-05-03T12:00:00Z' }),
        rec({ key: 'd4', parsedAt: '2026-05-04T12:00:00Z' }),
        rec({ key: 'd5', parsedAt: '2026-05-05T12:00:00Z' }),
      ])
    }

    it('a set anchor key with sinceAnchorActive=false does not filter', () => {
      const records = corpus()
      const anchorRef = ref('d3')
      const anchorKey = computed(() => anchorRef.value)
      const state = createMatchesNarrowState({ anchorKey })
      const { narrowedRecords } = useMatchesNarrow(records, state)
      expect(narrowedRecords.value).toHaveLength(5)
    })

    it('sinceAnchorActive=true with a set anchor drops records on or before the anchor', () => {
      const records = corpus()
      const anchorRef = ref('d3')
      const anchorKey = computed(() => anchorRef.value)
      const state = createMatchesNarrowState({ anchorKey })
      state.sinceAnchorActive.value = true
      const { narrowedRecords } = useMatchesNarrow(records, state)
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['d4', 'd5'])
    })

    it('sinceAnchorActive=true with NO anchor key set is a no-op (rendered safely)', () => {
      const records = corpus()
      const anchorRef = ref('')
      const anchorKey = computed(() => anchorRef.value)
      const state = createMatchesNarrowState({ anchorKey })
      state.sinceAnchorActive.value = true
      const { narrowedRecords } = useMatchesNarrow(records, state)
      expect(narrowedRecords.value).toHaveLength(5)
    })

    it('sinceAnchorActive=true with anchor key pointing at a deleted match is a no-op', () => {
      const records = corpus()
      const anchorRef = ref('does-not-exist')
      const anchorKey = computed(() => anchorRef.value)
      const state = createMatchesNarrowState({ anchorKey })
      state.sinceAnchorActive.value = true
      const { narrowedRecords } = useMatchesNarrow(records, state)
      expect(narrowedRecords.value).toHaveLength(5)
    })

    it('anyNarrow flips on when sinceAnchorActive is true AND an anchor is set', () => {
      const records = corpus()
      const anchorRef = ref('d3')
      const anchorKey = computed(() => anchorRef.value)
      const state = createMatchesNarrowState({ anchorKey })
      const { anyNarrow } = useMatchesNarrow(records, state)
      expect(anyNarrow.value).toBe(false)
      state.sinceAnchorActive.value = true
      expect(anyNarrow.value).toBe(true)
    })

    it('resetNarrow turns sinceAnchorActive off but leaves the anchorKey alone', () => {
      const records = corpus()
      const anchorRef = ref('d3')
      const anchorKey = computed(() => anchorRef.value)
      const state = createMatchesNarrowState({ anchorKey })
      state.sinceAnchorActive.value = true
      const { resetNarrow } = useMatchesNarrow(records, state)
      resetNarrow()
      expect(state.sinceAnchorActive.value).toBe(false)
      // anchorKey survives — it's owned by the useMatchAnchor singleton,
      // not by the narrow-panel reset.
      expect(anchorRef.value).toBe('d3')
    })
  })
})
