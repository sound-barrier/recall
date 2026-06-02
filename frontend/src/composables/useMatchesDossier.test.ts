import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import type { MatchRecord } from '../api'
import { useMatchesDossier, type LeaverHandling } from './useMatchesDossier'

function rec(opts: {
  key?: string
  result?: 'victory' | 'defeat' | 'draw'
  map?: string
  hero?: string
  leaver?: '' | 'self' | 'team' | 'enemy'
  reviewedBy?: 'self' | 'coach'
  reviewedAt?: string
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

    it('reports share of the breakdown as integer percentage', () => {
      // Three records, three distinct maps — each map's share is 33.
      // Bug fix: the bar/percent column was previously bound to winrate,
      // which renders as wildly bimodal 0/100 for low-count maps.
      const records = ref([
        rec({ map: 'atlas',    result: 'victory' }),
        rec({ map: 'rialto',   result: 'defeat'  }),
        rec({ map: 'suravasa', result: 'victory' }),
      ])
      const { topMaps } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { topMaps } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { topMaps } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { topHeroes } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(topHeroes.value).toHaveLength(3)
      expect(topHeroes.value.map((h) => h.key)).toEqual(['juno', 'lucio', 'wuyang'])
    })

    it('renders timeLabel in "XhYmin" / "Ymin" shape per entry', () => {
      const records = ref([
        recWithHeroes([{ hero: 'lucio', play_time: '11:25' }]), // 11min
        recWithHeroes([{ hero: 'mercy', play_time: '02:00' }]), // 2min
      ])
      const { topHeroes } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { topHeroes } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(topHeroes.value[0]).toMatchObject({ key: 'lucio', share: 75 })
      expect(topHeroes.value[1]).toMatchObject({ key: 'mercy', share: 25 })
    })

    it('drops records without parseable play_time on a hero', () => {
      const records = ref([
        recWithHeroes([{ hero: 'lucio', play_time: '11:25' }]),
        // No play_time — contributes nothing.
        { ...recWithHeroes([{ hero: 'mercy', play_time: '' }]) } as MatchRecord,
      ])
      const { topHeroes } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(topHeroes.value).toHaveLength(1)
      expect(topHeroes.value[0]!.key).toBe('lucio')
    })

    it('returns an empty list when no record has heroes_played time', () => {
      const records = ref([rec({ hero: 'lucio' })])
      const { topHeroes } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { totalTimePlayed } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(totalTimePlayed.value.minutes).toBeCloseTo(11.42 + 8.9, 1)
      expect(totalTimePlayed.value.label).toBe('20min')
      expect(totalTimePlayed.value.recordsWithTime).toBe(2)
      expect(totalTimePlayed.value.recordsTotal).toBe(2)
    })

    it('renders hour-plus totals via formatPlayMinutes', () => {
      // 30 minutes × 16 matches = 480 min → 8h0min
      const records = ref(Array.from({ length: 16 }, () => recWithGameLength('30:00')))
      const { totalTimePlayed } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(totalTimePlayed.value.label).toBe('8h0min')
    })

    it('reports coverage when some records lack game_length', () => {
      const records = ref([
        recWithGameLength('10:00'),
        recWithGameLength(undefined),
        recWithGameLength('05:00'),
      ])
      const { totalTimePlayed } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(totalTimePlayed.value.label).toBe('15min')
      expect(totalTimePlayed.value.recordsWithTime).toBe(2)
      expect(totalTimePlayed.value.recordsTotal).toBe(3)
    })

    it('renders zero coverage as "—" and reports 0/N', () => {
      const records = ref([
        recWithGameLength(undefined),
        recWithGameLength(undefined),
      ])
      const { totalTimePlayed } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { totalTimePlayed } = useMatchesDossier(records, handling)
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
      const { mostPlayedHero } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { mostPlayedHero } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(mostPlayedHero.value).toMatchObject({
        key: 'lucio',
        winrate: null,
        qualifyingMatches: 0,
      })
    })

    it('returns null when topHeroes is empty', () => {
      const records = ref<MatchRecord[]>([])
      const { mostPlayedHero } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { mostPlayedHero, topHeroes } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { mostPlayedHero } = useMatchesDossier(records, handling)
      expect(mostPlayedHero.value).toMatchObject({ winrate: 50, qualifyingMatches: 2 })
      handling.value = 'exclude-tally'
      expect(mostPlayedHero.value).toMatchObject({ winrate: 100, qualifyingMatches: 1 })
    })

    it('draws do not count toward the win-rate denom (parity with headline winrate)', () => {
      const records = ref([
        recWithPlay([{ hero: 'lucio', percent_played: 100 }], 'victory'),
        recWithPlay([{ hero: 'lucio', percent_played: 100 }], 'draw'),
      ])
      const { mostPlayedHero } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { averageKDA } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { averageKDA } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      // 12.135 → 12.14, 5.075 → 5.08, 10.155 → 10.16. JS toFixed
      // uses round-half-away-from-zero for these values (post-float-
      // representation), which matches the user-facing convention.
      expect(averageKDA.value!.label).toBe('12.14 / 5.08 / 10.16')
    })

    it('returns null when no record carries performance data', () => {
      const records = ref([rec({ result: 'victory' }), rec({ result: 'defeat' })])
      const { averageKDA } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { averageKDA } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(averageKDA.value!.eliminations).toBeCloseTo(12.5, 4)
      expect(averageKDA.value!.qualifyingMatches).toBe(2)
    })

    it('honors leaver-exclude-tally — leaver records drop from the average', () => {
      const records = ref([
        recWithKDA(10, 5, 8),
        recWithKDA(30, 5, 8, { leaver: 'self' }),
      ])
      const handling = ref<LeaverHandling>('include')
      const { averageKDA } = useMatchesDossier(records, handling)
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
      const { averageKDA } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(averageKDA.value!.qualifyingMatches).toBe(1)
      expect(averageKDA.value!.recordsTotal).toBe(3)
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

  describe('reviewedCount', () => {
    it('counts records whose reviewed_by is set (self or coach)', () => {
      const records = ref([
        rec({ key: 'a', reviewedBy: 'self' }),
        rec({ key: 'b' }), // unreviewed
        rec({ key: 'c', reviewedBy: 'coach' }),
        rec({ key: 'd' }),
        rec({ key: 'e', reviewedBy: 'self' }),
      ])
      const { reviewedCount } = useMatchesDossier(records, ref<LeaverHandling>('include'))
      expect(reviewedCount.value).toEqual({ reviewed: 3, total: 5, percent: 60 })
    })

    it('returns zeros for an empty corpus without dividing by zero', () => {
      const records = ref<MatchRecord[]>([])
      const { reviewedCount } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
      const { reviewedCount } = useMatchesDossier(records, ref<LeaverHandling>('exclude-tally'))
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
        const { daysSinceLastReview } = useMatchesDossier(records, ref<LeaverHandling>('include'))
        expect(daysSinceLastReview.value.days).toBe(3)
        expect(daysSinceLastReview.value.lastReviewedAt).toBe('2026-06-07T12:00:00Z')
      } finally {
        vi.useRealTimers()
      }
    })

    it('returns null days when no record has been reviewed', () => {
      const records = ref([rec({}), rec({})])
      const { daysSinceLastReview } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
        const { daysSinceLastReview } = useMatchesDossier(records, ref<LeaverHandling>('include'))
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
        const { daysSinceLastReview } = useMatchesDossier(records, ref<LeaverHandling>('include'))
        // Only the valid one contributes; 5d 12h ago floors to 5.
        expect(daysSinceLastReview.value.days).toBe(5)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
