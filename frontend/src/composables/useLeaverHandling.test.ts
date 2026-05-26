import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readStoredLeaverHandling, LEAVER_HANDLING_STORAGE_KEY } from './useLeaverHandling'

describe('readStoredLeaverHandling', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns "include" when nothing is stored (default contract)', () => {
    expect(readStoredLeaverHandling()).toBe('include')
  })

  it('round-trips each of the three valid values', () => {
    for (const v of ['include', 'exclude-tally', 'hide'] as const) {
      storage[LEAVER_HANDLING_STORAGE_KEY] = v
      expect(readStoredLeaverHandling()).toBe(v)
    }
  })

  it('falls back to "include" for an unrecognised value', () => {
    storage[LEAVER_HANDLING_STORAGE_KEY] = 'banish'
    expect(readStoredLeaverHandling()).toBe('include')
  })

  it('falls back to "include" when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    })
    expect(readStoredLeaverHandling()).toBe('include')
  })
})
