import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { useMatchHeatmap } from '@/composables/matches/useMatchHeatmap'
import type { MatchRecord } from '@/api'

// Pin "today" so the trailing-52-weeks window doesn't drift on every
// test run.
const FIXED_TODAY = new Date(2026, 4, 14) // May 14 2026 (Thu)

function rec(date: string, result: 'victory' | 'defeat' | 'draw', key = date): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    source_types: { [`${key}.png`]: 'summary' },
    data: { date, finished_at: '22:00', result, map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio' },
    parsed_at: `${date}T22:30:00Z`,
  } as unknown as MatchRecord
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_TODAY)
})
afterEach(() => { vi.useRealTimers() })

describe('useMatchHeatmap', () => {
  it('defaults to a 26-week trailing window (≈ last 6 months)', () => {
    const records = ref<MatchRecord[]>([])
    const model = useMatchHeatmap(records)
    // 26 weeks × 7 = 182 cells. Allow ±7 for the snap-to-week edge.
    expect(model.value.cells.length).toBeGreaterThanOrEqual(175)
    expect(model.value.cells.length).toBeLessThanOrEqual(189)
    expect(model.value.weeks).toBeGreaterThanOrEqual(25)
    expect(model.value.weeks).toBeLessThanOrEqual(27)
    // End date is today.
    expect(model.value.end).toBe('2026-05-14')
  })

  it('a 3M (13-week) window produces ~91 cells', () => {
    const records = ref<MatchRecord[]>([])
    const model = useMatchHeatmap(records, { windowWeeks: 13 })
    expect(model.value.cells.length).toBeGreaterThanOrEqual(84)
    expect(model.value.cells.length).toBeLessThanOrEqual(98)
  })

  it('cells stay reactive when windowWeeks is passed as a Ref and flipped', async () => {
    const records = ref<MatchRecord[]>([])
    const weeks = ref(13)
    const model = useMatchHeatmap(records, { windowWeeks: weeks })
    expect(model.value.cells.length).toBeGreaterThanOrEqual(84)
    expect(model.value.cells.length).toBeLessThanOrEqual(98)
    weeks.value = 52
    expect(model.value.cells.length).toBeGreaterThanOrEqual(357)
    expect(model.value.cells.length).toBeLessThanOrEqual(371)
  })

  it('buckets records by date and computes win-rate (draws excluded from denominator)', () => {
    const records = ref<MatchRecord[]>([
      rec('2026-05-10', 'victory', 'a'),
      rec('2026-05-10', 'victory', 'b'),
      rec('2026-05-10', 'victory', 'c'),
      rec('2026-05-11', 'defeat',  'd'),
      rec('2026-05-11', 'defeat',  'e'),
      rec('2026-05-12', 'victory', 'f'),
      rec('2026-05-12', 'draw',    'g'),
    ])
    const model = useMatchHeatmap(records)
    const cells = model.value.cells

    const winDay = cells.find(c => c.date === '2026-05-10')!
    expect(winDay).toMatchObject({ wins: 3, losses: 0, draws: 0, total: 3, winRate: 1, empty: false })

    const lossDay = cells.find(c => c.date === '2026-05-11')!
    expect(lossDay).toMatchObject({ wins: 0, losses: 2, draws: 0, total: 2, winRate: 0, empty: false })

    // Draw shouldn't pull W% — 1 win / (1 win + 0 loss) = 100%, draw
    // counts toward `total` (for saturation) but not winRate.
    const mixedDay = cells.find(c => c.date === '2026-05-12')!
    expect(mixedDay).toMatchObject({ wins: 1, losses: 0, draws: 1, total: 2, winRate: 1 })
  })

  it('marks days with zero matches as empty', () => {
    const records = ref<MatchRecord[]>([rec('2026-05-10', 'victory')])
    const model = useMatchHeatmap(records)
    const noMatchDay = model.value.cells.find(c => c.date === '2026-05-13')!
    expect(noMatchDay).toMatchObject({ total: 0, empty: true, winRate: 0 })
  })

  it('honours the windowWeeks option (e.g. 52 for 12-month view)', () => {
    const records = ref<MatchRecord[]>([])
    const model = useMatchHeatmap(records, { windowWeeks: 52 })
    // 52 weeks × 7 = 364 cells, ±7 for the week-snap edge.
    expect(model.value.cells.length).toBeGreaterThanOrEqual(357)
    expect(model.value.cells.length).toBeLessThanOrEqual(371)
  })

  it('emits 6-7 month labels at the 26-week default window', () => {
    const records = ref<MatchRecord[]>([])
    const model = useMatchHeatmap(records)
    // 26 weeks ≈ 6 months, so 6-7 month labels.
    expect(model.value.monthLabels.length).toBeGreaterThanOrEqual(6)
    expect(model.value.monthLabels.length).toBeLessThanOrEqual(7)
  })

  it('exposes maxTotal so the caller can normalise saturation', () => {
    const records = ref<MatchRecord[]>([
      rec('2026-05-10', 'victory', 'a'),
      rec('2026-05-10', 'victory', 'b'),
      rec('2026-05-10', 'victory', 'c'),
      rec('2026-05-10', 'victory', 'd'),
      rec('2026-05-11', 'defeat',  'e'),
    ])
    const model = useMatchHeatmap(records)
    expect(model.value.maxTotal).toBe(4)
  })

  it('emits month labels in ascending weekIndex order', () => {
    const records = ref<MatchRecord[]>([])
    const model = useMatchHeatmap(records, { windowWeeks: 52 })
    expect(model.value.monthLabels.length).toBeGreaterThanOrEqual(11)
    const indices = model.value.monthLabels.map(m => m.weekIndex)
    const sorted = [...indices].sort((a, b) => a - b)
    expect(indices).toEqual(sorted)
  })

  it('honours weekStartsOn=1 (Monday) by snapping the start to a Monday', () => {
    const records = ref<MatchRecord[]>([])
    const model = useMatchHeatmap(records, { weekStartsOn: 1 })
    // `start` should resolve to a Monday: dayOfWeek of the first
    // cell is 0 (column-relative to Mon). Use a local-date parse to
    // avoid `new Date('YYYY-MM-DD')` reading the ISO date as UTC
    // midnight (shifts to the previous day west of UTC).
    expect(model.value.cells[0]!.dayOfWeek).toBe(0)
    const [y, m, d] = model.value.start.split('-').map(Number)
    const startDate = new Date(y!, m! - 1, d!)
    expect(startDate.getDay()).toBe(1) // 1 = Monday
  })
})
