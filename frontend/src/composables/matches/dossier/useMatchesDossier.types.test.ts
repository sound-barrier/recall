import { describe, expect, it } from 'vitest'
import { monthsAgoISO } from '@/composables/matches/dossier/useMatchesDossier.types'

// The trailing-window cutoff must land in the same calendar position N
// months back — clamped to the target month's length, never overflowed
// past it. setMonth() alone turns "3 months before May 31" into early
// March (Feb 31 normalizes forward), silently excluding a few days of
// matches from every window computed on the 29th–31st.
describe('monthsAgoISO', () => {
  it('clamps a month-end start to the shorter target month', () => {
    expect(monthsAgoISO(3, new Date(2026, 4, 31))).toBe('2026-02-28')
    expect(monthsAgoISO(1, new Date(2026, 2, 31))).toBe('2026-02-28')
  })

  it('keeps exact day when the target month has room', () => {
    expect(monthsAgoISO(2, new Date(2026, 6, 15))).toBe('2026-05-15')
    expect(monthsAgoISO(1, new Date(2026, 0, 31))).toBe('2025-12-31')
  })

  it('crosses year boundaries', () => {
    expect(monthsAgoISO(6, new Date(2026, 1, 28))).toBe('2025-08-28')
  })

  it('defaults to today and stays ISO-shaped', () => {
    expect(monthsAgoISO(1)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
