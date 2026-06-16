import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api'
import { makePivotFields, NONE_BUCKET, type DimensionField, type MeasureField } from '@/match/pivot-fields'

const heroRole = (h: string | null | undefined): string =>
  ({ ana: 'support', dva: 'tank' } as Record<string, string>)[h ?? ''] ?? ''
const fields = makePivotFields(heroRole)

function dim(id: string): DimensionField {
  const f = fields.find((x) => x.id === id && x.kind === 'dimension')
  if (!f || f.kind !== 'dimension') throw new Error(`no dimension ${id}`)
  return f
}
function measure(id: string): MeasureField {
  const f = fields.find((x) => x.id === id && x.kind === 'measure')
  if (!f || f.kind !== 'measure') throw new Error(`no measure ${id}`)
  return f
}

function rec(data: Partial<MatchRecord['data']> = {}, top: Partial<MatchRecord> = {}): MatchRecord {
  return { match_key: 'm', source_files: [], data: { ...data }, ...top } as unknown as MatchRecord
}

describe('pivot field catalog — dimensions', () => {
  it('collects the de-duplicated hero pool (heroes_played + primary)', () => {
    const r = rec({ hero: 'ana', heroes_played: [{ hero: 'ana', percent_played: 70 }, { hero: 'dva', percent_played: 30 }] })
    expect(dim('hero').values(r)).toEqual(['ana', 'dva'])
  })

  it('buckets an empty hero pool under (none)', () => {
    expect(dim('hero').values(rec())).toEqual([NONE_BUCKET])
  })

  it('resolves every role played via the injected heroRole lookup', () => {
    const r = rec({ heroes_played: [{ hero: 'ana', percent_played: 60 }, { hero: 'dva', percent_played: 40 }] })
    expect(dim('role').values(r)).toEqual(['support', 'tank'])
  })

  it('labels play mode by the effective override-aware value', () => {
    expect(dim('playMode').values(rec({}, { play_mode: 'competitive' } as Partial<MatchRecord>))).toEqual(['Competitive'])
    expect(dim('playMode').values(rec())).toEqual(['Unknown mode'])
  })

  it('labels queue type from the effective queue', () => {
    expect(dim('queue').values(rec({}, { queue_type: 'role' } as Partial<MatchRecord>))).toEqual(['Role Queue'])
  })

  it('buckets a missing scalar dimension under (none)', () => {
    expect(dim('map').values(rec({ map: '' }))).toEqual([NONE_BUCKET])
    expect(dim('map').values(rec({ map: 'rialto' }))).toEqual(['rialto'])
  })

  it('treats unset provenance with sensible defaults', () => {
    expect(dim('reviewedBy').values(rec())).toEqual(['unreviewed'])
    expect(dim('source').values(rec())).toEqual(['ocr'])
  })

  it('bands the finish time into a time-of-day bucket', () => {
    expect(dim('timeOfDay').values(rec({ finished_at: '21:29' }))).toEqual(['Evening (18–24)'])
    expect(dim('timeOfDay').values(rec({ finished_at: '09:00' }))).toEqual(['Morning (6–12)'])
    expect(dim('timeOfDay').values(rec())).toEqual([NONE_BUCKET])
  })

  it('derives day-of-week and month from the match date', () => {
    expect(dim('dayOfWeek').values(rec({ date: '2024-01-07' }))).toEqual(['Sunday'])
    expect(dim('month').values(rec({ date: '2026-05-10' }))).toEqual(['2026-05'])
  })
})

describe('pivot field catalog — measures', () => {
  it('reads numeric measures, null when absent', () => {
    expect(measure('eliminations').value(rec({ eliminations: 17 }))).toBe(17)
    expect(measure('eliminations').value(rec())).toBeNull()
  })

  it('the synthetic matches measure is always 1 (for counts)', () => {
    expect(measure('matches').value(rec())).toBe(1)
  })
})
