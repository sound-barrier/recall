import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readStoredWeekStart, WEEK_START_STORAGE_KEY } from './useWeekStart'

// Mirrors useTheme.test.ts: pure helper tests for the storage read,
// independent of a mounted component.

describe('readStoredWeekStart', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns "sunday" when nothing is stored', () => {
    expect(readStoredWeekStart()).toBe('sunday')
  })

  it('returns "monday" when monday is stored', () => {
    storage[WEEK_START_STORAGE_KEY] = 'monday'
    expect(readStoredWeekStart()).toBe('monday')
  })

  it('returns "sunday" when sunday is stored', () => {
    storage[WEEK_START_STORAGE_KEY] = 'sunday'
    expect(readStoredWeekStart()).toBe('sunday')
  })

  it('falls back to "sunday" for an unrecognized stored value', () => {
    storage[WEEK_START_STORAGE_KEY] = 'tuesday' // not a valid WeekStart
    expect(readStoredWeekStart()).toBe('sunday')
  })

  it('falls back to "sunday" when localStorage throws (private mode, etc.)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    })
    expect(readStoredWeekStart()).toBe('sunday')
  })
})
