import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  readStoredMinPlayPercent,
  readStoredMinPlayMinutes,
  MIN_PLAY_PERCENT_STORAGE_KEY,
  MIN_PLAY_MINUTES_STORAGE_KEY,
} from './useMinPlayThreshold'

// Mirrors useIncludeUndated.test.ts: pure helper tests for the storage
// reads, independent of a mounted component. The composable's reactive
// shape is covered by the SFC tests that consume it.

describe('readStoredMinPlayPercent', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns 0 when nothing is stored', () => {
    expect(readStoredMinPlayPercent()).toBe(0)
  })

  it('returns the stored numeric value', () => {
    storage[MIN_PLAY_PERCENT_STORAGE_KEY] = '15'
    expect(readStoredMinPlayPercent()).toBe(15)
  })

  it('clamps stored values above 100 down to 100', () => {
    storage[MIN_PLAY_PERCENT_STORAGE_KEY] = '250'
    expect(readStoredMinPlayPercent()).toBe(100)
  })

  it('clamps negative stored values up to 0', () => {
    storage[MIN_PLAY_PERCENT_STORAGE_KEY] = '-5'
    expect(readStoredMinPlayPercent()).toBe(0)
  })

  it('falls back to 0 for non-numeric strings', () => {
    storage[MIN_PLAY_PERCENT_STORAGE_KEY] = 'half'
    expect(readStoredMinPlayPercent()).toBe(0)
  })

  it('falls back to 0 when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    })
    expect(readStoredMinPlayPercent()).toBe(0)
  })
})

describe('readStoredMinPlayMinutes', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns 0 when nothing is stored', () => {
    expect(readStoredMinPlayMinutes()).toBe(0)
  })

  it('returns the stored numeric value', () => {
    storage[MIN_PLAY_MINUTES_STORAGE_KEY] = '2.5'
    expect(readStoredMinPlayMinutes()).toBe(2.5)
  })

  it('clamps negative stored values up to 0', () => {
    storage[MIN_PLAY_MINUTES_STORAGE_KEY] = '-3'
    expect(readStoredMinPlayMinutes()).toBe(0)
  })

  it('falls back to 0 for non-numeric strings', () => {
    storage[MIN_PLAY_MINUTES_STORAGE_KEY] = 'forever'
    expect(readStoredMinPlayMinutes()).toBe(0)
  })
})
