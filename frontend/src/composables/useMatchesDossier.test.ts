import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import type { MatchRecord } from '../api'
import type { WeekStart } from '../match-helpers'
import {
  useMatchesDossier,
  DEFAULT_BEST_WINRATE_HERO_MIN_MATCHES,
  DEFAULT_MOST_PLAYED_HERO_THRESHOLD,
  DEFAULT_RECENT_RESULTS_COUNT,
  DEFAULT_TIME_OF_DAY_BUCKET_COUNT,
  DEFAULT_TOP_BY_COUNT_LIMIT,
  DEFAULT_TOP_HEROES_LIMIT,
  type LeaverHandling,
} from './useMatchesDossier'

// PR B refactored useMatchesDossier from precomputed-refs to a mix
// of bedrock refs + parameterized query helpers. To keep the
// existing 90+ test cases readable instead of rewriting every
// assertion, `legacy` wraps the new API in the OLD precomputed-refs
// shape using the OLD defaults. Each call to dossier.<helper>(opts)
// returns a fresh ComputedRef; the wrapper opens each one once and
// hands the ref over. Tests added in PR C will hit the query-helper
// surface directly to verify non-default parameterizations.
function legacy(dossier: ReturnType<typeof useMatchesDossier>) {
  return {
    ...dossier,
    topMaps: dossier.topByCount({
      getter: (r) => r.data?.map,
      limit:  DEFAULT_TOP_BY_COUNT_LIMIT,
    }),
    topHeroes: dossier.topHeroesByMinutes({ limit: DEFAULT_TOP_HEROES_LIMIT }),
    mostPlayedHero: dossier.mostPlayedHero({
      minPercentPlayed: DEFAULT_MOST_PLAYED_HERO_THRESHOLD,
    }),
    bestWinrateHero: dossier.bestWinrateHero({
      minPercentPlayed: DEFAULT_MOST_PLAYED_HERO_THRESHOLD,
      minMatches:       DEFAULT_BEST_WINRATE_HERO_MIN_MATCHES,
    }),
    topMapTypes: dossier.topByCount({
      getter: (r) => r.data?.type,
      limit:  DEFAULT_TOP_BY_COUNT_LIMIT,
    }),
    timeOfDayBuckets: dossier.timeOfDayBuckets({ bucketCount: DEFAULT_TIME_OF_DAY_BUCKET_COUNT }),
    dayOfWeekBuckets: dossier.dayOfWeekBuckets(),
    recentResults:    dossier.recentResults({ count: DEFAULT_RECENT_RESULTS_COUNT }),
  }
}

function rec(opts: {
  key?: string
  result?: 'victory' | 'defeat' | 'draw'
  map?: string
  hero?: string
  leaver?: '' | 'self' | 'team' | 'enemy'
  reviewedBy?: 'self' | 'coach'
  reviewedAt?: string
  parsedAt?: string
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
    parsed_at: opts.parsedAt ?? '2026-05-10T14:00:00Z',
    ...(opts.reviewedBy ? { reviewed_by: opts.reviewedBy } : {}),
    ...(opts.reviewedAt ? { reviewed_at: opts.reviewedAt } : {}),
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
      const { wld } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(wld.value).toEqual({ w: 2, l: 1, d: 1, total: 4 })
    })

    it('counts records without a result as nothing', () => {
      const records = ref([rec({}), { ...rec({}), data: undefined } as unknown as MatchRecord])
      const { wld } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(wld.value.total).toBe(1)
    })

    it('returns zeros for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { wld } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
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
      const { winrate } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      // 2 wins / (2 wins + 1 loss) = 67%
      expect(winrate.value).toBe(67)
    })

    it('returns null when there are no wins or losses', () => {
      const records = ref([rec({ result: 'draw' }), rec({ result: 'draw' })])
      const { winrate } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(winrate.value).toBe(null)
    })

    it('returns null for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { winrate } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
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
      const { wld, winrate } = legacy(useMatchesDossier(records, handling))
      // The leaver-tagged loss is dropped from the tally → 1W / 1L.
      expect(wld.value).toEqual({ w: 1, l: 1, d: 0, total: 2 })
      expect(winrate.value).toBe(50)
    })

    it('include counts leaver-annotated records normally', () => {
      const records = ref([
        rec({ result: 'victory' }),
        rec({ result: 'defeat', leaver: 'team' }),
      ])
      const { wld } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
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
      const { topMaps } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topMaps.value.map((m) => m.key)).toEqual(['rialto', 'numbani', 'lijiang'])
      expect(topMaps.value[0]!.total).toBe(3)
    })

    it('caps at 5 entries', () => {
      const records = ref(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((m) => rec({ map: m })),
      )
      const { topMaps } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topMaps.value).toHaveLength(5)
    })

    it('skips records with empty map', () => {
      const records = ref([rec({ map: 'rialto' }), rec({ map: '' })])
      const { topMaps } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topMaps.value).toHaveLength(1)
    })

    it('reports per-map winrate', () => {
      const records = ref([
        rec({ map: 'rialto', result: 'victory' }),
        rec({ map: 'rialto', result: 'victory' }),
        rec({ map: 'rialto', result: 'defeat' }),
        rec({ map: 'rialto', result: 'defeat' }),
      ])
      const { topMaps } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topMaps.value[0]!.winrate).toBe(50)
    })

    it('reports share of the breakdown as integer percentage', () => {
      // Three records, three distinct maps — each map's share is 33.
      // Bug fix: the bar/percent column was previously bound to winrate,
      // which renders as wildly bimodal 0/100 for low-count maps.
      const records = ref([
        rec({ map: 'atlas',    result: 'victory' }),
        rec({ map: 'rialto',   result: 'defeat'  }),
        rec({ map: 'suravasa', result: 'victory' }),
      ])
      const { topMaps } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      for (const m of topMaps.value) {
        expect(m.share).toBe(33)
      }
    })

    it('share weights heavier counts more', () => {
      const records = ref([
        ...Array(6).fill(0).map(() => rec({ map: 'rialto' })),
        ...Array(3).fill(0).map(() => rec({ map: 'numbani' })),
        ...Array(1).fill(0).map(() => rec({ map: 'oasis' })),
      ])
      const { topMaps } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topMaps.value.find((m) => m.key === 'rialto')!.share).toBe(60)
      expect(topMaps.value.find((m) => m.key === 'numbani')!.share).toBe(30)
      expect(topMaps.value.find((m) => m.key === 'oasis')!.share).toBe(10)
    })

    it('share denominator is records-with-key, not total records', () => {
      // 4 dated matches: 2 on Rialto, 2 on Numbani. Plus 2 records
      // missing a map (unparseable). Rialto + Numbani each fill 50
      // % of the *map-carrying* records, not 25 % of the total.
      const records = ref([
        rec({ map: 'rialto' }),
        rec({ map: 'rialto' }),
        rec({ map: 'numbani' }),
        rec({ map: 'numbani' }),
        { ...rec({}), data: { ...rec({}).data, map: undefined } } as unknown as MatchRecord,
        { ...rec({}), data: { ...rec({}).data, map: undefined } } as unknown as MatchRecord,
      ])
      const { topMaps } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topMaps.value.find((m) => m.key === 'rialto')!.share).toBe(50)
      expect(topMaps.value.find((m) => m.key === 'numbani')!.share).toBe(50)
    })
  })

  describe('topHeroes', () => {
    // Ranking is by total play time across every `heroes_played[]`
    // entry, not by primary-hero match count. Capped at 3 for the
    // dossier's compact breakdown.
    function recWithHeroes(heroes: { hero: string; play_time: string }[], result: 'victory' | 'defeat' = 'victory'): MatchRecord {
      return {
        match_key: `m-${Math.random()}`,
        source_files: ['a.png'],
        source_types: { 'a.png': 'summary' },
        data: {
          map: 'rialto', hero: heroes[0]?.hero, mode: 'competitive',
          result, date: '2026-05-10', finished_at: '14:00',
          heroes_played: heroes.map(h => ({ hero: h.hero, play_time: h.play_time, percent_played: 0 })),
        },
        parsed_at: '2026-05-10T14:00:00Z',
      } as unknown as MatchRecord
    }

    it('orders by summed play_time across heroes_played, caps at 3', () => {
      const records = ref([
        recWithHeroes([
          { hero: 'lucio',  play_time: '11:25' }, // 11.42 min
        ]),
        recWithHeroes([
          { hero: 'juno',   play_time: '03:26' }, // 3.43 min
          { hero: 'wuyang', play_time: '03:30' }, // 3.5 min
          { hero: 'kiriko', play_time: '00:29' }, // 0.48 min
        ], 'defeat'),
        recWithHeroes([
          { hero: 'juno',   play_time: '08:00' }, // 8 min → juno now 11.43 total
        ]),
        recWithHeroes([
          { hero: 'mercy',  play_time: '02:00' }, // 2 min
        ]),
      ])
      const { topHeroes } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topHeroes.value).toHaveLength(3)
      expect(topHeroes.value.map((h) => h.key)).toEqual(['juno', 'lucio', 'wuyang'])
    })

    it('renders timeLabel in "XhYmin" / "Ymin" shape per entry', () => {
      const records = ref([
        recWithHeroes([{ hero: 'lucio', play_time: '11:25' }]), // 11min
        recWithHeroes([{ hero: 'mercy', play_time: '02:00' }]), // 2min
      ])
      const { topHeroes } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topHeroes.value[0]).toMatchObject({ key: 'lucio', timeLabel: '11min' })
      expect(topHeroes.value[1]).toMatchObject({ key: 'mercy', timeLabel: '2min' })
    })

    it('share is a percentage of total time across all heroes', () => {
      const records = ref([
        recWithHeroes([
          { hero: 'lucio', play_time: '30:00' }, // 30 min → 75%
          { hero: 'mercy', play_time: '10:00' }, // 10 min → 25%
        ]),
      ])
      const { topHeroes } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topHeroes.value[0]).toMatchObject({ key: 'lucio', share: 75 })
      expect(topHeroes.value[1]).toMatchObject({ key: 'mercy', share: 25 })
    })

    it('drops records without parseable play_time on a hero', () => {
      const records = ref([
        recWithHeroes([{ hero: 'lucio', play_time: '11:25' }]),
        // No play_time — contributes nothing.
        { ...recWithHeroes([{ hero: 'mercy', play_time: '' }]) } as MatchRecord,
      ])
      const { topHeroes } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topHeroes.value).toHaveLength(1)
      expect(topHeroes.value[0]!.key).toBe('lucio')
    })

    it('returns an empty list when no record has heroes_played time', () => {
      const records = ref([rec({ hero: 'lucio' })])
      const { topHeroes } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topHeroes.value).toEqual([])
    })
  })

  describe('totalTimePlayed', () => {
    function recWithGameLength(gameLength: string | undefined): MatchRecord {
      return {
        match_key: `m-${Math.random()}`,
        source_files: ['a.png'],
        source_types: { 'a.png': 'summary' },
        data: {
          map: 'rialto', hero: 'lucio', mode: 'competitive',
          result: 'victory', date: '2026-05-10', finished_at: '14:00',
          ...(gameLength !== undefined ? { game_length: gameLength } : {}),
        },
        parsed_at: '2026-05-10T14:00:00Z',
      } as unknown as MatchRecord
    }

    it('sums game_length across the narrow', () => {
      const records = ref([
        recWithGameLength('11:25'),
        recWithGameLength('08:54'),
      ])
      const { totalTimePlayed } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(totalTimePlayed.value.minutes).toBeCloseTo(11.42 + 8.9, 1)
      expect(totalTimePlayed.value.label).toBe('20min')
      expect(totalTimePlayed.value.recordsWithTime).toBe(2)
      expect(totalTimePlayed.value.recordsTotal).toBe(2)
    })

    it('renders hour-plus totals via formatPlayMinutes', () => {
      // 30 minutes × 16 matches = 480 min → 8h0min
      const records = ref(Array.from({ length: 16 }, () => recWithGameLength('30:00')))
      const { totalTimePlayed } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(totalTimePlayed.value.label).toBe('8h0min')
    })

    it('reports coverage when some records lack game_length', () => {
      const records = ref([
        recWithGameLength('10:00'),
        recWithGameLength(undefined),
        recWithGameLength('05:00'),
      ])
      const { totalTimePlayed } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(totalTimePlayed.value.label).toBe('15min')
      expect(totalTimePlayed.value.recordsWithTime).toBe(2)
      expect(totalTimePlayed.value.recordsTotal).toBe(3)
    })

    it('renders zero coverage as "—" and reports 0/N', () => {
      const records = ref([
        recWithGameLength(undefined),
        recWithGameLength(undefined),
      ])
      const { totalTimePlayed } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(totalTimePlayed.value.label).toBe('—')
      expect(totalTimePlayed.value.recordsWithTime).toBe(0)
      expect(totalTimePlayed.value.recordsTotal).toBe(2)
    })

    it('honors the leaver-exclude-tally rule, like wld/winrate', () => {
      const records = ref([
        recWithGameLength('10:00'),
        { ...recWithGameLength('20:00'), annotation: { leaver: 'self' } } as MatchRecord,
      ])
      const handling = ref<LeaverHandling>('include')
      const { totalTimePlayed } = legacy(useMatchesDossier(records, handling))
      expect(totalTimePlayed.value.label).toBe('30min')
      handling.value = 'exclude-tally'
      expect(totalTimePlayed.value.label).toBe('10min')
    })
  })

  describe('mostPlayedHero', () => {
    // The KPI tile's win-rate annotation reads "where you actually
    // PLAYED that hero" — counted only over matches where the
    // most-played hero contributed at least 20% of the play time.
    // Five-percent flex picks would otherwise drag a focused
    // one-trick's win-rate around for reasons unrelated to their
    // performance on that hero.
    function recWithPlay(
      heroes: { hero: string; percent_played: number }[],
      result: 'victory' | 'defeat' | 'draw' = 'victory',
      leaver?: '' | 'self' | 'team' | 'enemy',
    ): MatchRecord {
      return {
        match_key: `m-${Math.random()}`,
        source_files: ['a.png'],
        source_types: { 'a.png': 'summary' },
        data: {
          map: 'rialto', hero: heroes[0]?.hero, mode: 'competitive',
          result, date: '2026-05-10', finished_at: '14:00',
          heroes_played: heroes.map(h => ({
            hero: h.hero, percent_played: h.percent_played,
            // play_time required so topHeroes ranks the hero.
            play_time: '10:00',
          })),
        },
        annotation: leaver ? { leaver } : undefined,
        parsed_at: '2026-05-10T14:00:00Z',
      } as unknown as MatchRecord
    }

    it('counts wins/losses where the most-played hero played ≥ 20%', () => {
      const records = ref([
        recWithPlay([{ hero: 'lucio', percent_played: 100 }], 'victory'),
        recWithPlay([{ hero: 'lucio', percent_played: 80 }], 'victory'),
        recWithPlay([{ hero: 'lucio', percent_played: 60 }], 'defeat'),
        // Sub-threshold — Lúcio appeared as a flex pick; doesn't
        // contribute to the win-rate denom.
        recWithPlay([{ hero: 'lucio', percent_played: 10 }, { hero: 'mercy', percent_played: 90 }], 'defeat'),
      ])
      const { mostPlayedHero } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(mostPlayedHero.value).toMatchObject({
        key: 'lucio',
        winrate: 67, // 2W / 3 qualifying matches = 66.67% → 67
        qualifyingMatches: 3,
      })
    })

    it('returns null winrate when no match clears the 20% threshold', () => {
      const records = ref([
        recWithPlay([{ hero: 'lucio', percent_played: 10 }, { hero: 'kiriko', percent_played: 90 }], 'victory'),
        recWithPlay([{ hero: 'lucio', percent_played: 15 }, { hero: 'ana', percent_played: 85 }], 'defeat'),
      ])
      const { mostPlayedHero } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(mostPlayedHero.value).toMatchObject({
        key: 'lucio',
        winrate: null,
        qualifyingMatches: 0,
      })
    })

    it('returns null when topHeroes is empty', () => {
      const records = ref<MatchRecord[]>([])
      const { mostPlayedHero } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(mostPlayedHero.value).toBeNull()
    })

    it('uses the time-ranked top hero, not the primary-hero count winner', () => {
      // Mercy clicked 3× at 10% (below threshold) vs Lúcio once at
      // 80%. topHeroes ranks by total time: Mercy 3 min × 3 = 9 min,
      // Lúcio 8 min × 1 = 8 min → Mercy wins ranking, but only Lúcio
      // clears the 20% bar on any match.
      const records = ref([
        recWithPlay([{ hero: 'mercy', percent_played: 10 }, { hero: 'kiriko', percent_played: 90 }], 'victory'),
        recWithPlay([{ hero: 'mercy', percent_played: 10 }, { hero: 'kiriko', percent_played: 90 }], 'defeat'),
        recWithPlay([{ hero: 'mercy', percent_played: 10 }, { hero: 'kiriko', percent_played: 90 }], 'defeat'),
        recWithPlay([{ hero: 'lucio', percent_played: 80 }], 'victory'),
      ])
      const { mostPlayedHero, topHeroes } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      // Sanity: Mercy is the time leader.
      expect(topHeroes.value[0]!.key).toBe('mercy')
      // Mercy contributes to qualifyingMatches only if percent_played ≥ 20.
      expect(mostPlayedHero.value).toMatchObject({
        key: 'mercy',
        winrate: null,
        qualifyingMatches: 0,
      })
    })

    it('honors leaver-exclude-tally — leaver matches drop from the win-rate denom', () => {
      const records = ref([
        recWithPlay([{ hero: 'lucio', percent_played: 100 }], 'victory'),
        recWithPlay([{ hero: 'lucio', percent_played: 100 }], 'defeat', 'self'),
      ])
      const handling = ref<LeaverHandling>('include')
      const { mostPlayedHero } = legacy(useMatchesDossier(records, handling))
      expect(mostPlayedHero.value).toMatchObject({ winrate: 50, qualifyingMatches: 2 })
      handling.value = 'exclude-tally'
      expect(mostPlayedHero.value).toMatchObject({ winrate: 100, qualifyingMatches: 1 })
    })

    it('draws do not count toward the win-rate denom (parity with headline winrate)', () => {
      const records = ref([
        recWithPlay([{ hero: 'lucio', percent_played: 100 }], 'victory'),
        recWithPlay([{ hero: 'lucio', percent_played: 100 }], 'draw'),
      ])
      const { mostPlayedHero } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      // Draw skips both w++ and l++ so winrate = 100% over 1 decisive match.
      // qualifyingMatches counts decisive matches (parity with the denom).
      expect(mostPlayedHero.value).toMatchObject({ winrate: 100, qualifyingMatches: 1 })
    })
  })

  describe('averageKDA', () => {
    // The KPI tile sources from data.performance.{eliminations,
    // deaths, assists}.avg_per_10min and averages the per-match
    // rates across every tally-eligible record that carries the
    // field set. K/D/A order matches gaming convention (Kills /
    // Deaths / Assists), so the display row reads
    // "12.14 / 5.08 / 10.16" with eliminations on the left.
    function recWithKDA(
      elim: number | undefined,
      deaths: number | undefined,
      assists: number | undefined,
      opts: { leaver?: '' | 'self' | 'team' | 'enemy' } = {},
    ): MatchRecord {
      const perf = elim === undefined && deaths === undefined && assists === undefined
        ? undefined
        : {
          eliminations: elim !== undefined ? { total: 0, avg_per_10min: elim } : undefined,
          deaths:       deaths !== undefined ? { total: 0, avg_per_10min: deaths } : undefined,
          assists:      assists !== undefined ? { total: 0, avg_per_10min: assists } : undefined,
        }
      return {
        match_key: `m-${Math.random()}`,
        source_files: ['a.png'],
        source_types: { 'a.png': 'summary' },
        data: {
          map: 'rialto', hero: 'lucio', mode: 'competitive',
          result: 'victory', date: '2026-05-10', finished_at: '14:00',
          ...(perf ? { performance: perf } : {}),
        },
        annotation: opts.leaver ? { leaver: opts.leaver } : undefined,
        parsed_at: '2026-05-10T14:00:00Z',
      } as unknown as MatchRecord
    }

    it('averages per-match avg_per_10min across the narrow', () => {
      const records = ref([
        recWithKDA(14.87, 6.12, 12.25),
        recWithKDA(9.40, 4.03, 8.06),
      ])
      const { averageKDA } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(averageKDA.value).not.toBeNull()
      expect(averageKDA.value!.eliminations).toBeCloseTo(12.135, 4)
      expect(averageKDA.value!.deaths).toBeCloseTo(5.075, 4)
      expect(averageKDA.value!.assists).toBeCloseTo(10.155, 4)
      expect(averageKDA.value!.qualifyingMatches).toBe(2)
    })

    it('renders the label as "K.KK / D.DD / A.AA" rounded to hundredths', () => {
      const records = ref([
        recWithKDA(14.87, 6.12, 12.25),
        recWithKDA(9.40, 4.03, 8.06),
      ])
      const { averageKDA } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      // 12.135 → 12.14, 5.075 → 5.08, 10.155 → 10.16. JS toFixed
      // uses round-half-away-from-zero for these values (post-float-
      // representation), which matches the user-facing convention.
      expect(averageKDA.value!.label).toBe('12.14 / 5.08 / 10.16')
    })

    it('returns null when no record carries performance data', () => {
      const records = ref([rec({ result: 'victory' }), rec({ result: 'defeat' })])
      const { averageKDA } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(averageKDA.value).toBeNull()
    })

    it('skips records that lack any of the three avg_per_10min fields', () => {
      const records = ref([
        recWithKDA(10, 5, 8),
        // Partial — missing deaths' avg_per_10min. The record is
        // skipped entirely rather than averaged with a 0 stand-in.
        recWithKDA(20, undefined, 12),
        recWithKDA(15, 7, 10),
      ])
      const { averageKDA } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(averageKDA.value!.eliminations).toBeCloseTo(12.5, 4)
      expect(averageKDA.value!.qualifyingMatches).toBe(2)
    })

    it('honors leaver-exclude-tally — leaver records drop from the average', () => {
      const records = ref([
        recWithKDA(10, 5, 8),
        recWithKDA(30, 5, 8, { leaver: 'self' }),
      ])
      const handling = ref<LeaverHandling>('include')
      const { averageKDA } = legacy(useMatchesDossier(records, handling))
      expect(averageKDA.value!.eliminations).toBeCloseTo(20, 4)
      handling.value = 'exclude-tally'
      expect(averageKDA.value!.eliminations).toBeCloseTo(10, 4)
      expect(averageKDA.value!.qualifyingMatches).toBe(1)
    })

    it('reports coverage when some records lack performance', () => {
      const records = ref([
        recWithKDA(10, 5, 8),
        rec({ result: 'victory' }), // no performance
        rec({ result: 'defeat' }),  // no performance
      ])
      const { averageKDA } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(averageKDA.value!.qualifyingMatches).toBe(1)
      expect(averageKDA.value!.recordsTotal).toBe(3)
    })
  })

  describe('reactivity', () => {
    it('updates when records change', () => {
      const records = ref([rec({ result: 'victory' })])
      const { wld } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
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
      const { wld } = legacy(useMatchesDossier(records, handling))
      expect(wld.value.total).toBe(2)
      handling.value = 'exclude-tally'
      expect(wld.value.total).toBe(1)
    })
  })

  describe('wldSinceLastReview', () => {
    const ANCHOR = '2026-06-05T12:00:00Z'

    it('counts only records whose parsed_at is strictly after the latest reviewed_at', () => {
      const records = ref([
        // Three older matches the anchor IS pinned to — these
        // should NOT count.
        rec({ key: 'old-w', result: 'victory', parsedAt: '2026-06-01T10:00:00Z',
              reviewedBy: 'self', reviewedAt: '2026-06-03T10:00:00Z' }),
        rec({ key: 'anchor', result: 'defeat', parsedAt: ANCHOR,
              reviewedBy: 'coach', reviewedAt: ANCHOR }),
        // Two new matches after the anchor — these count.
        rec({ key: 'new-w', result: 'victory', parsedAt: '2026-06-06T09:00:00Z' }),
        rec({ key: 'new-l', result: 'defeat',  parsedAt: '2026-06-07T09:00:00Z' }),
        rec({ key: 'new-d', result: 'draw',    parsedAt: '2026-06-08T09:00:00Z' }),
      ])
      const { wldSinceLastReview } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(wldSinceLastReview.value).toEqual({
        w: 1, l: 1, d: 1, total: 3, referenceAt: ANCHOR,
      })
    })

    it('returns null when nothing in the narrow has been reviewed', () => {
      const records = ref([
        rec({ result: 'victory' }),
        rec({ result: 'defeat' }),
      ])
      const { wldSinceLastReview } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(wldSinceLastReview.value).toBeNull()
    })

    it('respects leaverHandling=exclude-tally (drops leaver-tagged records)', () => {
      const records = ref([
        rec({ key: 'anchor', reviewedBy: 'self', reviewedAt: ANCHOR, parsedAt: ANCHOR }),
        rec({ key: 'new-w', result: 'victory', parsedAt: '2026-06-06T00:00:00Z' }),
        rec({ key: 'new-l-leaver', result: 'defeat', leaver: 'self',
              parsedAt: '2026-06-07T00:00:00Z' }),
      ])
      const { wldSinceLastReview } = legacy(useMatchesDossier(records, ref<LeaverHandling>('exclude-tally')))
      // Leaver-tagged loss dropped; only the win remains.
      expect(wldSinceLastReview.value).toEqual({
        w: 1, l: 0, d: 0, total: 1, referenceAt: ANCHOR,
      })
    })

    it('handles records missing parsed_at without crashing', () => {
      const records = ref([
        rec({ key: 'anchor', reviewedBy: 'self', reviewedAt: ANCHOR, parsedAt: ANCHOR }),
        { ...rec({ result: 'victory' }), parsed_at: '' } as unknown as MatchRecord,
        rec({ result: 'defeat', parsedAt: '2026-06-06T00:00:00Z' }),
      ])
      const { wldSinceLastReview } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      // Only the defeat with a valid parsed_at after the anchor counts.
      expect(wldSinceLastReview.value).toEqual({
        w: 0, l: 1, d: 0, total: 1, referenceAt: ANCHOR,
      })
    })

    it('emits zeros when every match is older than the latest review', () => {
      const records = ref([
        rec({ key: 'anchor', reviewedBy: 'self', reviewedAt: ANCHOR, parsedAt: ANCHOR }),
        rec({ result: 'victory', parsedAt: '2026-06-03T00:00:00Z' }),
        rec({ result: 'defeat',  parsedAt: '2026-06-04T00:00:00Z' }),
      ])
      const { wldSinceLastReview } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(wldSinceLastReview.value).toEqual({
        w: 0, l: 0, d: 0, total: 0, referenceAt: ANCHOR,
      })
    })
  })

  describe('topRoles', () => {
    // Typed lookup helper — closed-shape object so accesses stay
    // non-nullable under noUncheckedIndexedAccess (a plain
    // `Record<Role, T>` would still widen each lookup to `T |
    // undefined`). The composable's contract guarantees every
    // canonical role appears in the output.
    function byKey<T extends { key: string }>(rows: T[]): { tank: T; dps: T; support: T } {
      const m = Object.fromEntries(rows.map((r) => [r.key, r])) as Record<string, T>
      return { tank: m.tank as T, dps: m.dps as T, support: m.support as T }
    }
    // Tiny canonical hero→role mock — enough heroes to cover every
    // role plus a "filler" that the resolver returns nothing for, so
    // we can verify the resolver-undefined branch.
    const heroRole = (hero: string): string | undefined => {
      const map: Record<string, string> = {
        reinhardt: 'tank',
        roadhog:   'tank',
        ana:       'support',
        lucio:     'support',
        moira:     'support',
        soldier:   'dps',
        tracer:    'dps',
      }
      return map[hero]
    }

    function roleRec(opts: {
      key?: string
      primary?: string
      heroes?: string[]
      result?: 'victory' | 'defeat' | 'draw'
      leaver?: 'self' | 'team' | 'enemy'
    }): MatchRecord {
      return {
        match_key: opts.key ?? `m-${Math.random()}`,
        source_files: ['a.png'],
        source_types: { 'a.png': 'summary' },
        data: {
          map: 'rialto', mode: 'competitive',
          role: opts.primary,
          hero: (opts.heroes ?? [])[0],
          result: opts.result ?? 'victory',
          date: '2026-05-10', finished_at: '14:00',
          heroes_played: (opts.heroes ?? []).map((h) => ({ hero: h, percent_played: 50, play_time: '05:00' })),
        },
        annotation: opts.leaver ? { leaver: opts.leaver } : undefined,
        parsed_at: '2026-05-10T14:00:00Z',
      } as unknown as MatchRecord
    }

    it('counts every match in exactly one role when matches are role-locked', () => {
      const records = ref([
        roleRec({ primary: 'tank',    heroes: ['reinhardt'] }),
        roleRec({ primary: 'tank',    heroes: ['roadhog']   }),
        roleRec({ primary: 'support', heroes: ['lucio']     }),
        roleRec({ primary: 'dps',     heroes: ['tracer']    }),
      ])
      const { topRoles } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include'), heroRole))
      const by = byKey(topRoles.value)
      expect(by.tank.total).toBe(2)
      expect(by.support.total).toBe(1)
      expect(by.dps.total).toBe(1)
      // Share is count / total_matches; no overlap → sums to 100%.
      expect(by.tank.share + by.support.share + by.dps.share).toBe(100)
    })

    it('open-queue overlap pushes the row sum above 100%', () => {
      // Spec example, paraphrased: 2 matches. Match 1 swaps support↔tank;
      // match 2 swaps dps↔tank. Tank shows up in both → 2x; support
      // and dps each in one → 1x. Denominator is total matches (2), so
      // tank=100%, support=50%, dps=50%, sum=200%.
      const records = ref([
        roleRec({ heroes: ['reinhardt', 'lucio'] }),
        roleRec({ heroes: ['roadhog',   'tracer'] }),
      ])
      const { topRoles } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include'), heroRole))
      const by = byKey(topRoles.value)
      expect(by.tank).toMatchObject({ total: 2, share: 100 })
      expect(by.support).toMatchObject({ total: 1, share: 50 })
      expect(by.dps).toMatchObject({ total: 1, share: 50 })
      expect(by.tank.share + by.support.share + by.dps.share).toBeGreaterThan(100)
    })

    it('sorts the row descending by count so the dominant role is first', () => {
      const records = ref([
        roleRec({ heroes: ['lucio'] }),
        roleRec({ heroes: ['lucio'] }),
        roleRec({ heroes: ['lucio'] }),
        roleRec({ heroes: ['tracer'] }),
        roleRec({ heroes: ['roadhog'] }),
      ])
      const { topRoles } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include'), heroRole))
      expect(topRoles.value.map((r) => r.key)).toEqual(['support', 'tank', 'dps'])
    })

    it('falls back to data.role when no heroRole resolver is provided', () => {
      const records = ref([
        roleRec({ primary: 'tank', heroes: ['reinhardt'] }),
        roleRec({ primary: 'dps' }),
      ])
      const { topRoles } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include'))) // no resolver
      const by = byKey(topRoles.value)
      expect(by.tank.total).toBe(1)
      expect(by.dps.total).toBe(1)
    })

    it('drops heroes the resolver does not recognise', () => {
      const records = ref([
        roleRec({ primary: 'support', heroes: ['lucio', 'mystery-hero'] }),
      ])
      const { topRoles } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include'), heroRole))
      const by = byKey(topRoles.value)
      // Only support counted; the unknown hero contributes nothing.
      expect(by.support.total).toBe(1)
      expect(by.tank.total).toBe(0)
      expect(by.dps.total).toBe(0)
    })

    it('returns zero shares for an empty corpus without dividing by zero', () => {
      const records = ref<MatchRecord[]>([])
      const { topRoles } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include'), heroRole))
      for (const r of topRoles.value) {
        expect(r.total).toBe(0)
        expect(r.share).toBe(0)
        expect(r.winrate).toBe(0)
      }
    })

    it('uses the full narrow even when leaverHandling=exclude-tally', () => {
      // Role coverage is a workflow / what-you-played metric, NOT a
      // tally metric. Same rule as topMaps + topHeroes: drop leaver
      // exclusion at the breakdown layer.
      const records = ref([
        roleRec({ heroes: ['reinhardt'], result: 'victory' }),
        roleRec({ heroes: ['lucio'],     result: 'defeat',  leaver: 'self' }),
      ])
      const { topRoles } = legacy(useMatchesDossier(records, ref<LeaverHandling>('exclude-tally'), heroRole))
      const by = byKey(topRoles.value)
      expect(by.tank.total).toBe(1)
      expect(by.support.total).toBe(1)
    })

    it('computes per-role winrate excluding draws from the denominator', () => {
      const records = ref([
        roleRec({ heroes: ['reinhardt'], result: 'victory' }),
        roleRec({ heroes: ['reinhardt'], result: 'defeat' }),
        roleRec({ heroes: ['reinhardt'], result: 'victory' }),
        roleRec({ heroes: ['reinhardt'], result: 'draw' }),
        roleRec({ heroes: ['tracer'],    result: 'defeat' }),
      ])
      const { topRoles } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include'), heroRole))
      const by = byKey(topRoles.value)
      // 2W / 1L on tank (draw excluded) → 67%
      expect(by.tank.winrate).toBe(67)
      // 0W / 1L on dps → 0%
      expect(by.dps.winrate).toBe(0)
    })
  })

  describe('reviewedCount', () => {
    it('counts records whose reviewed_by is set (self or coach)', () => {
      const records = ref([
        rec({ key: 'a', reviewedBy: 'self' }),
        rec({ key: 'b' }), // unreviewed
        rec({ key: 'c', reviewedBy: 'coach' }),
        rec({ key: 'd' }),
        rec({ key: 'e', reviewedBy: 'self' }),
      ])
      const { reviewedCount } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(reviewedCount.value).toEqual({ reviewed: 3, total: 5, percent: 60 })
    })

    it('returns zeros for an empty corpus without dividing by zero', () => {
      const records = ref<MatchRecord[]>([])
      const { reviewedCount } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(reviewedCount.value).toEqual({ reviewed: 0, total: 0, percent: 0 })
    })

    it('uses the full narrow even when leaverHandling=exclude-tally', () => {
      // Review coverage is a workflow metric, not a W/L tally — leaver
      // exclusion shouldn't shrink the denominator.
      const records = ref([
        rec({ key: 'a', reviewedBy: 'self' }),
        rec({ key: 'b', reviewedBy: 'coach', leaver: 'self' }),
        rec({ key: 'c' }),
      ])
      const { reviewedCount } = legacy(useMatchesDossier(records, ref<LeaverHandling>('exclude-tally')))
      expect(reviewedCount.value).toEqual({ reviewed: 2, total: 3, percent: 67 })
    })
  })

  describe('daysSinceLastReview', () => {
    it('floors to whole days since the most-recent reviewed_at', () => {
      const FIXED_NOW = Date.UTC(2026, 5, 10, 12, 0, 0) // 2026-06-10T12:00Z
      vi.useFakeTimers()
      vi.setSystemTime(FIXED_NOW)
      try {
        const records = ref([
          rec({ key: 'old', reviewedBy: 'self',  reviewedAt: '2026-06-01T12:00:00Z' }), // 9d
          rec({ key: 'newer', reviewedBy: 'coach', reviewedAt: '2026-06-07T12:00:00Z' }), // 3d
          rec({ key: 'unreviewed' }),
        ])
        const { daysSinceLastReview } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
        expect(daysSinceLastReview.value.days).toBe(3)
        expect(daysSinceLastReview.value.lastReviewedAt).toBe('2026-06-07T12:00:00Z')
      } finally {
        vi.useRealTimers()
      }
    })

    it('returns null days when no record has been reviewed', () => {
      const records = ref([rec({}), rec({})])
      const { daysSinceLastReview } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(daysSinceLastReview.value).toEqual({ days: null, lastReviewedAt: null })
    })

    it('treats sub-24h-ago timestamps as 0 days (today)', () => {
      const FIXED_NOW = Date.UTC(2026, 5, 10, 12, 0, 0)
      vi.useFakeTimers()
      vi.setSystemTime(FIXED_NOW)
      try {
        const records = ref([
          rec({ reviewedBy: 'self', reviewedAt: '2026-06-10T08:00:00Z' }), // 4h ago
        ])
        const { daysSinceLastReview } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
        expect(daysSinceLastReview.value.days).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('ignores malformed reviewed_at strings without crashing', () => {
      const FIXED_NOW = Date.UTC(2026, 5, 10, 12, 0, 0)
      vi.useFakeTimers()
      vi.setSystemTime(FIXED_NOW)
      try {
        const records = ref([
          rec({ reviewedBy: 'self', reviewedAt: 'not-an-iso-date' }),
          rec({ reviewedBy: 'coach', reviewedAt: '2026-06-05T00:00:00Z' }),
        ])
        const { daysSinceLastReview } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
        // Only the valid one contributes; 5d 12h ago floors to 5.
        expect(daysSinceLastReview.value.days).toBe(5)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // ─── PR B opt-in widget computeds ──────────────────────────────

  describe('currentStreak', () => {
    it('returns zero count + null result for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { currentStreak } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(currentStreak.value).toEqual({ count: 0, result: null, sinceDate: null })
    })

    it('counts the most-recent run of consecutive same-result matches', () => {
      // parsed_at desc: m3 (W), m2 (W), m1 (L). The latest streak is 2W.
      const records = ref([
        rec({ result: 'defeat',  parsedAt: '2026-05-10T08:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T09:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T10:00:00Z' }),
      ])
      const { currentStreak } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(currentStreak.value.count).toBe(2)
      expect(currentStreak.value.result).toBe('victory')
    })
  })

  describe('longestWinStreak', () => {
    it('returns 0 for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { longestWinStreak } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(longestWinStreak.value).toBe(0)
    })

    it('finds the biggest contiguous victory run', () => {
      // chronological: W W L W W W L W → biggest run = 3
      const records = ref([
        rec({ result: 'victory', parsedAt: '2026-05-10T01:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T02:00:00Z' }),
        rec({ result: 'defeat',  parsedAt: '2026-05-10T03:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T04:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T05:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T06:00:00Z' }),
        rec({ result: 'defeat',  parsedAt: '2026-05-10T07:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T08:00:00Z' }),
      ])
      const { longestWinStreak } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(longestWinStreak.value).toBe(3)
    })
  })

  describe('heroPoolSize', () => {
    it('returns 0 for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { heroPoolSize } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(heroPoolSize.value).toBe(0)
    })

    it('counts distinct heroes across heroes_played[*]', () => {
      const records = ref([
        {
          ...rec({}),
          data: { heroes_played: [{ hero: 'lucio' }, { hero: 'ana' }] },
        } as unknown as MatchRecord,
        {
          ...rec({}),
          data: { heroes_played: [{ hero: 'lucio' }, { hero: 'kiriko' }] },
        } as unknown as MatchRecord,
      ])
      const { heroPoolSize } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(heroPoolSize.value).toBe(3) // lucio + ana + kiriko
    })
  })

  describe('bestWinrateHero', () => {
    it('returns null when no hero qualifies', () => {
      const records = ref<MatchRecord[]>([])
      const { bestWinrateHero } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(bestWinrateHero.value).toBeNull()
    })

    it('picks the hero with the highest winrate gated to >= 3 qualifying decisive matches', () => {
      // ana: 3 qualifying matches, 3 wins → 100%
      // lucio: 5 qualifying matches, 3 wins / 2 losses → 60%
      // sub-threshold flex picks (≤ 20% percent_played) are ignored.
      function ph(hero: string, pct: number) { return { hero, percent_played: pct } }
      const win  = (heroes: ReturnType<typeof ph>[]) => ({
        ...rec({ result: 'victory' }),
        data: { result: 'victory', heroes_played: heroes },
      } as unknown as MatchRecord)
      const loss = (heroes: ReturnType<typeof ph>[]) => ({
        ...rec({ result: 'defeat' }),
        data: { result: 'defeat', heroes_played: heroes },
      } as unknown as MatchRecord)
      const records = ref([
        win([ph('ana', 100)]),
        win([ph('ana', 100)]),
        win([ph('ana', 100)]),
        win([ph('lucio', 100)]),
        win([ph('lucio', 100)]),
        win([ph('lucio', 100)]),
        loss([ph('lucio', 100)]),
        loss([ph('lucio', 100)]),
      ])
      const { bestWinrateHero } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(bestWinrateHero.value?.key).toBe('ana')
      expect(bestWinrateHero.value?.winrate).toBe(100)
      expect(bestWinrateHero.value?.qualifyingMatches).toBe(3)
    })
  })

  describe('topMapTypes', () => {
    it('returns an empty array for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { topMapTypes } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(topMapTypes.value).toEqual([])
    })

    it('counts and shares by data.type', () => {
      const withType = (type: string) => ({
        ...rec({}),
        data: { type, result: 'victory' },
      } as unknown as MatchRecord)
      const records = ref([
        withType('control'),
        withType('control'),
        withType('hybrid'),
      ])
      const { topMapTypes } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      const types = topMapTypes.value.map((r) => r.key)
      expect(types).toContain('control')
      expect(types).toContain('hybrid')
      const control = topMapTypes.value.find((r) => r.key === 'control')!
      expect(control.total).toBe(2)
      expect(control.share).toBe(67)
    })
  })

  describe('timeOfDayBuckets', () => {
    it('renders six zero-count buckets for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { timeOfDayBuckets } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(timeOfDayBuckets.value).toHaveLength(6)
      expect(timeOfDayBuckets.value.every((b) => b.count === 0 && b.share === 0)).toBe(true)
    })

    it('places records into the right four-hour bucket', () => {
      const at = (fa: string) => ({
        ...rec({}),
        data: { finished_at: fa },
      } as unknown as MatchRecord)
      const records = ref([
        at('02:00'), at('03:30'),     // bucket 0 (00–04)
        at('17:00'),                  // bucket 4 (16–20)
        at('22:45'), at('23:00'),     // bucket 5 (20–24)
      ])
      const { timeOfDayBuckets } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      const counts = timeOfDayBuckets.value.map((b) => b.count)
      expect(counts).toEqual([2, 0, 0, 0, 1, 2])
    })

    it('skips records without a parseable finished_at hour', () => {
      const at = (fa: string | undefined) => ({
        ...rec({}),
        data: { finished_at: fa },
      } as unknown as MatchRecord)
      const records = ref([
        at(undefined),  // skipped
        at(''),         // skipped
        at('not-a-time'), // skipped (NaN)
        at('12:00'),    // bucket 3
      ])
      const { timeOfDayBuckets } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(timeOfDayBuckets.value[3]!.count).toBe(1)
      expect(timeOfDayBuckets.value[3]!.share).toBe(100)
    })
  })

  describe('dayOfWeekBuckets', () => {
    it('renders seven zero-count buckets for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { dayOfWeekBuckets } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(dayOfWeekBuckets.value).toHaveLength(7)
    })

    it('counts records by day-of-week and rotates by weekStart', () => {
      const on = (date: string) => ({
        ...rec({}),
        data: { date },
      } as unknown as MatchRecord)
      // 2026-05-10 = Sunday, 2026-05-12 = Tuesday, 2026-05-13 = Wednesday.
      const records = ref([on('2026-05-10'), on('2026-05-12'), on('2026-05-13'), on('2026-05-13')])
      // weekStart = 0 (Sunday-led)
      const ws = ref<0 | 1 | 2 | 3 | 4 | 5 | 6>(0)
      const { dayOfWeekBuckets } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include'), undefined, ws))
      // Sun, Mon, Tue, Wed, Thu, Fri, Sat
      expect(dayOfWeekBuckets.value.map((b) => b.label)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
      expect(dayOfWeekBuckets.value[0]!.count).toBe(1) // Sun
      expect(dayOfWeekBuckets.value[3]!.count).toBe(2) // Wed
      // Flip to Monday-led. Mon (0) — no records; Tue (1) — 1
      // record; Wed (2) — 2 records; Sun trails with 1 record.
      ws.value = 1
      expect(dayOfWeekBuckets.value.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
      expect(dayOfWeekBuckets.value[0]!.count).toBe(0) // Mon — no records
      expect(dayOfWeekBuckets.value[2]!.count).toBe(2) // Wed
      expect(dayOfWeekBuckets.value[6]!.count).toBe(1) // Sun trails
    })
  })

  describe('recentResults', () => {
    it('returns an empty array for an empty corpus', () => {
      const records = ref<MatchRecord[]>([])
      const { recentResults } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(recentResults.value).toEqual([])
    })

    it('returns up to 5 decisive results newest-first', () => {
      const records = ref([
        rec({ result: 'victory', parsedAt: '2026-05-10T01:00:00Z' }),
        rec({ result: 'defeat',  parsedAt: '2026-05-10T02:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T03:00:00Z' }),
        rec({ result: 'draw',    parsedAt: '2026-05-10T04:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T05:00:00Z' }),
        rec({ result: 'defeat',  parsedAt: '2026-05-10T06:00:00Z' }),
      ])
      const { recentResults } = legacy(useMatchesDossier(records, ref<LeaverHandling>('include')))
      expect(recentResults.value).toEqual(['defeat', 'victory', 'draw', 'victory', 'defeat'])
    })
  })
})

// ─── PR B: parameterized query-helper coverage ────────────────
//
// The pre-PR-B precomputed-refs surface didn't expose any knobs
// directly — every limit / threshold / bucket count was a hardcoded
// constant. These cases pin the new parameter pass-through so PR C
// can wire widget configs in confidently.
describe('useMatchesDossier — query-helper parameterization', () => {
  describe('topByCount', () => {
    it('honours a custom limit', () => {
      const records = ref(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((m) => rec({ map: m })),
      )
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      const top3  = dossier.topByCount({ getter: (r) => r.data?.map, limit: 3 })
      const top10 = dossier.topByCount({ getter: (r) => r.data?.map, limit: 10 })
      expect(top3.value).toHaveLength(3)
      expect(top10.value).toHaveLength(8)
    })

    it('honours a getter that picks a different field', () => {
      const records = ref([
        { ...rec({ map: 'rialto' }),  data: { ...rec({ map: 'rialto'  }).data!, type: 'control' } },
        { ...rec({ map: 'numbani' }), data: { ...rec({ map: 'numbani' }).data!, type: 'hybrid'  } },
        { ...rec({ map: 'lijiang' }), data: { ...rec({ map: 'lijiang' }).data!, type: 'control' } },
      ] as unknown as MatchRecord[])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      const byType = dossier.topByCount({ getter: (r) => r.data?.type, limit: 5 })
      expect(byType.value.find((e) => e.key === 'control')?.total).toBe(2)
      expect(byType.value.find((e) => e.key === 'hybrid')?.total).toBe(1)
    })
  })

  describe('playModeBreakdown', () => {
    it('returns three fixed entries regardless of which modes appear', () => {
      // Only competitive matches; quickplay and "—" should still
      // render as zero-bucket rows so the bar layout stays stable.
      const records = ref([
        { ...rec({ result: 'victory' }), play_mode: 'competitive' as const },
        { ...rec({ result: 'defeat'  }), play_mode: 'competitive' as const },
      ] as unknown as MatchRecord[])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      const out = dossier.playModeBreakdown
      expect(out.value).toHaveLength(3)
      expect(out.value.map((r) => r.key)).toEqual(['quickplay', 'competitive', '—'])
      expect(out.value[1]!.total).toBe(2)
      expect(out.value[0]!.total).toBe(0)
      expect(out.value[2]!.total).toBe(0)
    })

    it('buckets matches with no play_mode into the "—" row', () => {
      const records = ref([
        { ...rec({ result: 'victory' }), play_mode: 'quickplay'   as const },
        { ...rec({ result: 'victory' }), play_mode: 'competitive' as const },
        rec({ result: 'defeat' }), // no play_mode field → "—"
      ] as unknown as MatchRecord[])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      const out = dossier.playModeBreakdown
      expect(out.value[2]!.key).toBe('—')
      expect(out.value[2]!.total).toBe(1)
    })

    it('computes share as % of all matches (including the unset bucket)', () => {
      const records = ref([
        { ...rec({}), play_mode: 'quickplay'   as const },
        { ...rec({}), play_mode: 'competitive' as const },
        { ...rec({}), play_mode: 'competitive' as const },
        { ...rec({}), play_mode: 'competitive' as const },
      ] as unknown as MatchRecord[])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      const out = dossier.playModeBreakdown
      expect(out.value[0]!.share).toBe(25) // quickplay: 1/4
      expect(out.value[1]!.share).toBe(75) // competitive: 3/4
      expect(out.value[2]!.share).toBe(0)  // —: 0/4
    })

    it('computes winrate from decided matches only (draws excluded)', () => {
      const records = ref([
        { ...rec({ result: 'victory' }), play_mode: 'quickplay' as const },
        { ...rec({ result: 'defeat'  }), play_mode: 'quickplay' as const },
        { ...rec({ result: 'draw'    }), play_mode: 'quickplay' as const },
      ] as unknown as MatchRecord[])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      const out = dossier.playModeBreakdown
      expect(out.value[0]!.winrate).toBe(50) // 1 win / (1 win + 1 loss); draw ignored
    })

    it('returns 0 winrate for empty buckets (no division-by-zero)', () => {
      const records = ref<MatchRecord[]>([])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      const out = dossier.playModeBreakdown
      expect(out.value.every((r) => r.winrate === 0)).toBe(true)
      expect(out.value.every((r) => r.share === 0)).toBe(true)
    })
  })

  describe('topHeroesByMinutes', () => {
    it('honours a custom limit', () => {
      const records = ref([
        {
          ...rec({}),
          data: {
            ...rec({}).data!,
            heroes_played: [
              { hero: 'lucio',    percent_played: 50, play_time: '20:00' },
              { hero: 'mercy',    percent_played: 30, play_time: '12:00' },
              { hero: 'juno',     percent_played: 15, play_time: '06:00' },
              { hero: 'kiriko',   percent_played: 5,  play_time: '02:00' },
            ],
          },
        },
      ] as unknown as MatchRecord[])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(dossier.topHeroesByMinutes({ limit: 2 }).value).toHaveLength(2)
      expect(dossier.topHeroesByMinutes({ limit: 4 }).value).toHaveLength(4)
    })
  })

  describe('mostPlayedHero — minPercentPlayed knob', () => {
    it('a lower threshold lets sub-default attributions count toward winrate', () => {
      const records = ref([
        {
          ...rec({ result: 'victory' }),
          data: {
            ...rec({ result: 'victory' }).data!,
            heroes_played: [{ hero: 'lucio', percent_played: 15, play_time: '10:00' }],
          },
        },
        {
          ...rec({ result: 'defeat' }),
          data: {
            ...rec({ result: 'defeat' }).data!,
            heroes_played: [{ hero: 'lucio', percent_played: 15, play_time: '10:00' }],
          },
        },
      ] as unknown as MatchRecord[])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      // 15% is below the default 20% gate → 0 qualifying matches.
      const tight = dossier.mostPlayedHero({ minPercentPlayed: 20 })
      expect(tight.value?.qualifyingMatches).toBe(0)
      // Lowering the gate to 10% lets both records in.
      const loose = dossier.mostPlayedHero({ minPercentPlayed: 10 })
      expect(loose.value?.qualifyingMatches).toBe(2)
      expect(loose.value?.winrate).toBe(50)
    })
  })

  describe('bestWinrateHero — minMatches knob', () => {
    it('a higher minMatches drops heroes with thin sample sizes', () => {
      const records = ref([
        // Lucio: 3 wins, 0 losses (looks like 100% but a 1W spike risk)
        { ...rec({ result: 'victory' }), data: { ...rec({}).data!, heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }] } },
        { ...rec({ result: 'victory' }), data: { ...rec({}).data!, heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }] } },
        { ...rec({ result: 'victory' }), data: { ...rec({}).data!, heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }] } },
        // Mercy: 5 wins, 0 losses — also 100% but with more sample.
        { ...rec({ result: 'victory' }), data: { ...rec({}).data!, heroes_played: [{ hero: 'mercy', percent_played: 100, play_time: '10:00' }] } },
        { ...rec({ result: 'victory' }), data: { ...rec({}).data!, heroes_played: [{ hero: 'mercy', percent_played: 100, play_time: '10:00' }] } },
        { ...rec({ result: 'victory' }), data: { ...rec({}).data!, heroes_played: [{ hero: 'mercy', percent_played: 100, play_time: '10:00' }] } },
        { ...rec({ result: 'victory' }), data: { ...rec({}).data!, heroes_played: [{ hero: 'mercy', percent_played: 100, play_time: '10:00' }] } },
        { ...rec({ result: 'victory' }), data: { ...rec({}).data!, heroes_played: [{ hero: 'mercy', percent_played: 100, play_time: '10:00' }] } },
      ] as unknown as MatchRecord[])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      // minMatches=3 → both qualify; Lucio ties Mercy on winrate but
      // Mercy has more qualifying samples → tie-breaker picks Mercy.
      const lo = dossier.bestWinrateHero({ minPercentPlayed: 20, minMatches: 3 })
      expect(lo.value?.key).toBe('mercy')
      // minMatches=10 → no one qualifies.
      const hi = dossier.bestWinrateHero({ minPercentPlayed: 20, minMatches: 10 })
      expect(hi.value).toBeNull()
    })
  })

  describe('timeOfDayBuckets — bucketCount knob', () => {
    it('6 buckets → 4-hour windows', () => {
      const records = ref<MatchRecord[]>([])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      const buckets = dossier.timeOfDayBuckets({ bucketCount: 6 })
      expect(buckets.value.map((b) => b.label)).toEqual([
        '00–04', '04–08', '08–12', '12–16', '16–20', '20–24',
      ])
    })

    it('24 buckets → 1-hour windows', () => {
      const records = ref<MatchRecord[]>([])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      const buckets = dossier.timeOfDayBuckets({ bucketCount: 24 })
      expect(buckets.value).toHaveLength(24)
      expect(buckets.value[0]!.label).toBe('00–01')
      expect(buckets.value[23]!.label).toBe('23–24')
    })

    it('12 buckets bucket hours together correctly', () => {
      const records = ref([
        { ...rec({}), data: { ...rec({}).data!, finished_at: '05:00' } }, // bucket 2 (04-06)
        { ...rec({}), data: { ...rec({}).data!, finished_at: '05:30' } }, // bucket 2 (04-06)
        { ...rec({}), data: { ...rec({}).data!, finished_at: '07:00' } }, // bucket 3 (06-08)
      ] as unknown as MatchRecord[])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      const buckets = dossier.timeOfDayBuckets({ bucketCount: 12 })
      expect(buckets.value[2]!.count).toBe(2)
      expect(buckets.value[3]!.count).toBe(1)
    })
  })

  describe('dayOfWeekBuckets — weekStartOverride knob', () => {
    it('override beats the dossier-level weekStart ref', () => {
      const records = ref<MatchRecord[]>([])
      const ws = ref<WeekStart>(0) // global = Sunday
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'), undefined, ws)
      // No override → first label is Sun
      expect(dossier.dayOfWeekBuckets().value[0]!.label).toBe('Sun')
      // Override to Mon-start → first label is Mon
      expect(dossier.dayOfWeekBuckets({ weekStartOverride: 1 }).value[0]!.label).toBe('Mon')
    })
  })

  describe('recentResults — count knob', () => {
    it('caps the slice at the supplied count', () => {
      const records = ref([
        rec({ result: 'victory', parsedAt: '2026-05-10T01:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T02:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T03:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T04:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T05:00:00Z' }),
        rec({ result: 'victory', parsedAt: '2026-05-10T06:00:00Z' }),
      ])
      const dossier = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(dossier.recentResults({ count: 3 }).value).toHaveLength(3)
      expect(dossier.recentResults({ count: 10 }).value).toHaveLength(6)
    })
  })
})
