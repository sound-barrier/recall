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
    ...(opts.leaver ? { annotation: { leaver: true } } : {}),
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
