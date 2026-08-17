import { describe, it, expect } from 'vitest'
import { computed, ref } from 'vue'
import type { MatchRecord } from '@/api'
import { useMatchesNarrow, createMatchesNarrowState } from '@/composables/matches/narrow/useMatchesNarrow'

// undefined → the default map; null → no map field at all (an unknown-map row).
function mapField(map: string | null | undefined): { map?: string } {
  if (map === undefined) return { map: 'rialto' }
  if (map === null) return {}
  return { map }
}

interface RecOpts {
  key?: string
  map?: string | null
  hero?: string
  role?: string
  type?: string
  mode?: string
  gameMode?: string
  rank?: string
  modifiers?: string[]
  playedAtUTC?: string
  queueType?: 'role' | 'open'
  playMode?: 'quickplay' | 'competitive'
  result?: 'victory' | 'defeat' | 'draw'
  date?: string
  finishedAt?: string
  parsedAt?: string
  tags?: string[]
  leavers?: ('self' | 'team' | 'enemy')[]
  throwers?: ('self' | 'team' | 'enemy')[]
  note?: string
  members?: string[]
  replay?: string
  reviewedBy?: 'self' | 'coach'
  source?: 'ocr' | 'ocr_edited' | 'manual'
  heroesPlayed?: { hero: string; percent_played?: number; play_time?: string }[]
}

const REC_BASE = {
  hero: 'lucio',
  role: 'support',
  type: 'control',
  mode: 'competitive',
  result: 'victory',
  date: '2026-05-10',
  finishedAt: '14:00',
} as const

function wantsAnnotation(opts: RecOpts): boolean {
  return Boolean(opts.tags || opts.leavers?.length || opts.throwers?.length || opts.note || opts.members || opts.replay)
}

function annotationField(opts: RecOpts): Record<string, unknown> {
  if (!wantsAnnotation(opts)) return {}
  return { annotation: {
    tags: opts.tags ?? [], leavers: opts.leavers ?? [], throwers: opts.throwers ?? [], note: opts.note ?? '',
    members: opts.members ?? [], replay_code: opts.replay ?? '',
  } }
}

function rec(opts: RecOpts = {}): MatchRecord {
  const o = { ...REC_BASE, ...opts }
  return {
    match_key: o.key ?? `m-${Math.random()}`,
    source_files: ['a.png'],
    source_types: { 'a.png': 'summary' },
    data: {
      ...mapField(o.map),
      mode: o.mode,
      type: o.type,
      role: o.role,
      hero: o.hero,
      result: o.result,
      date: o.date,
      finished_at: o.finishedAt,
      game_mode: o.gameMode,
      rank: o.rank,
      modifiers: o.modifiers,
      played_at_utc: o.playedAtUTC,
      heroes_played: o.heroesPlayed ?? [{ hero: o.hero, percent_played: 100, play_time: '10:00' }],
    },
    ...annotationField(opts),
    ...(o.reviewedBy ? { reviewed_by: o.reviewedBy } : {}),
    ...(o.queueType ? { queue_type: o.queueType } : {}),
    ...(o.playMode ? { play_mode: o.playMode } : {}),
    ...(o.source ? { source: o.source } : {}),
    parsed_at: o.parsedAt ?? `${o.date}T${o.finishedAt}:00Z`,
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

  describe('smart-empty suggestions', () => {
    it('suggests lifting the unknown-map exclusion when it empties the set', () => {
      // Every record is unknown-map → the default exclusion empties the set.
      const records = ref([rec({ key: 'a', map: null }), rec({ key: 'b', map: null })])
      const { narrowedRecords, clauseExclusionCounts } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(narrowedRecords.value).toHaveLength(0)
      const s = clauseExclusionCounts.value.find((x) => x.clauseId === 'includeUnknown')
      expect(s?.wouldSurface).toBe(2)
      s?.clear() // lifting it (includeUnknown = true) surfaces them
      expect(narrowedRecords.value).toHaveLength(2)
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

    it("smart-empty 'remove min-play' keeps the hero picks in its count (no over-promise)", () => {
      // One lucio game below the threshold + one game WITHOUT lucio at all.
      const records = ref([
        rec({ key: 'a', heroesPlayed: [{ hero: 'lucio', percent_played: 100, play_time: '2:00' }] }),
        rec({ key: 'b', hero: 'ana', heroesPlayed: [{ hero: 'ana', percent_played: 100, play_time: '10:00' }] }),
      ])
      const { narrowedRecords, pickHero, minPlayMinutes, clauseExclusionCounts } =
        useMatchesNarrow(records, createMatchesNarrowState())
      pickHero('lucio')
      minPlayMinutes.value = 5
      expect(narrowedRecords.value).toHaveLength(0)

      const s = clauseExclusionCounts.value.find((x) => x.clauseId === 'minPlay')
      // Lifting the threshold surfaces the lucio game ONLY — the old fused
      // skip dropped the hero picks too and promised the ana game as well.
      expect(s?.wouldSurface).toBe(1)
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

  describe('thrower side filter', () => {
    // Independent of the leaver facet and of leaverHandling — a thrown match
    // still counts in the tally, so there is no thrower "handling" control.
    const corpus = () => ref([
      rec({ key: 'enemy-thrower', throwers: ['enemy'] }),
      rec({ key: 'team-thrower', throwers: ['team'] }),
      rec({ key: 'both-throwers', throwers: ['team', 'enemy'] }),
      rec({ key: 'leaver-only', leavers: ['team'] }),
      rec({ key: 'clean' }),
    ])

    it('scopes to the picked side, counting a both-teams match once', () => {
      const { narrowedRecords, pickThrower } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickThrower('enemy')
      expect(narrowedRecords.value.map(r => r.match_key)).toEqual(['enemy-thrower', 'both-throwers'])
    })

    it('ORs two picked sides', () => {
      const { narrowedRecords, pickThrower } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickThrower('enemy')
      pickThrower('team')
      expect(narrowedRecords.value).toHaveLength(3)
    })

    it('ignores a leaver-only match', () => {
      const { narrowedRecords, pickThrower } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickThrower('team')
      expect(narrowedRecords.value.map(r => r.match_key)).not.toContain('leaver-only')
    })

    it('only offers sides the corpus actually recorded', () => {
      const { availableThrowerSides } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      expect(availableThrowerSides.value).toEqual(['team', 'enemy'])
    })

    it('is cleared by resetNarrow', () => {
      const { anyNarrow, pickThrower, resetNarrow } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickThrower('enemy')
      expect(anyNarrow.value).toBe(true)
      resetNarrow()
      expect(anyNarrow.value).toBe(false)
    })
  })

  describe('leaver handling', () => {
    it("'hide' drops leaver-annotated records", () => {
      const records = ref([
        rec({ key: 'clean' }),
        rec({ key: 'tagged', leavers: ['self'] }),
      ])
      const { narrowedRecords, leaverHandling } = useMatchesNarrow(records, createMatchesNarrowState())
      leaverHandling.value = 'hide'
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['clean'])
    })

    it("'exclude-tally' keeps leaver records in the list (downstream tally drops them)", () => {
      const records = ref([
        rec({ key: 'clean' }),
        rec({ key: 'tagged', leavers: ['self'] }),
      ])
      const { narrowedRecords, leaverHandling } = useMatchesNarrow(records, createMatchesNarrowState())
      leaverHandling.value = 'exclude-tally'
      expect(narrowedRecords.value).toHaveLength(2)
    })

    it("'include' (default) keeps everything", () => {
      const records = ref([
        rec({ key: 'clean' }),
        rec({ key: 'tagged', leavers: ['team'] }),
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

    it('a from time narrows within the from day', () => {
      const day = [
        rec({ key: 'early', date: '2026-01-07', finishedAt: '09:00' }),
        rec({ key: 'edge', date: '2026-01-07', finishedAt: '10:59' }),
        rec({ key: 'patch', date: '2026-01-07', finishedAt: '11:00' }),
        rec({ key: 'late', date: '2026-01-07', finishedAt: '21:57' }),
      ]
      const records = ref(day)
      const { narrowedRecords, customFrom, customFromTime, pickedRange } =
        useMatchesNarrow(records, createMatchesNarrowState())
      customFrom.value = '2026-01-07'
      customFromTime.value = '11:00'
      pickedRange.value = 'custom'
      expect(narrowedRecords.value.map((r) => r.match_key).sort()).toEqual(['late', 'patch'])
    })

    it('pickRange clears the time bounds (presets and all)', () => {
      const records = ref(corpus)
      const { pickRange, customFromTime, customToTime } =
        useMatchesNarrow(records, createMatchesNarrowState())
      customFromTime.value = '11:00'
      customToTime.value = '10:59'
      pickRange('7d')
      expect(customFromTime.value).toBe('')
      expect(customToTime.value).toBe('')

      customFromTime.value = '11:00'
      pickRange('all')
      expect(customFromTime.value).toBe('')
    })

    it('resetNarrow clears the time bounds', () => {
      const records = ref(corpus)
      const { resetNarrow, customFromTime, customToTime } =
        useMatchesNarrow(records, createMatchesNarrowState())
      customFromTime.value = '11:00'
      customToTime.value = '10:59'
      resetNarrow()
      expect(customFromTime.value).toBe('')
      expect(customToTime.value).toBe('')
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

  describe('queue-type buckets', () => {
    function corpus() {
      return ref([
        rec({ key: 'role-q', queueType: 'role' }),
        rec({ key: 'open-q', queueType: 'open' }),
        rec({ key: 'unset' }),
      ])
    }

    it('isolates the unset slice so it can be bulk-corrected', () => {
      const { narrowedRecords, pickQueue } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickQueue('unknown')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['unset'])
    })

    it('ORs the two real buckets and leaves the unset rows out', () => {
      const { narrowedRecords, pickQueue } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickQueue('role')
      pickQueue('open')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['role-q', 'open-q'])
    })
  })

  describe('play-mode buckets', () => {
    function corpus() {
      return ref([
        rec({ key: 'comp', playMode: 'competitive' }),
        rec({ key: 'qp', playMode: 'quickplay' }),
        rec({ key: 'unset' }),
      ])
    }

    it('isolates the unset slice', () => {
      const { narrowedRecords, pickPlayMode } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickPlayMode('unknown')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['unset'])
    })

    it('narrows to a picked bucket and drops the rest', () => {
      const { narrowedRecords, pickPlayMode } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickPlayMode('competitive')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['comp'])
    })
  })

  describe('leaver side vs leaver handling', () => {
    // Two independent controls that happen to read the same annotation: the
    // FACET scopes the set, the HANDLING governs the W/L tally (and 'hide'
    // drops the rows outright). Composing them must not surprise.
    function corpus() {
      return ref([
        rec({ key: 'team-leaver', leavers: ['team'] }),
        rec({ key: 'enemy-leaver', leavers: ['enemy'] }),
        rec({ key: 'clean' }),
      ])
    }

    it('the facet scopes the set to the picked side', () => {
      const { narrowedRecords, pickLeaver } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickLeaver('team')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['team-leaver'])
    })

    it("'hide' handling and a side pick compose to nothing — they contradict", () => {
      const { narrowedRecords, pickLeaver, leaverHandling } =
        useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickLeaver('team')
      leaverHandling.value = 'hide'
      expect(narrowedRecords.value).toHaveLength(0)
    })

    it('only offers the sides the corpus recorded, in canonical order', () => {
      const { availableLeaverSides } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      expect(availableLeaverSides.value).toEqual(['team', 'enemy'])
    })
  })

  describe('modifier + rank facets', () => {
    function corpus() {
      return ref([
        rec({ key: 'rev', modifiers: ['reversal', 'victory'], rank: 'gold' }),
        rec({ key: 'exp', modifiers: ['expected'], rank: 'diamond' }),
        rec({ key: 'plain', rank: 'gold' }),
      ])
    }

    it('modifier picks OR together', () => {
      const { narrowedRecords, pickModifier } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickModifier('reversal')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['rev'])
      pickModifier('expected')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['rev', 'exp'])
    })

    it('rank picks isolate the tier', () => {
      const { narrowedRecords, pickRank } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickRank('gold')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['rev', 'plain'])
    })
  })

  describe('malformed rows', () => {
    it('never lets a record with no parsed data through the narrow', () => {
      const records = ref([
        rec({ key: 'ok' }),
        { match_key: 'dataless', source_files: ['x.png'] } as unknown as MatchRecord,
      ])
      const { narrowedRecords } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['ok'])
    })
  })

  describe('tag universe', () => {
    it('availableTags is the sorted union across the corpus, skipping blanks', () => {
      const records = ref([
        rec({ key: 'a', tags: ['stack', 'stream'] }),
        rec({ key: 'b', tags: ['solo', 'stack'] }),
        rec({ key: 'c' }),
      ])
      const { availableTags } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(availableTags.value).toEqual(['solo', 'stack', 'stream'])
    })
  })

  describe('pool-membership filter', () => {
    const pool = ['lucio', 'ana']
    function corpus() {
      return ref([
        rec({ key: 'pure', heroesPlayed: [{ hero: 'lucio', percent_played: 70 }, { hero: 'ana', percent_played: 30 }] }),
        rec({ key: 'off', heroesPlayed: [{ hero: 'lucio', percent_played: 60 }, { hero: 'mercy', percent_played: 40 }] }),
      ])
    }

    it('scopes to the picked side, and null lifts it again', () => {
      const { narrowedRecords, setPoolFilter, anyNarrow } =
        useMatchesNarrow(corpus(), createMatchesNarrowState())
      setPoolFilter({ side: 'pure', keys: pool, thresholdPct: 5 })
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['pure'])
      expect(anyNarrow.value).toBe(true)

      setPoolFilter({ side: 'off', keys: pool, thresholdPct: 5 })
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['off'])

      setPoolFilter(null)
      expect(narrowedRecords.value).toHaveLength(2)
      expect(anyNarrow.value).toBe(false)
    })

    it('is cleared by resetNarrow — it is transient, not a saved preset', () => {
      const { setPoolFilter, resetNarrow, anyNarrow } =
        useMatchesNarrow(corpus(), createMatchesNarrowState())
      setPoolFilter({ side: 'pure', keys: pool, thresholdPct: 5 })
      resetNarrow()
      expect(anyNarrow.value).toBe(false)
    })
  })

  describe('season picker', () => {
    it('re-picking the active season clears it (single-select toggle)', () => {
      const { pickSeason, pickedSeason } = useMatchesNarrow(ref([rec()]), createMatchesNarrowState())
      pickSeason('Season 2')
      expect(pickedSeason.value).toBe('Season 2')
      pickSeason('Season 3')
      expect(pickedSeason.value).toBe('Season 3')
      pickSeason('Season 3')
      expect(pickedSeason.value).toBe('')
    })
  })

  describe('available option universes', () => {
    it('availableRanks follows the tier ladder, not the alphabet', () => {
      const records = ref([
        rec({ rank: 'diamond' }), rec({ rank: 'bronze' }), rec({ rank: 'gold' }), rec({ rank: 'bronze' }),
      ])
      const { availableRanks } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(availableRanks.value).toEqual(['bronze', 'gold', 'diamond'])
    })

    it('availableModifiers keeps the canonical vocabulary in order, drops results, appends strays', () => {
      const records = ref([
        rec({ modifiers: ['victory', 'reversal', 'zz-unrecognized'] }),
        rec({ modifiers: ['expected', 'defeat'] }),
      ])
      const { availableModifiers } = useMatchesNarrow(records, createMatchesNarrowState())
      // victory/defeat live on the result filter; 'expected' precedes
      // 'reversal' in the canonical list; anything unknown sorts in last.
      expect(availableModifiers.value).toEqual(['expected', 'reversal', 'zz-unrecognized'])
    })

    it('availableGameModes is the sorted unique corpus set, skipping blanks', () => {
      const records = ref([
        rec({ gameMode: 'push' }), rec({ gameMode: 'control' }), rec({ gameMode: 'push' }), rec({}),
      ])
      const { availableGameModes } = useMatchesNarrow(records, createMatchesNarrowState())
      expect(availableGameModes.value).toEqual(['control', 'push'])
    })
  })

  describe('option universes tolerate malformed rows', () => {
    it('a record with no data or annotation contributes nothing and breaks nothing', () => {
      // These lists feed the panel's comboboxes and chip clouds — one
      // half-written row must not empty them or throw on render.
      const records = ref([
        rec({ key: 'ok', map: 'rialto', role: 'support', result: 'victory', gameMode: 'control', tags: ['scrim'], members: ['Alice'] }),
        { match_key: 'dataless', source_files: ['x.png'] } as unknown as MatchRecord,
      ])
      const n = useMatchesNarrow(records, createMatchesNarrowState())
      expect(n.availableMaps.value).toEqual(['rialto'])
      expect(n.availableHeroes.value).toEqual(['lucio'])
      expect(n.availableRoles.value).toEqual(['support'])
      expect(n.availableResults.value).toEqual(['victory'])
      expect(n.availableGameModes.value).toEqual(['control'])
      expect(n.availableTags.value).toEqual(['scrim'])
      expect(n.availableMembers.value).toEqual(['Alice'])
    })
  })

  describe('cross-band record sets (the narrow minus a band’s own dimensions)', () => {
    // A dossier band reads everything EXCEPT its own filter dimensions so it
    // reflects the OTHER bands' picks without collapsing from its own.
    function corpus() {
      return ref([
        rec({ key: 'hit',        map: 'rialto', role: 'tank',    hero: 'orisa', gameMode: 'control', result: 'victory' }),
        rec({ key: 'other-map',  map: 'oasis',  role: 'support', hero: 'ana',   gameMode: 'push',    result: 'victory' }),
        rec({ key: 'other-result', map: 'rialto', role: 'tank',  hero: 'orisa', gameMode: 'control', result: 'defeat' }),
      ])
    }

    it('the Geography band ignores its own map/role picks but honors the rest', () => {
      const { narrowedRecords, narrowedExceptMapsRoles, pickMap, pickRole, pickResult } =
        useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickMap('rialto')
      pickRole('tank')
      pickResult('victory')
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['hit'])
      // Map + role lifted, result still applied.
      expect(narrowedExceptMapsRoles.value.map((r) => r.match_key)).toEqual(['hit', 'other-map'])
    })

    it('the Hero × Game-Mode band ignores its own hero/game-mode picks but honors the rest', () => {
      const { narrowedExceptHeroesGameModes, pickHero, pickGameMode, pickResult } =
        useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickHero('orisa')
      pickGameMode('control')
      pickResult('victory')
      expect(narrowedExceptHeroesGameModes.value.map((r) => r.match_key)).toEqual(['hit', 'other-map'])
    })

    it('every cross-band set still drops soft-deleted rows', () => {
      const records = corpus()
      records.value = [...records.value, { ...rec({ key: 'gone', map: 'rialto' }), hidden: true } as MatchRecord]
      const { narrowedExceptMapsRoles, narrowedExceptSeason } =
        useMatchesNarrow(records, createMatchesNarrowState())
      expect(narrowedExceptMapsRoles.value.map((r) => r.match_key)).not.toContain('gone')
      expect(narrowedExceptSeason.value.map((r) => r.match_key)).not.toContain('gone')
    })
  })

  describe('preset vs hand-set ranges', () => {
    it("pickRange('custom') leaves the hand-set bounds alone", () => {
      const { pickRange, customFrom, customTo, customFromTime } =
        useMatchesNarrow(ref([rec()]), createMatchesNarrowState())
      customFrom.value = '2026-01-07'
      customTo.value = '2026-01-09'
      customFromTime.value = '11:00'
      pickRange('custom')
      expect(customFrom.value).toBe('2026-01-07')
      expect(customTo.value).toBe('2026-01-09')
      expect(customFromTime.value).toBe('11:00')
    })
  })

  describe('smart-empty suggestion ranking', () => {
    function corpus() {
      return ref([
        rec({ key: 'ana-rialto-1', map: 'rialto', hero: 'ana' }),
        rec({ key: 'ana-rialto-2', map: 'rialto', hero: 'ana' }),
        rec({ key: 'lucio-oasis',  map: 'oasis',  hero: 'lucio' }),
      ])
    }

    it('puts the most-restrictive clause first and labels each one', () => {
      const { narrowedRecords, clauseExclusionCounts, pickMap, pickHero } =
        useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickMap('oasis')
      pickHero('ana')
      expect(narrowedRecords.value).toHaveLength(0)

      // Lifting the map surfaces both ana games; lifting the hero surfaces
      // only the one oasis game — so the map suggestion leads.
      expect(clauseExclusionCounts.value.map((s) => [s.clauseId, s.label, s.wouldSurface])).toEqual([
        ['maps', 'map oasis', 2],
        ['heroes', 'hero ana', 1],
      ])
    })

    it('a single-click suggestion lifts exactly its own clause', () => {
      const { narrowedRecords, clauseExclusionCounts, pickMap, pickHero, pickedHeroes } =
        useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickMap('oasis')
      pickHero('ana')
      clauseExclusionCounts.value[0]!.clear()
      expect(narrowedRecords.value.map((r) => r.match_key)).toEqual(['ana-rialto-1', 'ana-rialto-2'])
      expect(pickedHeroes.value.has('ana')).toBe(true)
    })

    it('suggests nothing when no single lift would surface a record', () => {
      const { narrowedRecords, clauseExclusionCounts, pickMap, pickHero } =
        useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickMap('kings row')
      pickHero('winston')
      expect(narrowedRecords.value).toHaveLength(0)
      // Dropping either one still leaves zero — a suggestion would be a lie.
      expect(clauseExclusionCounts.value).toEqual([])
    })

    it('stays quiet while the set still has records', () => {
      const { clauseExclusionCounts, pickMap } = useMatchesNarrow(corpus(), createMatchesNarrowState())
      pickMap('rialto')
      expect(clauseExclusionCounts.value).toEqual([])
    })

    it('stays quiet on an empty corpus with nothing narrowing it', () => {
      // Nothing to lift — an empty DB must not be blamed on a filter.
      const { clauseExclusionCounts, narrowedRecords, includeUnknown } =
        useMatchesNarrow(ref([]), createMatchesNarrowState())
      includeUnknown.value = true // the only clause that restricts by default
      expect(narrowedRecords.value).toHaveLength(0)
      expect(clauseExclusionCounts.value).toEqual([])
    })
  })
})
