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

  it('returns 0 (Sunday) when nothing is stored', () => {
    expect(readStoredWeekStart()).toBe(0)
  })

  it('returns each numeric day 0-6 when that value is stored', () => {
    for (let n = 0; n <= 6; n++) {
      storage[WEEK_START_STORAGE_KEY] = String(n)
      expect(readStoredWeekStart()).toBe(n)
    }
  })

  it('falls back to 0 for a non-numeric stored value', () => {
    storage[WEEK_START_STORAGE_KEY] = 'tuesday'
    expect(readStoredWeekStart()).toBe(0)
  })

  it('falls back to 0 for an out-of-range numeric string', () => {
    storage[WEEK_START_STORAGE_KEY] = '7'
    expect(readStoredWeekStart()).toBe(0)
    storage[WEEK_START_STORAGE_KEY] = '-1'
    expect(readStoredWeekStart()).toBe(0)
  })

  it('falls back to 0 when localStorage throws (private mode, etc.)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    })
    expect(readStoredWeekStart()).toBe(0)
  })
})
