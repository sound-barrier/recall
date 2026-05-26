import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readStoredShowHidden, SHOW_HIDDEN_STORAGE_KEY } from './useShowHidden'

describe('readStoredShowHidden', () => {
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
    expect(readStoredShowHidden()).toBe(false)
  })

  it('returns true when "true" is stored', () => {
    storage[SHOW_HIDDEN_STORAGE_KEY] = 'true'
    expect(readStoredShowHidden()).toBe(true)
  })

  it('returns false when "false" is stored', () => {
    storage[SHOW_HIDDEN_STORAGE_KEY] = 'false'
    expect(readStoredShowHidden()).toBe(false)
  })

  it('falls back to false for an unrecognized stored value', () => {
    storage[SHOW_HIDDEN_STORAGE_KEY] = 'yes'
    expect(readStoredShowHidden()).toBe(false)
  })

  it('falls back to false when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    })
    expect(readStoredShowHidden()).toBe(false)
  })
})
