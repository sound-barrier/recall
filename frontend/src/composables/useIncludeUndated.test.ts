import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readStoredIncludeUndated, INCLUDE_UNDATED_STORAGE_KEY } from './useIncludeUndated'

describe('readStoredIncludeUndated', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns false when nothing is stored (default-off contract)', () => {
    expect(readStoredIncludeUndated()).toBe(false)
  })

  it('returns true when "true" is stored', () => {
    storage[INCLUDE_UNDATED_STORAGE_KEY] = 'true'
    expect(readStoredIncludeUndated()).toBe(true)
  })

  it('returns false when "false" is stored', () => {
    storage[INCLUDE_UNDATED_STORAGE_KEY] = 'false'
    expect(readStoredIncludeUndated()).toBe(false)
  })

  it('falls back to false for an unrecognized stored value', () => {
    storage[INCLUDE_UNDATED_STORAGE_KEY] = 'yes' // not a valid boolean string
    expect(readStoredIncludeUndated()).toBe(false)
  })

  it('falls back to false when localStorage throws (private mode, etc.)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    })
    expect(readStoredIncludeUndated()).toBe(false)
  })
})
