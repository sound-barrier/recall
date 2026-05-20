import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readStoredTheme, applyTheme, THEME_STORAGE_KEY } from './useTheme'

// Tests for the pure helper functions exported from useTheme.
// These cover the business logic without needing a mounted Vue component
// or a DOM environment — vi.stubGlobal mocks localStorage and document.

describe('readStoredTheme', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns "dark" when nothing is stored', () => {
    expect(readStoredTheme()).toBe('dark')
  })

  it('returns "light" when light is stored', () => {
    storage[THEME_STORAGE_KEY] = 'light'
    expect(readStoredTheme()).toBe('light')
  })

  it('returns "dark" when dark is stored', () => {
    storage[THEME_STORAGE_KEY] = 'dark'
    expect(readStoredTheme()).toBe('dark')
  })

  it('returns "dark" for invalid stored values', () => {
    storage[THEME_STORAGE_KEY] = 'solarized'
    expect(readStoredTheme()).toBe('dark')
  })

  it('returns "dark" when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage unavailable') },
    })
    expect(readStoredTheme()).toBe('dark')
  })
})

describe('applyTheme', () => {
  let attrs: Record<string, string>

  beforeEach(() => {
    attrs = {}
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (name: string, value: string) => { attrs[name] = value },
      },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('sets data-theme="dark" on the document root', () => {
    applyTheme('dark')
    expect(attrs['data-theme']).toBe('dark')
  })

  it('sets data-theme="light" on the document root', () => {
    applyTheme('light')
    expect(attrs['data-theme']).toBe('light')
  })

  it('overwrites a previous value', () => {
    applyTheme('dark')
    applyTheme('light')
    expect(attrs['data-theme']).toBe('light')
  })
})
