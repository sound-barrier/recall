import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import { nextMoves } from '@/match/elo-next-moves'
import type { LiftRow } from '@/match/elo-lift'

const deps = {
  heroRole: () => 'support',
  heroDisplayName: (k: string) => (k === 'lucio' ? 'Lúcio' : k),
  mapDisplayName: (k: string) => (k === 'busan' ? 'Busan' : k),
}

function liftRow(dimension: LiftRow['dimension'], key: string, lift: number, n = 20): LiftRow {
  return { dimension, key, wins: 0, losses: 0, n, winrate: 50, lift, liftLo: lift - 0.2, liftHi: lift + 0.2, lowSample: n < 10 }
}

let seq = 0
function rec(opts: { result?: string; hero?: string; day?: number; hour?: number; reviewed?: boolean; change?: number } = {}): MatchRecord {
  seq++
  const day = String((opts.day ?? seq % 28) + 1).padStart(2, '0')
  const hour = String(opts.hour ?? 20).padStart(2, '0')
  const hero = opts.hero ?? 'lucio'
  return {
    match_key: `m${seq}`,
    ...(opts.reviewed ? { reviewed_by: 'self', reviewed_at: `2026-05-${day}T23:00:00Z` } : {}),
    data: {
      result: opts.result ?? 'victory',
      hero,
      date: `2026-05-${day}`,
      finished_at: `${hour}:${String(seq % 50 + 10)}`,
      heroes_played: [{ hero, percent_played: 100 }],
      ...(opts.change !== undefined ? { rank: 'gold', level: 3, change_percent: opts.change } : {}),
    },
  } as unknown as MatchRecord
}

describe('nextMoves', () => {
  it('leads with the review habit and phrases the strongest lift', () => {
    seq = 0
    const recs = Array.from({ length: 20 }, (_, i) => rec({ result: i % 2 ? 'victory' : 'defeat' }))
    const moves = nextMoves(recs, [liftRow('hero', 'lucio', 1.21)], deps)
    expect(moves[0]).toEqual({
      id: 'review',
      label: 'Review one of your games',
      detail: '0 of 20 reviewed — the single biggest lever you control.',
    })
    expect(moves[1]).toEqual({
      id: 'lift',
      label: 'Queue more Lúcio',
      detail: '×1.21 your usual win rate over 20 games.',
    })
  })

  it('drops the review move once a fifth of games are reviewed', () => {
    seq = 0
    const recs = Array.from({ length: 20 }, (_, i) => rec({ reviewed: i < 5 }))
    expect(nextMoves(recs, [], deps).some((m) => m.id === 'review')).toBe(false)
  })

  it('phrases lifts per dimension and direction', () => {
    const label = (row: LiftRow) => nextMoves([], [row], deps)[0]!.label
    expect(label(liftRow('map', 'busan', 0.8))).toBe('Careful on Busan')
    expect(label(liftRow('mode', 'escort', 1.15))).toBe('Favor escort maps')
    expect(label(liftRow('day', 'Tuesday', 1.12))).toBe('Play more on Tuesdays')
    expect(label(liftRow('time', 'morning', 0.85))).toBe('Watch your morning games')
    expect(label(liftRow('teammate', 'Buddy#123', 1.3))).toBe('Duo with Buddy#123')
  })

  it('skips thin or marginal lifts', () => {
    expect(nextMoves([], [liftRow('hero', 'lucio', 1.5, 8)], deps)).toEqual([])
    expect(nextMoves([], [liftRow('hero', 'lucio', 1.02)], deps)).toEqual([])
  })

  it('prices the session move from the meter pools', () => {
    seq = 0
    const recs: MatchRecord[] = []
    // 12 evening sessions of 4: hot openers, cold enders — with rank cards
    // (±20) so the advice can be priced.
    for (let d = 0; d < 12; d++) {
      for (let g = 0; g < 4; g++) {
        const win = g === 0 ? d % 12 > 0 : g === 1 ? d % 2 === 0 : g === 2 ? d % 3 === 0 : d % 6 === 0
        recs.push(rec({ result: win ? 'victory' : 'defeat', day: d, hour: 18 + g, change: win ? 20 : -20 }))
      }
    }
    const moves = nextMoves(recs, [], deps)
    const session = moves.find((m) => m.id === 'session')!
    expect(session.label).toBe('End sessions one game earlier')
    expect(session.detail).toMatch(/game 4\+/)
    expect(session.detail).toMatch(/costs ≈\d+(\.\d+)?% meter/)
  })

  it('falls back to pool discipline when off-pool games bleed rank', () => {
    seq = 0
    const recs = [
      ...Array.from({ length: 15 }, (_, i) => rec({ result: i < 11 ? 'victory' : 'defeat' })),
      ...['ana', 'moira', 'zen', 'bap', 'illari'].map((h) => rec({ hero: h, result: 'defeat' })),
    ]
    const move = nextMoves(recs, [], deps).find((m) => m.id === 'discipline')!
    expect(move.label).toBe('Spend fewer ranked games off-pool')
    expect(move.detail).toContain('5 off-pool games')
  })

  it('is empty on an empty corpus', () => {
    expect(nextMoves([], [], deps)).toEqual([])
  })
})
