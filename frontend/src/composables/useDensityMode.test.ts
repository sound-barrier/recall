import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readStoredDensityMode, DENSITY_STORAGE_KEY } from './useDensityMode'

describe('readStoredDensityMode', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns "comfortable" when nothing is stored (default contract)', () => {
    expect(readStoredDensityMode()).toBe('comfortable')
  })

  it('returns "compact" when "compact" is stored', () => {
    storage[DENSITY_STORAGE_KEY] = 'compact'
    expect(readStoredDensityMode()).toBe('compact')
  })

  it('returns "comfortable" when "comfortable" is stored', () => {
    storage[DENSITY_STORAGE_KEY] = 'comfortable'
    expect(readStoredDensityMode()).toBe('comfortable')
  })

  it('falls back to "comfortable" for an unrecognised stored value', () => {
    storage[DENSITY_STORAGE_KEY] = 'cozy'
    expect(readStoredDensityMode()).toBe('comfortable')
  })

  it('falls back to "comfortable" when localStorage throws (private mode, etc.)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    })
    expect(readStoredDensityMode()).toBe('comfortable')
  })
})
