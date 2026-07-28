import { describe, it, expect, beforeEach } from 'vitest'
import { computed, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import type { MatchRecord } from '@/api-client'
import { useEloEvidence } from '@/composables/elo/useEloEvidence'
import type { LeaverHandling } from '@/composables/matches/useMatchesDossier.types'

let seq = 0
interface Opts {
  result?: string
  hero?: string
  reviewedBy?: 'self' | 'coach'
  leaver?: boolean
}
function rec(opts: Opts = {}): MatchRecord {
  seq++
  // One day apart (seq=1 newest) so "since your last review" has clearly newer
  // games than the reviewed match, not same-day ties.
  const iso = new Date(Date.UTC(2026, 5, 30) - seq * 86_400_000).toISOString()
  return {
    match_key: `m${seq}`,
    queue_type: 'role',
    parsed_at: iso, // server timestamp: drives the "since last review" window
    ...(opts.reviewedBy ? { reviewed_by: opts.reviewedBy, reviewed_at: iso } : {}),
    ...(opts.leaver ? { annotation: { leavers: ['team'], throwers: [] } } : {}),
    data: {
      playlist: 'competitive',
      hero: opts.hero ?? 'lucio',
      role: 'support',
      result: opts.result ?? 'victory',
      date: iso.slice(0, 10),
      finished_at: iso.slice(11, 16),
      played_at_utc: iso,
      heroes_played: [{ hero: opts.hero ?? 'lucio', percent_played: 100 }],
    },
  } as unknown as MatchRecord
}

// A rich support corpus: pool heroes (lucio, brigitte) + one off-pool hero
// (mercy, a single game < 5% of the set), some reviewed matches incl. a coach
// review, two leavers, and an alternating result sequence for the tilt arms.
function corpus(): MatchRecord[] {
  // seq=1 is the newest match (each later record is an hour older), so the
  // reviewed matches sit deeper in the list — leaving newer games after them
  // for the "since your last review" record.
  seq = 0
  return [
    rec({ result: 'victory', hero: 'lucio' }), // newest — counts toward since-review
    rec({ result: 'defeat', hero: 'lucio', leaver: true }),
    rec({ result: 'victory', hero: 'lucio', reviewedBy: 'self' }), // last review
    rec({ result: 'defeat', hero: 'lucio', reviewedBy: 'coach' }),
    ...Array.from({ length: 10 }, (_, i) => rec({ result: i % 2 ? 'defeat' : 'victory', hero: 'lucio' })),
    ...Array.from({ length: 10 }, (_, i) => rec({ result: i % 2 ? 'victory' : 'defeat', hero: 'brigitte', leaver: i === 3 })),
    rec({ result: 'defeat', hero: 'mercy' }), // 1 of 24 → off-pool
  ]
}

function evidenceFrom(records: MatchRecord[]) {
  const leaverHandling = ref<LeaverHandling>('include')
  return useEloEvidence({
    trackRecs: computed(() => records),
    leaverHandling,
    heroRole: () => 'support',
  })
}

describe('useEloEvidence', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('surfaces the controllable levers from a real corpus', () => {
    const { items } = evidenceFrom(corpus())
    const ids = items.value.map((i) => i.id)
    // The myth-busting stats moved to EloMythChecks; only levers remain here.
    expect(ids).toContain('reviews')
    expect(ids).toContain('since-review')
    expect(ids).toContain('pool')
    expect(ids).toContain('leavers')
    expect(ids).toContain('streak-tilt')
    expect(ids).not.toContain('tilt')
    expect(ids).not.toContain('coin')
    expect(ids).not.toContain('percentile')

    const reviews = items.value.find((i) => i.id === 'reviews')!
    expect(reviews.gloss).toMatch(/coach/i)
    const pool = items.value.find((i) => i.id === 'pool')!
    expect(pool.value).toMatch(/% on ·.*% off/)
  })

  it('hides every item for an empty corpus (never renders zeros as insight)', () => {
    const { items } = evidenceFrom([])
    expect(items.value).toEqual([])
  })

  it('omits the leaver row when nothing was flagged', () => {
    seq = 0
    const clean = Array.from({ length: 6 }, (_, i) => rec({ result: i % 2 ? 'defeat' : 'victory' }))
    const { items } = evidenceFrom(clean)
    expect(items.value.map((i) => i.id)).not.toContain('leavers')
  })
})

describe('useEloEvidence — streaks', () => {
  beforeEach(() => setActivePinia(createPinia()))

  // Forty games of W W L L cycles: both after-a-win and after-a-loss arms
  // get ~20 transitions, and every loss streak stops at depth 2.
  function cycleCorpus(): MatchRecord[] {
    seq = 0
    return Array.from({ length: 40 }, (_, i) => rec({ result: i % 4 < 2 ? 'victory' : 'defeat' }))
  }

  it('replaces the one-game tilt with streak-depth rates + a significance clause', () => {
    const { items } = evidenceFrom(cycleCorpus())
    const item = items.value.find((i) => i.id === 'streak-tilt')!
    expect(item).toBeDefined()
    // Depth-1 and depth-2 rates both surface in the value.
    expect(item.value).toMatch(/%/)
    // The 2×2 test is computable here (balanced arms) → the gloss carries p.
    expect(item.gloss).toMatch(/p [=<]/)
  })

  it('surfaces the streak meter impact from streak-modified rank cards', () => {
    seq = 0
    const rows = [
      ...Array.from({ length: 4 }, () => {
        const r = rec({ result: 'victory' })
        ;(r.data as Record<string, unknown>).change_percent = 30
        ;(r.data as Record<string, unknown>).modifiers = ['victory', 'win streak']
        return r
      }),
      ...Array.from({ length: 2 }, () => {
        const r = rec({ result: 'defeat' })
        ;(r.data as Record<string, unknown>).change_percent = -30
        ;(r.data as Record<string, unknown>).modifiers = ['defeat', 'loss streak']
        return r
      }),
      ...Array.from({ length: 4 }, (_, i) => {
        const r = rec({ result: i % 2 ? 'victory' : 'defeat' })
        ;(r.data as Record<string, unknown>).change_percent = i % 2 ? 20 : -20
        ;(r.data as Record<string, unknown>).modifiers = [i % 2 ? 'victory' : 'defeat']
        return r
      }),
    ]
    const { items } = evidenceFrom(rows)
    const meter = items.value.find((i) => i.id === 'streak-meter')!
    expect(meter).toBeDefined()
    // ±30 streak vs ±20 normal → the 1.5× ratio leads the value.
    expect(meter.value).toMatch(/1\.5/)
    expect(meter.gloss).toMatch(/win[- ]streak/i)
    expect(meter.gloss).toMatch(/loss[- ]streak/i)
  })

  it('hides the meter item without enough streak-modified readings', () => {
    const { items } = evidenceFrom(cycleCorpus()) // no change_percent at all
    expect(items.value.map((i) => i.id)).not.toContain('streak-meter')
  })
})

describe('useEloEvidence — session hygiene', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('surfaces the by-game-in-session ladder on a session-rich corpus', () => {
    // The default builder spaces games a day apart (sessions of one), so
    // build 12 four-game evenings by hand: winny early, lossy late.
    seq = 0
    const rows: MatchRecord[] = []
    for (let d = 1; d <= 12; d++) {
      const day = `2026-05-${String(d).padStart(2, '0')}`
      const results = [d !== 12, d <= 8, d % 2 === 0, d <= 3]
      results.forEach((win, i) => {
        seq++
        rows.push({
          match_key: `s${seq}`,
          data: {
            playlist: 'competitive', hero: 'lucio', role: 'support',
            result: win ? 'victory' : 'defeat',
            date: day, finished_at: `${19 + i}:0${i}`,
            heroes_played: [{ hero: 'lucio', percent_played: 100 }],
          },
        } as unknown as MatchRecord)
      })
    }
    const { items } = evidenceFrom(rows)
    const item = items.value.find((i) => i.id === 'session-hygiene')!
    expect(item).toBeDefined()
    expect(item.value).toMatch(/%.*·.*%/)
    expect(item.gloss).toMatch(/sessions/i)
  })

  it('hides on one-game sessions (the default fixture shape)', () => {
    const { items } = evidenceFrom(corpus())
    expect(items.value.map((i) => i.id)).not.toContain('session-hygiene')
  })
})

describe('useEloEvidence — consistency & tilt queueing', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function timed(day: string, time: string, result: string): MatchRecord {
    seq++
    return {
      match_key: `t${seq}`,
      queue_type: 'role',
      data: {
        playlist: 'competitive', hero: 'lucio', role: 'support', result,
        date: day, finished_at: time,
        heroes_played: [{ hero: 'lucio', percent_played: 100 }],
        rank: 'gold', level: 3, change_percent: result === 'victory' ? 20 : -20,
      },
    } as unknown as MatchRecord
  }

  it('prices a rusty return after a week-plus break', () => {
    const rows: MatchRecord[] = []
    for (let d = 1; d <= 10; d++) rows.push(timed(`2026-04-${String(d).padStart(2, '0')}`, '20:00', d % 4 === 0 ? 'defeat' : 'victory'))
    // 12 days off, then a 1W/6L return week.
    for (let d = 22; d <= 28; d++) rows.push(timed(`2026-04-${d}`, '20:00', d === 24 ? 'victory' : 'defeat'))
    const { items } = evidenceFrom(rows)
    const item = items.value.find((i) => i.id === 'consistency')!
    expect(item).toBeTruthy()
    expect(item.label).toMatch(/break/i)
    expect(item.value).toMatch(/% in your first games back/)
    expect(item.gloss).toMatch(/sleep and exercise/i)
    expect(item.tone).toBe('warn')
  })

  it('stays quiet without a qualifying break', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      timed(`2026-04-${String((i % 28) + 1).padStart(2, '0')}`, '20:00', i % 2 ? 'victory' : 'defeat'))
    expect(evidenceFrom(rows).items.value.some((i) => i.id === 'consistency')).toBe(false)
  })

  it('flags tilt queueing with the meter bill', () => {
    const rows: MatchRecord[] = []
    // Baseline wins/losses feed the meter pools...
    for (let d = 1; d <= 12; d++) {
      rows.push(timed(`2026-05-${String(d).padStart(2, '0')}`, '20:00', d % 3 ? 'victory' : 'defeat'))
      rows.push(timed(`2026-05-${String(d).padStart(2, '0')}`, '21:00', d % 4 ? 'victory' : 'defeat'))
    }
    // ...one sitting with 6 straight losses, 30 minutes apart.
    const hours = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30']
    for (const h of hours) rows.push(timed('2026-05-20', h, 'defeat'))
    const { items } = evidenceFrom(rows)
    const item = items.value.find((i) => i.id === 'tilt-queue')!
    expect(item).toBeTruthy()
    expect(item.value).toMatch(/1 tilt queue/)
    expect(item.gloss).toMatch(/5 straight losses/)
    expect(item.gloss).toMatch(/meter|ground/)
    expect(item.tone).toBe('warn')
  })

  it('praises the discipline when a long corpus never tilt-queues', () => {
    const rows: MatchRecord[] = []
    for (let d = 1; d <= 20; d++) {
      rows.push(timed(`2026-05-${String(d).padStart(2, '0')}`, '20:00', d % 2 ? 'victory' : 'defeat'))
      rows.push(timed(`2026-05-${String(d).padStart(2, '0')}`, '21:00', d % 2 ? 'defeat' : 'victory'))
    }
    const item = evidenceFrom(rows).items.value.find((i) => i.id === 'tilt-queue')!
    expect(item).toBeTruthy()
    expect(item.value).toMatch(/none/)
    expect(item.tone).toBe('good')
  })
})
